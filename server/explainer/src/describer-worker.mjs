// Fast generation path: a model streams a scene description, the prebuilt scene engine
// packages it, and the package is checked without running any model-written code. Isometric
// intents come here first; anything else, or a description that still fails after one repair,
// goes to the fallback worker (the existing author). Portable: no filesystem or child processes.
import OpenAI from "openai";
import { isDeepStrictEqual } from "node:util";
import { describeScene } from "../engine/describer.mjs";
import { packageScene } from "../engine/package.mjs";
import { initialState, readoutOf, reduce } from "../engine/describe.mjs";
import { normalizePackage } from "./package.mjs";
import { ajv } from "./contracts.mjs";

// Replays every packaged test case through the engine's reducer and the package's own
// schemas. The engine is trusted, so this proves the description's model is consistent.
export function replayPackage(desc, pkg) {
  const stateValid = ajv.compile(pkg.manifest.state_schema);
  let state = initialState(desc);
  if (!stateValid(state)) throw Error("describer_initial_state_invalid");
  for (const test of pkg.test_cases) {
    const control = pkg.manifest.controls.find((c) => c.name === test.name);
    if (!control || !ajv.compile(control.input_schema)(test.input)) throw Error(`describer_case_input:${test.name}`);
    state = reduce(desc, state, test.name, test.input);
    if (!stateValid(state) || !isDeepStrictEqual(state, test.expected_state)) throw Error(`describer_case_state:${test.name}`);
    if (!readoutOf(desc, state).includes(test.readout)) throw Error(`describer_case_readout:${test.name}`);
  }
  return { name: "engine_model_replay", passed: true, cases: pkg.test_cases.length };
}

export class DescriberWorker {
  constructor({ env = {}, fallback = null, client = null, browserCheck = null, onDescribed = null } = {}) {
    this.env = env;
    this.fallback = fallback;
    this.client = client;
    this.browserCheck = browserCheck;
    this.onDescribed = onDescribed;
  }

  get api() {
    if (!this.env.OPENAI_API_KEY && !this.client) throw Object.assign(Error("provider_not_configured"), { code: "provider_not_configured" });
    return (this.client ??= new OpenAI({ apiKey: this.env.OPENAI_API_KEY, maxRetries: 0 }));
  }

  // Only physical, spatial scenes use the part catalog.
  handles(intent) {
    const mode = this.env.DESCRIBER_MODE ?? "isometric";
    return mode !== "off" && intent?.representation === "isometric";
  }

  async describe({ intent, previous, scene_id, scene_version, signal, onValidating }) {
    const started = Date.now();
    const described = await describeScene({ client: this.api, env: this.env, intent, previous: previous?.description ?? null, signal });
    await this.onDescribed?.(described);
    if (described.problems.length) throw Object.assign(Error("describer_checks_failed"), { detail: described.problems.join(",") });
    await onValidating?.();
    const pkg = normalizePackage(packageScene(described.ops), { scene_id, scene_version });
    const checks = [{ name: "description_checks", passed: true, parts: described.desc.parts.size }, { name: "package_schema_and_resource_bounds", passed: true }, replayPackage(described.desc, pkg)];
    const limitations = ["The scene is drawn by the trusted scene engine from a checked description; no model-written code runs.", "Automated checks do not establish educational correctness or review visual quality."];
    if (this.browserCheck) {
      const browser = await this.browserCheck(pkg);
      if (!browser.passed) throw Error("describer_browser_failed");
      checks.push(...browser.checks.filter((check) => check.name !== "package_schema_and_resource_bounds"));
    }
    pkg.validation = { passed: true, checks, limitations };
    pkg.description = described.ops;
    return {
      package: pkg,
      metrics: {
        generation_ms: Date.now() - started,
        first_token_ms: described.first_token_ms,
        described_ms: described.described_ms,
        usage: described.usage.filter(Boolean).reduce((sum, usage) => ({ input_tokens: (sum.input_tokens ?? 0) + (usage.input_tokens ?? 0), output_tokens: (sum.output_tokens ?? 0) + (usage.output_tokens ?? 0) }), {}),
        cost_usd: null,
        cost_basis: "model_rates_not_configured",
        worker: "scene_engine_describer",
        describer_attempts: described.attempts,
        rejected_lines: described.rejected.length,
      },
    };
  }

  async author(request) {
    if (!this.handles(request.intent)) {
      if (!this.fallback) throw Error("describer_not_applicable");
      return this.fallback.author(request);
    }
    try {
      return await this.describe(request);
    } catch (error) {
      if (request.signal?.aborted || error.code === "provider_not_configured" || !this.fallback) throw error;
      console.error(JSON.stringify({ type: "describer_fallback", code: /^[a-z_:.,0-9-]{1,200}$/i.test(error.message) ? error.message : "describer_error", detail: String(error.detail ?? "").slice(0, 300) }));
      const result = await this.fallback.author(request);
      result.metrics = { ...result.metrics, describer_fallback: error.message, ...(error.detail ? { describer_detail: String(error.detail).slice(0, 300) } : {}) };
      return result;
    }
  }
}
