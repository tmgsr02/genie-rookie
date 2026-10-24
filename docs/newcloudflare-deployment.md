# Deploying your own backend

The checked-in native configuration targets the existing shared demo. Running source builds does not require deploying a backend or providing provider keys to the app.

For your own service, use `server/explainer` and its README. Install Node dependencies, configure your own server-side OpenAI and Boson credentials, provision the hosted authoring environment, and build the tooling with `npm run build:cloudflare`. Use the existing scripts to prepare hosted asset manifests and upload the matching tooling to your own private R2 bucket before deploying.

`wrangler.jsonc` intentionally omits the original account ID. Set resource names and bindings for your own account, provide `OPENAI_API_KEY` and `BOSON_API_KEY` through Wrangler secrets, then deploy with the normal Wrangler workflow. The checked-in hosted manifests describe the original deployment's artifacts and are not portable access grants; regenerate them for your account. The private coordinator routes must remain internal.

After verifying your service, update the two public HTTPS URLs in `apps/GeniusRookie/app.json` and regenerate the project with `--require-hosted-services`. Never put provider keys, session tokens or bootstrap secrets in app.json, source control or the app bundle. `.env.example` contains configuration names only.

The demo uses bounded sessions, generation jobs and shared quotas. Confirm actual speech, scene generation and native playback separately after deploying; a successful health check is not a full end-to-end test.
