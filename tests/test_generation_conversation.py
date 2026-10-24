"""Check automatic character turn-taking without microphone or network access."""

import subprocess

from support import CHECKS, ROOT, build_swift, needs_swift


@needs_swift
def test_generation_conversation_schedule(tmp_path):
    binary = build_swift(
        tmp_path / "generation-conversation-checks",
        [
            ROOT / "apps/GeniusRookie/src/ios/PipecatVoice/GenerationConversationSchedule.swift",
            CHECKS / "GenerationConversationChecks.swift",
        ],
    )
    result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "GENERATION_CONVERSATION_CHECKS_PASSED" in result.stdout
