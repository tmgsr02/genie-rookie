# Genie & Rookie native app

The public name is Genie & Rookie; the project and scheme are `GeniusRookie`. The bundle ID is `com.migueltwahirwa.geniusrookie`.

Follow the [root setup guide](../../README.md). The native source is in `src/ios/PipecatVoice`, the embedded Python application in `src/python`, and the prepared balance regression scene in `scene_authoring`. `app.json` contains version/build numbers and public service URLs. Regenerate the project after adding Swift files or changing app configuration:

```sh
python3 scripts/generate_project.py --app GeniusRookie --require-hosted-services
```

Boson is the default speech provider. The managed app obtains short-lived tutor and voice access automatically. Apple speech recognition requires a supported physical device and available English assets; text input remains available. Phonon is local synthesis only; cloud tutoring still requires connectivity.

The legacy `--lesson-smoke` DEBUG launch is a balance regression fixture, not evidence of live scene generation. The Raptor reference is prepared content. New-topic generation and follow-up revisions use the cloud authoring pipeline.
