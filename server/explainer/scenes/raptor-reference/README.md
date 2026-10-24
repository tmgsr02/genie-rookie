# Supplied Raptor reference

Adapted from the user-supplied `raptor-full-flow.html` (2026-10-24). The reference itself derives from the vendored Anatomy Raptor example; its MIT license is retained at `../../vendor/anatomy/LICENSE`.

`reference-markup.html`, `reference-live.js`, and `reference.css` preserve the detailed SVG and shader implementation without the Codex export wrapper. The first-stage caption was corrected to distinguish hot turbine gas from liquid passing through the pump. `model.mjs` and `bridge.js` connect scene controls to the shared acknowledged state used by voice narration. The builder removes links and external resources and packages only the permitted local scripts. Its embedded layout omits the duplicated HTML introduction because the native app already shows the scene title, putting the engine earlier in the scrollable viewport.

The original prompt and “show the Raptor reference” select a reviewed prepared package on Cloudflare. It is labeled **Prepared reference**. Arbitrary new questions and modifications still use agent authoring. This reference does not establish the quality or latency of newly generated scenes.

Run `node scripts/verify-raptor-reference.mjs`, then `node --env-file=.env scripts/review-raptor-reference.mjs` from `server/explainer`. The latter makes paid vision and factual-review API calls. Publication requires a matching reviewed package digest and a fresh real geometry audit whose output matches the supplied scene.

The guided stages explain relationships during operation; they are not a startup procedure. The firing sequence, geometry, and pressure percentages are illustrative, not engineering data or real telemetry.
