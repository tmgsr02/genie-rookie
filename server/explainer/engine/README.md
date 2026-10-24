# Scene engine (prototype)

A model writes a short **scene description** instead of a program. A prebuilt engine turns it into a live Anatomy-style figure in the page. The description is a stream of JSON lines: parts from a catalog, values, formulas, controls, a readout and the lines the characters say. Parts appear as their lines arrive, and a follow-up question is just a few more lines applied to the same live scene.

Because the engine and catalog are written and proved once, a scene needs no generated code. Checking it takes milliseconds of deterministic work plus the existing browser validator.

## Files

| File | What it is |
| --- | --- |
| `expr.mjs` | Formula parser and evaluator. Descriptions come from a model, so formulas are parsed, never run as JavaScript. |
| `catalog.mjs` | The parts: bench, post, arm, spring, mass hanger, ruler, pointer, block, dial, tank, lever and lamp. Each is built from the vendored Anatomy kit and declares its parameters, mounts, bounds and drawing. |
| `describe.mjs` | The description format: applying ops as they stream, the reducer, the runtime contract, whole-scene checks and the line reader. Shared by Node and the browser. |
| `engine.mjs` | The in-page compiler. It builds parts as ops arrive and eases values on a damped spring. Only parts whose resolved values changed are redrawn, and the drawing order is kept. |
| `browser.mjs` | Browser entry (the `SceneEngine` global) and `boot(ops)`, which registers a description with the trusted `runtime.js` bridge. |
| `package.mjs` | Description → explainer package: `index.html`, plus `scene.js` (the engine and the description), the manifest and one test case per control. |
| `prompt.mjs` | The describer's instructions, generated from the catalog. |
| `describe-live.mjs` | Streams a description from a real model, then packages and validates it. Costs one model call. |
| `demo.mjs` | The end-to-end stream demo page. |
| `validate.mjs`, `preview.mjs` | Run the service's browser validator on a description, or write it as a standalone page. |
| `examples/` | `spring-scale.jsonl`, its follow-up `spring-scale-two-springs.jsonl`, and the unrelated `tank-pressure.jsonl`. |

## Commands (from `server/explainer`)

```sh
node engine/build.mjs                                     # bundle dist/engine.js and dist/engine.css
node engine/validate.mjs engine/examples/spring-scale.jsonl engine/examples/spring-scale-two-springs.jsonl --out .work/engine-check
node engine/demo.mjs                                      # .work/engine/stream-demo.html (?tps=120&ttft=600&wps=2.6)
node --test test/scene-engine.test.mjs
node --env-file-if-exists=.env engine/describe-live.mjs "Why do heavier things stretch a spring more?"   # paid
```

## In the service

`src/describer-worker.mjs` is the fast path for isometric intents, in the local Node server (`src/worker-factory.mjs`) and the Cloudflare generation workflow (`cloudflare/index.mjs`).

1. The model streams a description from the planner's intent. Revisions send the current description and ask only for the lines to change.
2. One repair turn sends rejected lines and failed checks back, with the parts' positions.
3. `packageScene` packages the description, and `normalizePackage` checks it.
4. Every control's test case is replayed through the engine's reducer and schemas.
5. Locally, the full browser validator also runs.

Anything else, or a description that still fails, falls back to the existing author. Set `DESCRIBER_MODE=off` to disable the fast path, and `DESCRIBER_BROWSER_CHECK=false` to skip the local browser check. The Worker imports the engine from `dist/engine-source.mjs`; rebuild it with `npm run build:engine`, and a test fails if it is stale.

### In the app (iOS Simulator, local service)

`/anatomy explain how a space rocket works, interactive`, asked in the app's text box, was ready about 33 s after sending. That includes the planner, the describer, the browser check and the app loading the scene. The scene rendered in `WKWebView`, Genius and Rookie narrated it, and tapping the scene's launch button lit the flame and lifted the rocket. One earlier attempt failed its package check and fell back to the hosted author as designed (cancelled there to save cost).

### Batch (`engine/batch.mjs`, 12 varied questions, one at a time, browser check included)

- **Pass rate:** 9 of 12, 6 on the first try.
- **First part on screen:** median 9.3 s, slowest 10% at 15.5 s.
- **Ready:** median 17.6 s, slowest 10% at 31 s.
- **Failures:** parts sinking through the bench at extreme values. The repair turn is now told which value causes it, so the batch hasn't been re-run since.
- **Fixes made because of this batch:**
  - every part's real mount names are listed in the prompt,
  - bad cues are dropped instead of the whole line,
  - the bench grows to fit,
  - a default readout is added when one is missing,
  - the output cap is now 8,000 tokens,
  - lift moves a stack once.
- **Concurrency:** running 4 questions at once tripled the time to first token, probably from API throttling.

## Measured on this machine

