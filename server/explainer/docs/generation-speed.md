# Generation latency work (2026-10-24)

The previous mathematical fractions run took 266,481 ms in the hosted shell author. The previous isometric dial run took 779,744 ms. Its two authoring responses used 85 shell calls, including 22 standalone `true`/`echo` no-op calls, and 57,556 output tokens. The first response exhausted its 30,000-token budget. The shell-only worker was asked to inspect images despite having no image-viewing tool. Both the mounted skill and its byte-identical mirror were offered for reading.

## Changes

`author-prompt.mjs` now tells the hosted worker exactly which tools exist. It prohibits no-op attempts to call an image viewer, requires truthful screenshot limitations, asks it to read one skill copy and relevant references once, and limits geometry repairs to two targeted passes. Real Anatomy geometry and delivered line checks still apply. Hosted authoring now has 32 tool calls and 18,000 output tokens per response, with the existing single continuation ceiling.

The optional direct author uses a strict Responses envelope for new, topic-specific 2D HTML/SVG and model JavaScript. It has no execution tools and cannot claim executed commands or Anatomy provenance. It does not use fixtures or a fixed lesson catalogue. Every scene still passes package normalization and the existing independent, network-disabled hosted browser validator. It must preserve the intent's representation exactly; explicit isometric intent remains on the Anatomy path. One targeted repair is allowed. Cancellation and provider errors do not start repair loops.

The direct path is opt-in using `HOSTED_AUTHOR_MODE=direct`; one real end-to-end sample now passes. The existing shell author remains the default. `FAST_AUTHOR_MODEL` defaults to `gpt-5.4-mini`; `FAST_AUTHOR_REASONING` defaults to `low`. The direct response is capped at 12,000 tokens. `HOSTED_AUTHOR_MODE=shell` uses the hosted shell author for every representation. Planner guidance prefers compact 2D interactions when they teach the requested concept and honors explicit isometric requests.

## Actual paid experiments

Initial experiments failed safely. A later authorized verification, after fixing the contract guidance and portable worker, passed end to end:

| Run | Elapsed | Result | Evidence |
| --- | ---: | --- | --- |
| 1 | 24,597 ms | Rejected before browser validation: the model added `description` inside the reserved pause input schema. Both responses had the extra field. | `artifacts/generation-speed-failed-1/` |
| 2 | 19,666 ms | Rejected before browser validation: test-case names were descriptive titles instead of exact executable control names. | `artifacts/generation-speed-failed-2/` |

A third authorized job failed in 50,621 ms: an invalid boolean invariant was repaired, then two validation dispatches returned incomplete shell-output records. Evidence is in `artifacts/generation-speed-failed-3/`. The service rejected all these runs. Instructions now explicitly cover exact reserved schemas, control names in test cases, and boolean invariants. The existing single retry for incomplete validator dispatch now uses `gpt-5.4` rather than repeating the same mini model. No validation gate was relaxed.

The fourth job passed on its first author response: **40,751 ms generation time** (40,755 ms wall), versus the saved fractions baseline of **266,481 ms**: **6.54× faster in this one sample**. The author response took 11,661 ms and completed real hosted validation at 26,262 ms; screenshots/downloads and cleanup were included in the final 40,751 ms. Total usage was 4,132 input and 3,406 output tokens. The actual gate passed five cases in normal and reduced-motion modes, visible readouts, real touch controls, schema and resource checks. Screenshots were subsequently inspected by the implementation agent. This is one same-learning-goal comparison, not a latency distribution or proof of general quality equivalence. Successful evidence is in `artifacts/generation-speed/`, including `result.json`, authored package, execution records and both phone screenshots. No fixtures were used and encrypted reasoning blobs are omitted.

To run one fresh end-to-end check, use `node --env-file-if-exists=.env scripts/benchmark-generation.mjs` in `server/explainer`. It reads the server-only key from `.env`, performs actual generation and hosted validation, saves the authored package and screenshots if successful, and compares generation time with the saved fractions baseline. Preserve or relocate existing artifact directories first because the script uses a stable output directory.

## Verification and limits

The focused generation/hosted test suite has 16 passing tests, covering failed validation, bounded repairs, cancellation, exact command verification, truthful direct provenance, representation mismatch, and both observed contract errors. The unchanged browser tests passed during the shared-worktree full run. The final shared backend suite passed 77/77 tests after durable-service integration and validation diagnostics fixes.

One successful new live scene demonstrates a same-goal latency improvement; general latency and quality claims need more samples. Isometric prompt/budget changes were not live-benchmarked; the tighter budget may cause complex scenes to fail sooner. Human visual review and independent educational correctness remain separate from executable/browser validation.

## Cloudflare portability

`src/hosted-worker-core.mjs` is the portable implementation. `src/hosted-worker.mjs` is a Node adapter supplying filesystem-built assets and `process.env`. The core receives its configuration and assets explicitly and does not import the Docker worker, filesystem, child processes, or Playwright. `package.mjs` imports a generated literal of the trusted browser runtime instead of reading it at startup. `scripts/build-runtime-source.mjs` regenerates that literal; a test verifies byte equality.

Cloudflare imports `createHostedWorker(env, options)` from `cloudflare/hosted-assets.mjs`. It requires `nodejs_compat`, the server-only OpenAI key in `env`, and an R2 binding named `HOSTED_ASSETS`. The factory loads the immutable key in `hostedAssetManifest.tooling`, checking both byte count and SHA-256 before upload to the provider. `node scripts/build-cloudflare-hosted-assets.mjs` builds `.work/cloudflare/tooling.tar.gz` offline and updates the tiny checked-in manifest. The archive is approximately 18.6 MB, so it belongs in R2 rather than the Worker code bundle. It includes the full pinned Anatomy mirror, audited browser validation code, and portable browser dependencies. Rebuild and upload the new hash-keyed object whenever those sources change; no runtime local container or build process is required.

The schema validator now interprets the explicitly supported dialect rather than using Ajv's runtime `new Function`. Dynamic author-created schemas cannot all be precompiled offline. Tests compare the interpreter with Ajv across 240 combinations of bounded values and verify additional properties, nested arrays, enums, Unicode lengths, malformed schemas, and operation with `Function` disabled. Existing package and browser consumers retain the same `compile`/assertion interfaces.

A real local Cloudflare `workerd` request exercised the factory, contract validation, and package fingerprint and returned HTTP 200 in 14 ms. A minimal Wrangler deployment dry run bundled this path at 1,020.95 KiB raw / 168.16 KiB gzip. These are portability checks, not evidence of a public deployment or successful cloud generation.

Public deployment and native playback results are recorded in [the Cloudflare deployment guide](../../../docs/newcloudflare-deployment.md). One subsequent public fraction generation was rejected by validation; its original failing check was not retained. Bounded per-attempt validation diagnostics now preserve fixed error/check codes without logging generated content, and rejected structured results retain actionable repair details. The successful 40.8-second benchmark is not a guarantee that every generation succeeds.
