# Standalone extraction verification — 24 October 2026

These checks ran in the new standalone checkout, before its initial publication:

- Genie-only project generation with required managed HTTPS service configuration: passed.
- Debug iOS Simulator Xcode build: passed, using a new derived-data directory.
- App Python, packaging, speech-recognition configuration and generation-conversation checks: 22 passed; one inherited Pipecat deprecation warning.
- Legacy balance model: 261 worked/exhaustive states plus stale, duplicate, bounds, session and action-schema checks passed.
- Complete backend suite including browser checks: 162 passed, zero failed or skipped.
- Credential-pattern and known-server-secret scan of the intended export: no matches. This is a bounded scan, not a security certification.

The native build reused existing local downloaded models, compiled libraries, embedded Python framework and permitted local test voice files. These dependencies and voices remain ignored and are not part of the public repository. This is an extracted-checkout build on the development Mac, not an independent second-Mac or fresh-download test. No device microphone, installation, live-provider generation or deployment was performed during extraction.

Existing vendored source and the pinned Pipecat patch retain their original whitespace; the patch was not reformatted because its bytes are part of dependency validation. Product runtime behavior was not rewritten for this extraction. The recorded results apply to this source snapshot; subsequent changes need their own verification.
