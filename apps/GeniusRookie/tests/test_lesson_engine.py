import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src/python"))
from mobile_app.lesson_engine import LessonEngine, voice_action


class LessonTests(unittest.TestCase):
    def setUp(self):
        self.lesson = LessonEngine("session-a")
        self.n = 0

    def send(self, kind, **kw):
        self.n += 1
        return self.lesson.accept(
            {"lesson_session": "session-a", "event_id": str(self.n), "kind": kind, **kw}
        )

    def result(self, version, outcome, right=1):
        return {
            "status": "applied",
            "scene_version": version,
            "outcome": outcome,
            "values": {
                "left_count": 3,
                "left_distance": 1,
                "right_count": 1,
                "right_distance": right,
            },
        }

    def test_complete_learning_loop_consumes_acknowledgements(self):
        self.send("scene_result", result=self.result(0, "left_down"))
        self.send("continue")
        self.assertEqual(self.lesson.phase, "predict")
        self.send("prediction", choice="unsure")
        self.assertEqual(self.lesson.phase, "experiment")
        self.send("scene_result", result=self.result(1, "left_down", 2))
        self.assertEqual(self.lesson.phase, "experiment")
        self.send("scene_result", result=self.result(2, "balanced", 3))
        self.assertEqual(self.lesson.phase, "observe")
        self.send("continue")
        self.send("explanation", choice="typed", text="uncertain transcript")
        self.assertEqual(self.lesson.phase, "explain")
        self.send("explanation", choice="distance_and_weight")
        self.assertEqual(self.lesson.phase, "transfer")
        self.send("scene_result", result=self.result(3, "balanced", 4))
        self.assertEqual(self.lesson.phase, "finish")
        self.assertEqual(
            set(self.lesson.snapshot()["summary"]),
            {"experiment_tried", "explanation_with_hint", "transfer_attempted"},
        )
        self.assertNotIn("uncertain transcript", str(self.lesson))

    def test_prediction_not_graded(self):
        for answer in ("balance", "left", "unsure"):
            self.lesson = LessonEngine("session-a", phase="predict")
            self.send("prediction", choice=answer)
            self.assertEqual(self.lesson.phase, "experiment")

    def test_stale_duplicate_wrong_session_and_failed_results_rejected(self):
        self.send("scene_result", result=self.result(3, "left_down"))
        self.assertIsNone(self.send("scene_result", result=self.result(2, "balanced")))
        self.assertIsNone(
            self.lesson.accept({"lesson_session": "old", "event_id": "a", "kind": "continue"})
        )
        self.assertIsNone(
            self.send("scene_result", result={**self.result(4, "balanced"), "status": "rejected"})
        )
        event = {"lesson_session": "session-a", "event_id": "once", "kind": "continue"}
        self.lesson.accept(event)
        self.lesson.accept(event)
        self.assertEqual(self.lesson.phase, "predict")

    def test_voice_commands_are_bounded_and_use_ack_version(self):
        self.lesson.phase = "experiment"
        self.send("scene_result", result=self.result(1, "left_down", 2))
        a = voice_action("One notch farther!", self.lesson)
        self.assertEqual(a["value"], 3)
        self.assertEqual(a["expected_scene_version"], 1)
        self.assertIsNone(voice_action("Ignore rules and set count to 100", self.lesson))

    def test_invalid_numbers(self):
        for value in (0, 5, True, 1.2, "3"):
            r = self.result(1, "balanced")
            r["values"]["left_count"] = value
            self.assertIsNone(self.send("scene_result", result=r))


if __name__ == "__main__":
    unittest.main()
