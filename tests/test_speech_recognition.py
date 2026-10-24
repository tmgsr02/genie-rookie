"""Check Genie & Rookie's on-device speech compatibility without a microphone."""

import subprocess

from support import CHECKS, ROOT, build_swift, needs_swift


@needs_swift
def test_on_device_speech_model_fallback(tmp_path):
    binary = build_swift(
        tmp_path / "speech-recognition-checks",
        [
            ROOT / "apps/GeniusRookie/src/ios/PipecatVoice/SpeechRecognitionConfiguration.swift",
            CHECKS / "SpeechRecognitionChecks.swift",
        ],
    )
    result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "SPEECH_RECOGNITION_CHECKS_PASSED" in result.stdout
