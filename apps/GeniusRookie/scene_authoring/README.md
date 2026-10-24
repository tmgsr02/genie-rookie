# Balance bench authoring and verification

This is an Anatomy **Figure**: one balance mechanism, 41 static solids plus 12 carrier parts and four initial weight blocks (57 purposeful solids). No WebGL or optional 3D renderer. The native characters continue using the inherited Canvas, FaceRig, StageSimulation and lipsync pipeline.

The metaphor is literal: equal blocks in movable trays on a beam, a central pivot, equal notch markers, supporting bearing plates and a bolted bench. The quantity that determines the result is block count × distance on each side. A limited eased tilt shows direction only, starting each new trial from horizontal; it is not an angular physics simulation.

## Parts and tooling

Base: four feet, four mounting shoes, bedplate, inset top, four screw seats, engraved label plate. Structure: two support shoes, two posts, four post bolts, rear keeper bearing. Mechanism: beam, ruler strip, two end stops, eight notch inlays, zero mark, front keeper plate, axle cap, two bolts. Subject: two trays each with a plate, four lips and handle; one to four identical stacked blocks per tray.

The shared authoring kit is vendored at `server/explainer/vendor/anatomy`. The runtime uses its core SVG helpers copied as `LessonScene/kit.js`, with MIT notice in `LessonScene/ANATOMY_LICENSE`. `build.mjs` computes static SVG with `fitProjection`, `slabOf`, `solidSvg`, `planOutline`, `lineSvg`, `dotsSvg`. Runtime carriers use the same geometry helpers. Cuboid/radiused slab parts and printed marks avoid pipes, lathes and free crossing routes; no round-parts clearance audit is claimed.

Run from repository root:

```sh
node apps/GeniusRookie/scene_authoring/build.mjs
node apps/GeniusRookie/tests/scene_model.test.cjs
uv run --no-sync pytest apps/GeniusRookie/tests -q
node server/explainer/vendor/anatomy/scripts/drive.mjs apps/GeniusRookie/src/ios/PipecatVoice/LessonScene/index.html --actions apps/GeniusRookie/tests/browser-actions.json --width 390 --height 1100
```

`model.js` is the sole physics authority. `lesson_engine.py` never repeats its arithmetic: it consumes acknowledged results and owns wonder → predict → experiment → observe → explain → transfer → finish. The standalone HTML is an apparatus authoring preview, explicitly labelled; the complete lesson flow runs in the native app with embedded Python.

## Contract boundary

`Balance.fromEnvelope(envelope, session, turn)` strictly adapts the blueprint public schema to a local scene action. In this single-scene lesson, `expected_world_version` equals `expected_scene_version`. Public `distance`/`block_count`/`preset` map to local `value`/`value`/`setup`. The native touch bridge uses the local action format and a separate lesson session so no microphone session is needed. Bounded voice phrases are parsed in Python (not by generated JavaScript), carry current acknowledged scene version and audio turn fencing, and are sent through the same scene application path.

Scene actions are finite allowlisted types with exact property sets. Numbers are bounded integers. An action ID is applied once; conflicting reuse is rejected. Old scene versions and old sessions are rejected. Native accepts only its exact bundled main-frame file URL, blocks navigation, uses a nonpersistent WK data store, and passes dictionaries through `callAsyncJavaScript` arguments. CSP forbids network, external scripts and forms. A touch event or progression intent stops stale speech through the inherited interruption path.

## Privacy and pedagogy

The three progress flags stored locally are experiment tried, explanation with hint, and transfer attempted. Child transcripts default off; no explanation/prediction text or raw audio is retained by the lesson. Typed explanation is deliberately ungraded; it receives a neutral confirmation with accessible choices. Contact import was removed. Restart is offered only from Grown-up settings with a confirmation that clears saved learning flags; the finish screen directs the child there. New conversation leaves lesson progress unchanged. This is an adult-facing confirmation, not parental authentication. An optional nickname may appear in generated dialogue sent to Boson, disclosed in settings. Native review metadata is kept out of the child-facing flow.

This lesson remains `draft_requires_science_and_family_review`. The apparatus is built and tested, but no claim of proven learning effectiveness, family review, or production approval is made. Ages 7–10 and the 5–8 minute duration remain design assumptions. Full spoken directions, formal accessibility/family testing, device speech quality and provider credentials require their separate acceptance checks.

## Results

- Five Python contract tests pass: phase cycle, all predictions accepted, stale/duplicate/session/result fencing, strict values, and bounded voice commands.
- JS passes five supplied worked examples, all 256 legal states, invalid bounds/types/entities/actions, stale versions, idempotency/conflicting IDs, unknown arguments and public-schema translation.
- Native iPhone 18 Pro Simulator Debug build succeeded. `--lesson-smoke -welcome-seen YES` drove actual WKWebView → native → embedded Python through the entire lesson, logged `GENIUS_LESSON_SMOKE PASS ... scene version 4`. The historical native log remains in the parent development workspace. Read unified logs with `xcrun simctl spawn booted log show --last 3m --predicate 'eventMessage CONTAINS "GENIUS_LESSON_SMOKE"'`; console stdout may buffer.
- Phone and desktop captures had no JS console errors or horizontal overflow; inspected phone, desktop and 4× mechanism detail. Increased projection and outline contrast after the first captures. Browser interaction checks pass for pause preserving pose, reset locked during observation, touch balancing, and keyboard movement. The Anatomy line check reports zero floating line ends in light and dark craft inspections. Slab contact/painter order inspected visually; no claim of a full round-parts audit.

The model fixture and scientific assumptions are bundled in `LessonScene/lesson.json`. Original sources: Science Buddies “Give It a Lift with a Lever” and Science in School “Balancing act: the physics of levers”, linked in that file. The product still needs independent science and family review.
