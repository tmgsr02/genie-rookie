"""Planner fixtures verify the real Pipecat turn/playback path, not live providers."""

import asyncio

import pytest
from mobile_app.tutor import validated_dialogue
from support import respond, session


def test_dialogue_rejects_unknown_speakers_or_executable_payloads():
    assert validated_dialogue({"dialogue": [{"speaker": "genius", "text": "Try it."}]}) == [
        {"speaker": "genius", "text": "Try it."}
    ]
    for value in [
        {"dialogue": [{"speaker": "system", "text": "Do it"}]},
        {"dialogue": [{"speaker": "rookie", "text": "x" * 1001}]},
        {"dialogue": "not an array"},
    ]:
        with pytest.raises(ValueError):
            validated_dialogue(value)


async def test_typed_curiosity_uses_cloud_plan_then_existing_playback():
    async with session(lines=2) as (bridge, host):
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "Why do words rhyme?"}
        )
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        assert plan["text"] == "Why do words rhyme?"
        assert not any(e.get("operation") in {"generate", "audience"} for e in host.events)
        await respond(
            bridge,
            plan,
            value={
                "dialogue": [
                    {"speaker": "genius", "text": "Listen to the endings."},
                    {"speaker": "rookie", "text": "Can you find a pair?"},
                ]
            },
        )
        await respond(bridge, plan, done=True)
        first = await host.wait(lambda e: e.get("operation") == "speak")
        assert first["speaker"] == "genius"
        await host.play(bridge, first)
        second = await host.wait(
            lambda e: e.get("operation") == "speak" and e["request"] != first["request"]
        )
        assert second["speaker"] == "rookie"
        await host.play(bridge, second)
        await host.wait(lambda e: e.get("state") == "listening")


async def test_state_change_invalidates_pending_planner_and_stale_dialogue():
    async with session(lines=2) as (bridge, host):
        await bridge.receive({"type": "text_input", "session": host.session, "text": "Why?"})
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        basis = {"scene_id": "s", "scene_version": 1, "state_revision": 2}
        await bridge.receive(
            {"type": "explainer_invalidate", "session": host.session, "basis": basis}
        )
        await respond(bridge, plan, value={"dialogue": [{"speaker": "genius", "text": "Old."}]})
        await respond(bridge, plan, done=True)
        await bridge.receive(
            {
                "type": "explainer_dialogue",
                "session": host.session,
                "request_id": "stale",
                "basis": {**basis, "state_revision": 1},
                "dialogue": [{"speaker": "genius", "text": "Stale."}],
            }
        )
        await asyncio.sleep(0.05)
        assert not any(e.get("operation") == "speak" for e in host.events)


async def test_scene_dialogue_deduplicates_and_uses_current_basis():
    async with session(lines=2) as (bridge, host):
        basis = {"scene_id": "s", "scene_version": 1, "state_revision": 3}
        await bridge.receive(
            {"type": "explainer_invalidate", "session": host.session, "basis": basis}
        )
        event = {
            "type": "explainer_dialogue",
            "session": host.session,
            "request_id": "ack-3",
            "basis": basis,
            "dialogue": [{"speaker": "rookie", "text": "The endings match."}],
        }
        await bridge.receive(event)
        first = await host.wait(lambda e: e.get("operation") == "speak")
        assert first["basis"] == basis
        await host.play(bridge, first)
        await bridge.receive(event)
        await asyncio.sleep(0.05)
        assert len([e for e in host.events if e.get("operation") == "speak"]) == 1


async def test_recognized_voice_uses_same_semantic_planner_as_text():
    async with session(lines=2) as (bridge, host):
        marker, start = await host.begin_speech(bridge, text="Can we look inside the seed?")
        await host.end_speech(bridge, "Can we look inside the seed?", start=start, after=marker)
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        assert plan["text"] == "Can we look inside the seed?"
        await respond(bridge, plan, value={"dialogue": []})
        await respond(bridge, plan, done=True)
        await host.wait(lambda e: e.get("state") == "listening")
        assert not any(e.get("operation") == "generate" for e in host.events)


