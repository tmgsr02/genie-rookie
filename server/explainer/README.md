# Genie & Rookie explainer service

## Managed Anatomy deployment

Cloudflare isometric jobs now use the **OpenAI Agents API managed Codex harness**, with an `openai_hosted` sandbox, pinned Anatomy v1 and Chromium declared as a system package. `/anatomy` at the start of a typed question deterministically selects this path. Compact non-isometric lessons retain the direct Responses path; the local Node server below retains its existing HostedWorker adapter.

The Workflow creates a session without input, recovers ambiguous creation by job metadata, checkpoints the ID, and submits input with a stable events-endpoint idempotency key. Live testing showed session creation itself does not deduplicate that header. Short checkpointed status polls and durable sleeps replace the long authoring stream. Recurring provider polls and cleanup run through private coordinator requests because Cloudflare’s free-tier external request allowance applies across the Workflow invocation, not separately to each step. These requests release the coordinator mutation queue before provider I/O. Cleanup falls back to the Workflow’s retained remote ID if coordinator state has expired. Exceptional repeated recovery scans can still consume the Workflow’s remaining outbound allowance. Only a completed root turn's matching `/workspace/outputs/gr-result.json` artifact is collected; schema checks and the separate trusted validator must pass before publication. Cancellation/timeout delete the managed session. An ambiguous session creation can leave an unused sandbox if it cannot be recovered; it does not start inference.

Generation events and job responses optionally include `progress: {phase, elapsed_ms}`. Phases are `preparing`, `authoring`, `checking`, and `publishing`; they contain no raw model output. Native clients also accept legacy events without progress. There is no percentage or completion-time prediction.

Maintainer setup after changing portable tooling:

```sh
npm run build:cloudflare
node --env-file=.env scripts/setup-agents.mjs
```

Upload the generated tooling archive to the R2 key in `cloudflare/hosted-manifest.mjs` before `npm run deploy:cloudflare`; the independent validator still uses R2. `cloudflare/agents-manifest.mjs` records the corresponding OpenAI Files resource. The worker rejects a mismatched tooling digest. Provider keys stay in Cloudflare secrets and are never included in the sandbox or app. See [deployment instructions](../../docs/newcloudflare-deployment.md) for deployment portability notes. Source checkouts require the dependencies and voice assets described in the root README before building the Xcode project.

The SDK documents `spend_control`, but the live API rejected it during verification; it is omitted. Existing application quotas and a 20-minute managed authoring deadline remain enforced. Runtime capability and artifact checks are covered by tests and live preflights; live lesson acceptance is tracked in [standalone verification](../../docs/VERIFICATION.md).


This is the real open-ended generation path: a shared conversational planner designs educational intent and semantic tools, and a separate asynchronous worker authors executable scenes. Cloudflare Workers serves the app, Durable Objects persist session state and shared demo quotas, and Workflows run generation. Compact 2D scenes use direct model authoring followed by independent hosted validation; explicitly isometric scenes use the OpenAI hosted shell and full pinned Anatomy skill. Production never imports the test fixtures.

## Cloudflare demo

