"""Lesson progression only. The bundled JS scene is the sole physics authority.

No transcript is stored here. A result is evidence only after the scene acknowledges
an action/version. A new lesson session fences all delayed acknowledgements.
"""

from dataclasses import dataclass, field

PROMPTS = {
    "wonder": "Could one block balance three? Rookie thinks the three will always win. Let’s test that guess.",
    "predict": "What might happen if the single block moves farther from the middle?",
    "experiment": "Move the right carrier one notch farther. What changes?",
    "observe": "The beam is level. One block balanced three! What do you notice?",
    "explain": "Teach Rookie: why did moving the single block help?",
    "transfer": "New challenge: two blocks at notch two. Can you balance them by moving the single block?",
    "finish": "You tested an idea and taught Rookie: both the weight and its distance from the middle matter.",
}


@dataclass
class LessonEngine:
    session: str
    phase: str = "wonder"
    version: int = -1
    evidence: dict = field(default_factory=dict)
    seen: set = field(default_factory=set)
    experiment_tried: bool = False
    explanation_with_hint: bool = False
    transfer_attempted: bool = False
    hint: str = ""

    def snapshot(self):
        return {
            "type": "lesson_state",
            "lesson_session": self.session,
            "phase": self.phase,
            "prompt": self.hint or PROMPTS[self.phase],
            "scene_version": self.version,
            "summary": {
                "experiment_tried": self.experiment_tried,
                "explanation_with_hint": self.explanation_with_hint,
                "transfer_attempted": self.transfer_attempted,
            },
        }

    def accept(self, event):
        if event.get("lesson_session") != self.session:
            return None
        event_id = event.get("event_id")
        if not isinstance(event_id, str) or not 1 <= len(event_id) <= 100:
            return None
        if event_id in self.seen:
            return self.snapshot()
        if len(self.seen) >= 4096:
            return None
        kind = event.get("kind")
        if kind == "scene_result":
            result = event.get("result", {})
            version = result.get("scene_version")
            if (
                type(version) is not int
                or version <= self.version
                or result.get("status") != "applied"
            ):
                return None
            values = result.get("values", {})
            if any(
                type(values.get(k)) is not int or not 1 <= values[k] <= 4
                for k in ("left_count", "right_count", "left_distance", "right_distance")
            ):
                return None
            if result.get("outcome") not in ("left_down", "right_down", "balanced"):
                return None
            self.version, self.evidence = version, result
            self.hint = ""
            if self.phase == "experiment":
                self.experiment_tried = True
                if result["outcome"] == "balanced":
                    self.phase = "observe"
            elif self.phase == "transfer":
                self.transfer_attempted = True
                if result["outcome"] == "balanced":
                    self.phase = "finish"
        elif kind == "continue" and self.phase in ("wonder", "observe"):
            self.phase = {"wonder": "predict", "observe": "explain"}[self.phase]
        elif kind == "prediction" and self.phase == "predict":
            # Predictions are accepted, never graded or retained verbatim.
            if event.get("choice") not in ("balance", "left", "unsure"):
                return None
            self.phase = "experiment"
        elif kind == "explanation" and self.phase == "explain":
            choice = event.get("choice")
            if choice in ("distance_and_weight", "demonstrate"):
                self.explanation_with_hint |= choice == "demonstrate"
                self.phase, self.hint = "transfer", ""
            elif choice == "typed":
                # Free text is neither graded nor retained. Confirm through an accessible choice.
                self.hint = "Thanks for sharing your idea. Choose the explanation that matches it, or show Rookie on the next challenge."
            else:
                self.explanation_with_hint = True
                self.hint = "The block stayed the same weight. What changed was how far it sat from the middle. Try the explanation buttons or show Rookie."
        else:
            return None
        self.seen.add(event_id)
        return self.snapshot()

    def facts(self):
        if not self.evidence:
            return "No experiment result has been acknowledged yet. Ask the learner to use the touch controls."
        r = self.evidence
        return f"Lesson phase {self.phase}. Acknowledged scene version {self.version}: {r['values']}; outcome {r['outcome']}. {PROMPTS[self.phase]}"


def voice_action(text, lesson):
    """Small exact phrase grammar. Arbitrary model-generated actions are never executed."""
    phrase = " ".join(text.lower().strip(".!? ").split())
    if lesson.phase not in ("experiment", "transfer") or not lesson.evidence:
        return None
    state = lesson.evidence["values"]
    direction = {
        "move the right block farther": 1,
        "one notch farther": 1,
        "move it farther": 1,
        "one more notch": 1,
        "move the right block closer": -1,
        "one notch closer": -1,
    }.get(phrase)
    if direction is None:
        return None
    value = state["right_distance"] + direction
    if not 1 <= value <= 4:
        return None
    return {
        "type": "move_weight",
        "session": lesson.session,
        "expected_scene_version": lesson.version,
        "entity_id": "right_carrier",
        "value": value,
    }
