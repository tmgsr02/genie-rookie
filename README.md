# Genie & Rookie

A native iPhone learning prototype that turns questions into interactive explanations, with two expressive characters who talk through what changes as you explore.

Built for the Boson AI Higgs Audio Hackathon 2026. This repository contains only the Genie & Rookie application, its tutoring backend, scene tools, and supporting build code. The Xcode project and scheme retain the technical name **GeniusRookie**.

## What it does

- Accepts questions through native voice or text input.
- Coordinates Genie, the guide, and Rookie, the curious learning companion.
- Uses a cloud planner and asynchronous worker to author or revise interactive explanations.
- Runs validated scene packages in a constrained WKWebView and grounds dialogue in acknowledged scene state.
- Streams **Higgs TTS 3** for both characters through a server-side gateway. Genie uses `chloe` with amusement; Rookie uses `marcus` with enthusiasm.
- Includes a prepared Raptor rocket-engine reference, explicitly distinguished from newly authored scenes.

Higgs provides speech synthesis. Apple provides speech recognition; OpenAI services provide planning and scene authoring. Characters and playback are native. This project does not use Higgs Realtime or Higgs Avatar.

## Build the iOS app

Requirements: Apple-silicon Mac, macOS 27, Xcode 27, Python 3.13 via uv, and Rust. Use an iOS 27 Simulator for text input, or a supported physical device for microphone testing. Choose your own signing team for a device build.

The source checkout excludes downloaded models, compiled libraries, Python frameworks, credentials and custom Phonon voice binaries. The current runtime still requires two local Phonon voice assets at build time, even when Boson is selected. Follow [voice asset setup](apps/GeniusRookie/src/voices/README.md) before running setup. These assets must be obtained separately with the required permission; they are not supplied by this repository.

From the repository root:

```sh
python3 scripts/download_models.py
uv sync --locked
uv run --no-sync python scripts/setup.py
python3 scripts/generate_project.py --app GeniusRookie --require-hosted-services
open GeniusRookie.xcodeproj
```

Select the **GeniusRookie** scheme and build/run. `setup.py` now generates only this project's Xcode target. The app's public service configuration is in `apps/GeniusRookie/app.json`; it points to the existing managed demo service and obtains short-lived access automatically. Provider keys stay on the server. Availability and capacity of that shared service are not guaranteed.

To build without device signing:

```sh
xcodebuild -project GeniusRookie.xcodeproj -scheme GeniusRookie \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath .build/GeniusRookie CODE_SIGNING_ALLOWED=NO build
```

## Try these inputs

- `show the Raptor reference` — opens a prepared reference; select a component or change a guided stage to hear an explanation of that state.
- `Show two equal groups of three objects, with a control to change the group size and see the total.` — requests an authored explanation; output, latency and success vary.
- `Now show three groups and compare the totals.` — requests a follow-up change. Inspect the actual result rather than assuming the change succeeded.

Use text in the Simulator. Live microphone recognition and interruption need a physical-device rehearsal. New explanations and Boson speech require an internet connection. Phonon replaces synthesis only; it does not make cloud tutoring offline.

## Backend

The complete tutoring service is in [server/explainer](server/explainer/README.md). It includes the planner, authoring/validation pipeline, native scene bridge runtime, Boson gateway and Cloudflare deployment code.

```sh
cd server/explainer
npm ci
npx playwright install chromium
npm test
```

Tests use fixtures and mocks; successful tests do not establish live-provider reliability. For local operation, copy `.env.example` to `.env` only if you do not already have a configuration, supply your own server credentials, and follow the backend README. For a deployment to your own Cloudflare account, see [deployment notes](docs/newcloudflare-deployment.md). Nothing in setup automatically deploys to the shared service.

## App and packaging checks

After `uv sync --locked` and Pipecat setup:

```sh
uv run --no-sync pytest -q
node apps/GeniusRookie/tests/scene_model.test.cjs
```

The source repository is the judging source of truth. `scripts/package_geniusrookie_judge.py` can produce a separate convenience archive after dependencies are staged. That archive would include locally supplied voice assets, so its redistribution review must be resolved before publication. No judge archive is attached to this initial repository.

## Known limits

This is a hackathon prototype. Arbitrary scene generation can take tens of seconds to minutes and can fail. The Raptor reference is prepared content, not evidence of instant generation. Generated explanations require educational review. The hosted service has shared quotas. Prior simulator playback and backend checks do not prove microphone recognition, interruption or accessibility on every device. No demo video or verified TestFlight enrollment link is claimed in this initial repository.

## Team

- **Miguel Twahirwa** ([@tmgsr02](https://github.com/tmgsr02)) — all product design and development.
- **Neel Patel** ([@Neelpatel1604](https://github.com/Neelpatel1604)) — project review and demo support.

## Attribution and licensing

This project adapts [Little Voices](https://github.com/pipecat-ai/ios-little-voices), retaining its native SwiftUI, embedded Python/Pipecat, audio and character foundations. The original BSD 2-Clause [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) are preserved. See [provenance](docs/PROVENANCE.md) for the extraction boundary and attribution. Third-party components and assets retain their own terms.