- Bundling the engine takes 50–160 ms and produces 71 KB of script. Packaging a description takes 2–8 ms.
- The service's browser validator passes for all three example packages in 1.3–3.8 s. That covers the package contract, every control's model and readout, touch, reduced motion and the Anatomy line check, with 0 floating ends out of 138–238.
- A description is 1–2.4 KB, about 300–650 output tokens. The hosted dial took 57,556 output tokens. The describer's instructions are about 2,000 tokens and the same on every call, so they can be cached.
- In the stream demo at a simulated 120 tokens/s with 600 ms to the first token, the first part appears about 1.9 s into the stream. The whole spring scene is in place by about 6.4 s, while the opener is still being spoken.

## Not done yet

- **One live model run, and it failed its checks.** gpt-5.4-mini at low reasoning, for "Why does a seesaw tip down on the side with the heavier kid?":
  - **Timing:** first token at 5.1 s (about 500 reasoning tokens came first), first part at 5.95 s, full description at 8.8 s. That was 1,147 output tokens.
  - **Why it failed:** the prompt's `"set":{"value":…}` placeholder was taken literally, and one cue highlighted a value instead of a part. The placeholders are now written as `<value name>`.
  - **After a hand fix:** with only that key fixed, the stage was still too short for the tallest stack. The stage guidance is now stricter. With the stage raised by hand as well, the model's scene passed the full browser validator.
  - **Second run (fixed prompt, same question):**
    - **Timing:** first token at 3.1 s, first part at 3.2 s, ten valid lines by 4.6 s.
    - **What went wrong:** the model wrote a formula inside `at` (`[-arm_len,0]`), which isn't JSON, and mounted blocks on a lever. That crashed the line reader, a bug that has since been fixed: a bad line is now reported and skipped, and the raw stream is saved.
    - **Prompt and catalog:** both now say that `at` and `params` are plain numbers and that nothing mounts on a lever.
  - **Third run:**
    - **Timing:** first token at 6.3 s (about 1,000 reasoning tokens first), first part at 6.9 s, full description at 10.8 s. That was 1,819 output tokens.
    - **Lines:** all 16 lines were accepted.
    - **What failed:** one check, `off_stage:see_saw`. The model couldn't know how tall stacked lever blocks get.
    - **The fix:** the engine now grows the stage from the parts' exact sizes (`stageOf`) instead of failing. It only rejects parts that overhang the bench or sink below the floor.
    - **Result:** with that change, the model's unmodified description passes the full browser validator, with 0 floating ends out of 152.
    - **Also fixed:** a long readout ran off the card's left edge, which the validator's overflow check doesn't see. Readouts now wrap, and the prompt asks for short ones.
  - **Rocket run ("Explain how a space rocket works, interactive"):**
    - **Timing:** first line at 6.9 s, all 19 lines accepted by 10.7 s.
    - **What it drew:** the catalog has no rocket parts, so the model stacked a tank, a lamp as the "flame" and a gauge on a box.
    - **What it exposed:**
      - Readouts with doubled spaces failed the validator's text match; readouts are now normalised.
      - A validator crash lost the result file; it is now caught.
      - The overlap check exempted parts that share a mount; it no longer does, and this scene is now rejected for overlap.
    - **The lesson:** the engine is only as open-ended as its catalog.
  - **Rocket run after adding rocket parts** (launch_stand, combustion_chamber, nozzle, flame, propellant_tank, nose_cone, fins, turbopump, pipe; plus pipe ends that name mounts, animated parts and a `lift` on every part):
    - **Timing:** first token at 8.4 s (about 900 reasoning tokens first), first part at 9.3 s, full description at 13.5 s. That was 22 lines, none rejected.
    - **What failed:** one check, `stage_too_large`, because the model lifts the rocket 240 units at full throttle.
    - **The fix:** lift no longer grows the stage, so a rising part may fly out of the picture, and the card clips the drawing. With that, the unmodified description passes the full browser validator.
    - **What's still weak, and the checks can't see it:**
      - The physics is loose: lift is proportional to thrust, with no weight threshold.
      - The readout units are odd ("Thrust 120 mm").
      - The scene skips the turbopumps.
    - The hand-written `examples/rocket.jsonl` shows what the parts can do.
  - **Not yet measured:** pass rates over many questions, and how much time to first token varies (3.1–6.3 s across these runs, depending on how long the model reasons first).
  - Evidence is in `.work/engine-live/`.
- **The app can't stream yet.** In a package the description is complete before the scene registers, because the runtime's contract is fixed at `register`. Streaming parts into the app needs one native addition, for example `ExplainerRuntime` calling `window.explainerStream(op)`. Delivering each follow-up as a new package version works today.
- **Drawing order is approximate.** Parts are ordered by one anchor depth each, which works for apparatus on a bench. Unlike the Raptor's per-pair proof, it would mis-order parts that wrap each other in unusual ways.
- **Not checked in WebKit.** The installed Playwright WebKit build is older than Playwright expects, and nothing was downloaded. The app's `WKWebView` hasn't run this.
- **Touch is tap only.** A part maps to one control, with no dragging yet.
- **The catalog has 12 kinds.** That's enough for mechanics and fluids on a bench. Other subjects need more kinds and other scaffolds, such as a timeline, a map, a cutaway or a number line.
- **One validator gap.** In the normal-motion pass, the line check runs before parts finish arriving, so it sees no lines. Only the reduced-motion pass checks them.