The deployed HTTPS service is [genie-rookie-demo.genie-rookie.workers.dev](https://genie-rookie-demo.genie-rookie.workers.dev). Tutor and Boson speech use this same origin. The native app obtains short-lived access automatically; judges build and run the supplied Xcode project without setting up a server, entering a URL/token, or obtaining a provider key.

See the [Cloudflare deployment and operations guide](../../docs/newcloudflare-deployment.md) for bindings, private R2 assets, secrets, quota settings, deployment status, and verification boundaries. A deployed endpoint is not by itself proof of a complete native voice/generation run.

The public demo has shared UTC daily limits of **40 generation jobs, 300 planner calls, and 100,000 speech characters**, plus six jobs per tutor session and bounded pending work. Failed or cancelled admitted work consumes its reservation. These are shared cost controls, not individual user accounts. Session credentials are valid for one hour; state survives coordinator restarts and expired sessions are pruned on subsequent requests. This is a bounded prototype using one named tutor coordinator, not a horizontally partitioned production service.

## Optional local development

Requires Node 22+, `tar`, `zip`, connectivity, and a server-side OpenAI API key with access to the configured models, hosted shell, and Skills API. The default worker does not require Docker or a locally installed browser.

~~~sh
cd server/explainer
npm ci
cp -n .env.example .env  # Preserve an existing .env and its credentials.
# Set the server-only OPENAI_API_KEY in .env.
npm run setup:hosted
npm run verify:hosted
npm start
~~~

Keep your local credentials in the Git-ignored `server/explainer/.env`. `npm start` and `npm run verify:live` load the service `.env` automatically. Keys stay in the server process or Cloudflare secret bindings; neither OpenAI nor Boson credentials are uploaded into hosted execution environments. The Node adapter also exposes the managed Boson gateway when `BOSON_API_KEY` is configured.

This standalone repository uses the Node/Cloudflare speech gateway; the older separate Python proxy is not included.

The local Node address defaults to http://127.0.0.1:8787. Local tutor bootstrap can use `BOOTSTRAP_TOKEN`; local voice-grant creation requires a configured bootstrap token unless public demo mode is explicitly enabled. Non-loopback Node binding requires bootstrap authentication or `PUBLIC_DEMO_ENABLED=true` with an absolute persistent `DEMO_USAGE_PATH`. The latter uses an atomic single-process usage ledger and must not run multiple replicas. The Cloudflare deployment uses Durable Object storage instead of this filesystem ledger. Local Node/Docker commands are development alternatives, not runtime dependencies of the deployed Worker.

The full Anatomy repository, examples, kit, references, scripts and original MIT LICENSE are vendored at vendor/anatomy, pinned to commit **1482e8469b0a9e0d8cc18ea2740a01423d29ae80** (vendor/anatomy.commit). npm dependencies use exact versions and a lockfile. `setup:hosted` uploads all 173 skill files, including the MIT license, and stores the immutable skill ID/version and content digest in ignored `.work/hosted-skill.json`. Repeated setup reuses an unchanged version. Provision once per API project/deployment and persist that file, or set `HOSTED_SKILL_CONFIG` to its absolute path. Changed local skill contents require rerunning setup. The worker refuses an absent or stale pin. For Cloudflare, the offline asset builder embeds the immutable skill descriptor in `cloudflare/hosted-manifest.mjs` and uploads the hash-pinned tooling archive to private R2; the runtime verifies its byte count and SHA-256 before use.

## Isolation and privacy

The default `EXPLAINER_WORKER=hosted` uses OpenAI-managed execution environments. Each shell-authoring job gets a new network-disabled environment with a pinned Anatomy skill. Direct 2D authoring has no execution tools and still requires the separate hosted validator. Validation gets a **different fresh network-disabled environment**, containing only the trusted tooling bundle and candidate package/audit sources. Only explicitly selected runtime dependencies and skill files are packaged: no environment files, provider SDK sessions, repository history, or host mounts. OpenAI supplies Node and Chromium; we supply pinned Playwright/Ajv and our validation code.

The service owns the API lifecycle, not a Docker image: each environment has 4 GiB memory and a 20-minute idle expiry, and is deleted in `finally` after success, failure or cancellation. Cleanup uses an independent request even after the job signal is aborted. Forced Workflow termination can interrupt that cleanup; environment expiry remains the backstop. A failed deletion emits a nonsecret operator event. The full job has a configurable deadline (15 minutes by default). Provider execution requests use `store:false`, zero automatic transport retries for authoring, and bounded output/tool-call budgets. A token-limited shell-authoring response can continue once in the same workspace (at most two 18,000-output-token responses, 32 tool calls each) under the same overall deadline. An unfinished or mismatched validation dispatch can retry once in a fresh environment; an actual failed scene check does not retry. Usage includes both attempts when reported. No automatic fallback hides a hosted failure.

Validation dispatches one exact trusted command and accepts only its matching, successful `shell_call_output`. Missing calls, extra commands, wrong environment/call IDs, nonzero exits, timeouts, malformed output and a model's prose cannot approve a package. The fixed command uses GNU timeout to enforce a 120-second execution limit independently of the model's tool timeout; uploads/API dispatch count against the overall job deadline. Hosted Chromium's managed URL policy stays intact. The validator renders supplied HTML directly on `about:blank`, replaces the two script URLs in their original parser positions with base64 data URLs containing the exact same bytes, authorized by matching SHA-256 CSP hashes and subresource integrity, embeds static SVG resources, and blocks all network requests. The original package and its native local-resource layout are unchanged. Dynamic relative resource loading is not supported by this inline validation mode and may reject such a scene. The actual vendored Anatomy line-end algorithm runs on the delivered DOM before generated Node audit code executes.

To explicitly use the retained local worker, set `EXPLAINER_WORKER=docker`, build `docker build -t genie-rookie-worker:local .`, then run `npm run verify:worker`. This path uses the Codex SDK, read-only image, no host mounts, dropped capabilities, 2 GiB memory, two CPUs, bounded processes and temporary workspaces. Only its authoring process receives the OpenAI key; the tool shell excludes it. Validation has no credentials or network. The scoped namespace seccomp policy and CA installation remain documented in `sandbox/README.md`. The hosted path does not use this image or seccomp configuration.

The service does not create raw child-audio or transcript logs. Its speech endpoint sends requested utterance text to Boson and streams audio back without recording it. The planner sees the current question and optionally actually heard lines transiently; provider-side retention follows the API account policy. The generation worker receives minimized educational intent and the prior scene for revision. Durable Object storage contains short-lived credentials, abstract educational summaries, acknowledged scene state, generated packages, dialogue/replay results, and job metadata. Tutor credentials expire after one hour; expired state is removed on subsequent coordinator requests, so this is not a guaranteed one-hour physical-deletion deadline. Usage counters contain aggregate counts, not transcripts. Transient hosted execution files disappear with deletion/expiry; the reviewed Anatomy skill remains in the managed Skills library and contains no child conversation. Cloudflare request metadata/observability and provider retention are separate from application transcript logging.

## Contract

All JSON is snake_case. Canonical schemas: src/contracts.mjs and src/package.mjs. Shared trusted reducer/bridge: runtime/runtime.js.

| Endpoint | Behavior |
| --- | --- |
| POST /v1/sessions, body {} | session_id, session_token, expires_at |
| POST /v1/sessions/:id/turns | Accept request_id, text, optional heard; return dialogue, commands, optional job_id/basis, metrics |
| POST /v1/sessions/:id/tools | Accept request_id, name, arguments |
| GET /v1/sessions/:id/events?after=N | Up to 20-second poll; events and cursor |
| GET /v1/sessions/:id/jobs/:job | Job status; package only when ready |
| POST /v1/sessions/:id/scene-events | Prompt acknowledgement; grounded dialogue follows asynchronously |
| POST /v1/voice-sessions, body {} | Short-lived `token` and `expires_at`; automatic in managed app builds |
| GET /v1/ready | Authenticated voice-format/configuration check; no paid synthesis probe |
| POST /v1/speech | `{text, voice}`; streamed mono 24 kHz PCM, `genius`/`rookie` voice mapping |
| GET /health | Nonsecret access mode, hosting and provider-configuration state |

Tutor session routes require their Bearer session token. Voice readiness/speech require a voice-grant Bearer token and `X-App-ID: genius-rookie`. Public demo session creation is anonymous only when explicitly enabled; no shared provider or bootstrap key is bundled in the app.

heard is at most 12 actually played lines with speaker genius, rookie or child, plus text. Planned speech is never assumed heard. A short abstract learning summary preserves clarification context without retaining the raw transcript.

Six application tools: create_explainer, revise_explainer, control_explainer, get_explainer_state, get_generation_status, cancel_generation. Schema source defines exact arguments; intent contains learning_goal, concept, interaction, representation, model_kind, assumptions and limitations. Commands contain session_id, scene_id, scene_version, request_id, expected_state_revision, name and input.

Generation events contain sequence, type:generation, job_id, status, scene_id and scene_version. Narration events contain sequence, type:dialogue, dialogue, basis and optional request_id/metrics. Always verify basis against current scene/state before speaking. Scene-event acknowledgement returns dialogue:[] and optional basis; narration is delivered as a dialogue event. The Node adapter returns the acknowledgement before planning finishes. The Cloudflare coordinator currently awaits the bounded narration call before returning the acknowledgement, keeping all mutation work within a live request.

Jobs support requested, generating, validating, ready, revising, failed and cancelled. A new request cancels its predecessor. The last acknowledged scene stays active until the validated replacement sends ready. Cancellation rejects a ready-but-unadopted candidate; native disables cancel during final acknowledgement/swap. Versions increase even across failed/cancelled revisions.

Request IDs are bounded idempotency keys: identical retries return the same result, conflicting reuse rejects. Runtime replays remain rejected even when the initial command failed. Session, scene/version, state revision and event fingerprints are checked. Identical state_changed after action_applied is accepted as a repeated observation. Changed state invalidates pending narration.

## Executable package and validation

Packages are UTF-8 JSON files, never ZIP:

~~~text
{scene_id,scene_version,entry:"index.html",files:{path:source},
 manifest:{title,learning_goal,model_kind,representation,assumptions,limitations,
           controls:[{name,label,input_schema}],state_schema},
 validation:{passed,checks,limitations},provenance,test_cases,authoring_report?}
~~~

At most 64 files/3 MB; constrained paths; HTML (index only), JS, CSS, SVG and JSON. Entry has exactly runtime.js then scene.js scripts. Server inserts trusted runtime, UTF-8 metadata and strict CSP. Inline script, event attributes, remote URLs, frames, links and forms reject; use inline style elements. Native independently restricts local resource loading, navigation and bridge capabilities.

The generated module registers initial_state, state_schema, controls, reduce, render, invariants and optional completed through ExplainerScene.register. Touch calls ExplainerScene.act; native calls explainerCommand. Both use the same reducer. State requires paused:boolean, initially false. Reserved pause input is {paused:boolean}; reset input is {}. Pause/reset update model state and runtime signals consistently. Animations must consult ExplainerScene.isPaused(), also true offscreen or under reduced motion.

Schemas use an intentionally bounded subset: explicit types, finite numeric bounds, string length limits, bounded arrays, closed objects and enums. Full arbitrary JSON Schema is not promised.

Validation loads actual code at 390×720 in normal/reduced-motion contexts, compares manifest/executable schemas, checks initial state, exercises every control, checks authored expected states, visible readouts, bridge/model agreement, replay rejection, real pointer input, overflow and runtime/network errors. Isometric packages also supply reproducible source: the fresh network-disabled environment independently reruns build.mjs --audit; browser validation runs the vendored Anatomy line-end algorithm on the delivered DOM. The Docker option additionally retains the lines.mjs CLI check. Failed checks block delivery. The validation command has a 120-second deadline; large scenes can fail honestly rather than skip checks.

These are authored tests, not independent proof of educational correctness, scientific truth, complete geometry audit coverage or high visual quality. Sources, assumptions and limits are recorded. Human screenshot review remains necessary. Reduced-motion loading and pause signals are tested; arbitrary JS motion is not yet pixel-proven motionless. Do not claim verified live Anatomy artwork before credentialed authoring and visual review.

## Cache, latency and cost

The local Node worker's memory-only validated cache holds at most 32 entries for one hour. Cloudflare Workflow dispatch does not use that cross-job cache; accepted jobs run the selected authoring/validation path. New outputs report authored, retrieval reports cache, fixture/reusable configurations report configured. No fake-authoring fallback exists when keys, hosted execution, the skill pin, or a model are unavailable.

Jobs report measured wall-clock milliseconds and provider token usage. Hosted metrics combine authoring and validation usage and identify the pinned skill. Hosted dollar cost is null because model rates and hosted-compute charges are not configured; it is never reported as free. The Docker option retains optional operator token-rate estimates; missing rates return null. Turn/narration metrics expose planner usage separately; planner dollar pricing is currently unavailable. Worker cost does not claim full conversational cost.

With `HOSTED_AUTHOR_MODE=direct`, one new fractions scene passed the full hosted gate in **40.751 seconds**, versus the saved **266.481-second** fractions baseline: **6.54× faster in one sample**. This is not a latency guarantee or a general distribution. Explicitly isometric Anatomy scenes remain on the slower shell-authoring path. See [generation-speed evidence and limits](docs/generation-speed.md).

## Verification

Host tests need their own browser installation; Docker browsers do not populate the host cache:

~~~sh
npm ci
npx playwright install chromium
npm test
npm run setup:hosted
npm run verify:hosted
npm run verify:live -- "Why does changing word order change meaning? Let me rearrange a sentence."
~~~

verify:live invokes the actual planner and selected worker on a runtime question with empty cache. Live attempts write `artifacts/hosted-live/live-result.json`, `live-package.json`, execution evidence, and downloaded phone screenshots. Set `LIVE_ARTIFACT_DIR` to keep separate runs. Without a key it exits 2 with an explicit blocker. Clarification is reported honestly rather than counted as authored content.

`verify:worker` makes no provider calls. It checks system TLS certificates, access to the installed Anatomy skill, successful sandboxed workspace writes, rejection of writes outside the workspace, and blocked tool network access. The explicit live smoke also saves generated output as `artifacts/hosted-live/live-authoring.json` for operator diagnosis if package validation fails; the production server does not retain that diagnostic artifact.

For an **explicit deterministic native regression harness**:

~~~sh
node scripts/fixture-server.mjs language
# mathematics and science are also supported
~~~

Fixtures are marked configured and clearly labeled; their simple diagrams do not claim Anatomy fidelity or open-ended authorship. Production never imports test/fixtures.mjs. Host screenshots appear in artifacts/{mathematics,science,language}.

## Hosted migration evidence

The deployed Cloudflare isometric path uses the Agents API as described above. The local Node HostedWorker adapter and independent validator still use Responses API hosted shell plus uploaded Skills. See [standalone deployment notes](../../docs/newcloudflare-deployment.md). The local SDK worker is retained only as an explicit deployment choice.

## Integration references

- [OpenAI Skills upload and versioning](https://developers.openai.com/api/docs/guides/tools-skills).
- [Hosted shell and managed environment lifecycle](https://developers.openai.com/api/docs/guides/tools-shell).

- [Official Codex SDK documentation](https://developers.openai.com/codex/codex-sdk) and [official TypeScript README](https://github.com/openai/codex/tree/main/sdk/typescript); integration checked against installed SDK 0.164.0 types.
- [Claude SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), reviewed as an alternative, not installed.
- [Boson Higgs Realtime tools](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling). These application tools remain independent of speech; Higgs TTS and Phonon do not replace the planner.
- [Anatomy repository/license](https://github.com/wheresryan22/anatomy).

To rerun only the hosted gate on a saved scene without paying to author it again:

```sh
node --env-file-if-exists=.env scripts/revalidate-hosted.mjs artifacts/hosted-live/live-package.json artifacts/hosted-live/live-authoring.json
```

This writes `revalidation.json` and fresh screenshots beside the input. It is labelled revalidation of a saved artifact, not a new generation.