async def test_text_works_with_microphone_muted_and_wrong_session_cannot_speak():
    async with session(lines=2) as (bridge, host):
        await bridge.receive({"type": "mute", "session": host.session})
        await bridge.receive({"type": "text_input", "session": "another", "text": "Wrong"})
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "What is half?"}
        )
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        assert plan["text"] == "What is half?"
        await respond(bridge, plan, value={"dialogue": []})
        await respond(bridge, plan, done=True)
        await host.wait(lambda e: e.get("state") == "listening")
        assert len([e for e in host.events if e.get("operation") == "plan_explainer"]) == 1


async def test_starting_voice_keeps_the_scene_created_by_text():
    async with session(lines=2) as (bridge, host):
        basis = {"scene_id": "from-text", "scene_version": 1, "state_revision": 7}
        await bridge.receive({"type": "start", "session": host.session, "explainer_basis": basis})
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "Why did that happen?"}
        )
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        await respond(
            bridge,
            plan,
            value={
                "basis": basis,
                "dialogue": [
                    {"speaker": "genius", "text": "You changed the number of equal parts."}
                ],
            },
        )
        await respond(bridge, plan, done=True)
        speech = await host.wait(lambda e: e.get("operation") == "speak")
        assert speech["basis"] == basis
        await host.play(bridge, speech)


async def test_followup_transmits_only_bounded_heard_history_with_wire_speakers():
    async with session(lines=2) as (bridge, host):
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "What makes a seed grow?"}
        )
        first = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        await respond(
            bridge,
            first,
            value={
                "dialogue": [{"speaker": "genius", "text": "Which part would you like to explore?"}]
            },
        )
        await respond(bridge, first, done=True)
        speech = await host.wait(lambda e: e.get("operation") == "speak")
        await host.play(bridge, speech)
        await host.wait(lambda e: e.get("state") == "listening")
        await bridge.receive({"type": "text_input", "session": host.session, "text": "The inside."})
        second = await host.wait(
            lambda e: e.get("operation") == "plan_explainer" and e["request"] != first["request"]
        )
        assert second["heard"] == [
            {"speaker": "child", "text": "What makes a seed grow?"},
            {"speaker": "genius", "text": "Which part would you like to explore?"},
        ]
        await respond(bridge, second, value={"dialogue": []})
        await respond(bridge, second, done=True)


async def test_scene_readiness_never_discards_the_childs_unfinished_question():
    async with session(lines=2) as (bridge, host):
        marker, start = await host.begin_speech(bridge, text="Why do")
        child_turn = bridge.turn
        basis = {"scene_id": "s", "scene_version": 1, "state_revision": 0}
        await bridge.receive(
            {"type": "explainer_invalidate", "session": host.session, "basis": basis}
        )
        await bridge.receive(
            {
                "type": "explainer_dialogue",
                "session": host.session,
                "request_id": "background",
                "basis": basis,
                "dialogue": [{"speaker": "rookie", "text": "Look at this."}],
            }
        )
        await asyncio.sleep(0.05)
        assert bridge.turn == child_turn
        assert not any(e.get("operation") == "speak" for e in host.events)
        await host.end_speech(bridge, "Why do seeds grow?", start=start, after=marker)
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        assert plan["text"] == "Why do seeds grow?"
        await respond(bridge, plan, value={"dialogue": []})
        await respond(bridge, plan, done=True)


async def test_failed_audio_is_reported_and_never_enters_heard_history():
    async with session(lines=2) as (bridge, host):
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "Why do birds sing?"}
        )
        plan = await host.wait(lambda e: e.get("operation") == "plan_explainer")
        await respond(
            bridge,
            plan,
            value={"dialogue": [{"speaker": "genius", "text": "Listen to their calls."}]},
        )
        await respond(bridge, plan, done=True)
        speech = await host.wait(lambda e: e.get("operation") == "speak")
        await respond(bridge, speech, error="The voice returned no audio.")
        failure = await host.wait(
            lambda e: e.get("type") == "error" and e.get("operation") == "speak"
        )
        assert "no audio" in failure["message"]
        await bridge.receive({"type": "interrupt", "session": host.session})
        await bridge.receive(
            {"type": "text_input", "session": host.session, "text": "Can we try again?"}
        )
        retry = await host.wait(
            lambda e: e.get("operation") == "plan_explainer" and e["request"] != plan["request"]
        )
        assert not any(line["speaker"] == "genius" for line in retry["heard"])
        await respond(bridge, retry, value={"dialogue": []})
        await respond(bridge, retry, done=True)
