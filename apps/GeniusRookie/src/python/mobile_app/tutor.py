"""One cloud planner, with Little Voices' native turn and playback machinery.

No provider credentials, generated code, or topic routing live in this service.
The host owns the authenticated planner connection and scene acknowledgements.
"""

from __future__ import annotations

from typing import Any

from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat_apple.frames import AppleInputFrame

from mobile_app.audience import Line, normalize
from mobile_app.duo import CAST, DuoLLMService


def validated_dialogue(value: Any) -> list[dict[str, str]]:
    """Validate the small speech-only result; actions never execute through text."""
    if not isinstance(value, dict) or not isinstance(value.get("dialogue"), list):
        raise ValueError("The explanation could not be read. Please try again.")
    lines = value["dialogue"]
    if len(lines) > 2:
        raise ValueError("The explanation was too long. Please try again.")
    checked = []
    for line in lines:
        if not isinstance(line, dict) or line.get("speaker") not in CAST:
            raise ValueError("The explanation has an unknown speaker.")
        text = line.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise ValueError("The explanation has an invalid line.")
        checked.append({"speaker": line["speaker"], "text": text.strip()})
    return checked


class TutorLLMService(DuoLLMService):
    """Shared planner supplies both lines; Pipecat still owns sequential speech."""

    def prepare_context(self, context: LLMContext) -> None:
        # Cloud planning has no dependency on an Apple model or Audience warmup.
        self._follow_session()

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        if isinstance(frame, AppleInputFrame):
            event = frame.event
            kind = event.get("type")
            if kind in {"text_input", "explainer_dialogue"}:
                turn = frame.metadata.get("turn")
                if (
                    not turn
                    or turn != self.bridge.turn
                    or not self.bridge.active
                    or frame.metadata.get("session") != self.bridge.session
                ):
                    return
                if kind == "text_input":
                    await self.respond(
                        LLMContext(messages=[{"role": "user", "content": event["text"]}]), turn
                    )
                else:
                    try:
                        await self._speak_plan(event, turn)
                    except (ValueError, RuntimeError) as exc:
                        await self.push_response_error(exc, turn)
                return
        await super().process_frame(frame, direction)

    async def _exchange(self, turn: str, text: str) -> bool:
        # Explicit legacy fixture regression mode retains its original reducer.
        if self.bridge.lesson is not None:
            return await super()._exchange(turn, text)
        self._follow_session()
        self.room.forget_unheard()
        self.room.add(Line("player", normalize(text)))
        value = None
        try:
            async for event in self.bridge.stream(
                "plan_explainer",
                turn,
                text=text,
                heard=[
                    {
                        "speaker": "child" if line.speaker == "player" else line.speaker,
                        "text": line.text[:700],
                    }
                    for line in self.room.lines[:-1]
                    if line.heard
                ][-12:],
            ):
                if "value" in event:
                    value = event["value"]
            if self.bridge.turn != turn or not self.bridge.active:
                return False
            await self._speak_plan(value, turn)
        except Exception as exc:
            if self.bridge.turn == turn and self.bridge.active:
                await self.push_response_error(exc, turn)
        return False

    async def _speak_plan(self, value: dict, turn: str) -> None:
        lines = validated_dialogue(value)
        basis = value.get("basis")
        if basis is not None and basis != self.bridge.explainer_basis:
            return
        if not lines:
            self._tell({"type": "state", "state": "listening", "turn": turn})
            return
        for number, item in enumerate(lines):
            if self.bridge.turn != turn or not self.bridge.active:
                return
            if basis is not None and basis != self.bridge.explainer_basis:
                return
            speaker, text = item["speaker"], item["text"]
            self.room.add(Line(speaker, normalize(text), heard=False))
            tags = {"turn": turn, "speaker": speaker, "voice": CAST[speaker].voice, "line": number}
            if basis is not None:
                tags["basis"] = basis
            self._addressed(turn, ["player"], line=number)
            start = LLMFullResponseStartFrame()
            chunk = LLMTextFrame(text)
            end = LLMFullResponseEndFrame()
            for frame in (start, chunk, end):
                frame.metadata.update(tags)
            end.metadata["continues"] = number < len(lines) - 1
            await self.push_frame(start)
            await self.push_frame(chunk)
            await self.push_frame(end)
