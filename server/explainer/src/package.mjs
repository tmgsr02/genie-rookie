import { Buffer } from "node:buffer";
import { runtime } from "./runtime-source.mjs";
export { runtime };
import { createHash } from "node:crypto";
import { assertSchema, object, checkDialect, ajv } from "./contracts.mjs";
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const str = { type: "string", minLength: 1, maxLength: 2000 };
const manifestSchema = object({
  title: str,
  learning_goal: str,
  model_kind: { enum: ["factual", "simplified", "analogy"] },
  assumptions: { type: "array", items: str, maxItems: 20 },
  limitations: { type: "array", items: str, maxItems: 20 },
  controls: {
    type: "array",
    minItems: 1,
    maxItems: 16,
    items: object({
      name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,47}$" },
      label: str,
      input_schema: { type: "object" },
    }),
  },
  state_schema: { type: "object" },
  representation: {
    enum: ["isometric", "mathematical", "language", "timeline", "other"],
  },
});
export function normalizePackage(raw, identity) {
  if (
    !raw ||
    raw.entry !== "index.html" ||
    !raw.files ||
    typeof raw.files !== "object"
  )
    throw Error("invalid_package");
  assertSchema(manifestSchema, raw.manifest);
  const files = {};
  let size = 0;
  for (const [path, value] of Object.entries(raw.files)) {
    if (
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(html|js|css|svg|json)$/.test(
        path,
      ) ||
      path.includes("..") ||
      typeof value !== "string" ||
      (path.endsWith(".html") && path !== "index.html")
    )
      throw Error("invalid_file");
    size += Buffer.byteLength(value);
    if (size > 3_000_000 || Object.keys(files).length >= 64)
      throw Error("package_too_large");
    files[path] = value;
  }
  if (!files["index.html"] || !files["scene.js"])
    throw Error("missing_entry_or_model");
  const html = files["index.html"];
  if (
    /<(iframe|object|embed|base|form|link)\b|\son[a-z]+\s*=|javascript:|https?:\/\//i.test(
      html,
    )
  )
    throw Error("unsafe_document");
  if (!/<head\b[^>]*>/i.test(html)) throw Error("missing_head");
  // Exactly these scripts, in this order; runtime remains trusted and cannot be replaced.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (
    scripts.length !== 2 ||
    !/^\s+src=["']runtime.js["']\s*$/.test(scripts[0][1]) ||
    !/^\s+src=["']scene.js["']\s*$/.test(scripts[1][1]) ||
    scripts.some((s) => s[2].trim())
  )
    throw Error("invalid_script_layout");
  files["runtime.js"] = runtime;
  files["index.html"] = html.replace(
    /<head\b[^>]*>/i,
    (match) =>
      `${match}<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP.replaceAll('"', "&quot;")}">`,
  );
  const names = new Set();
  for (const control of raw.manifest.controls) {
    if (names.has(control.name)) throw Error("duplicate_control");
    names.add(control.name);
    checkDialect(control.input_schema);
  }
  if (!names.has("reset") || !names.has("pause"))
    throw Error("reset_and_pause_required");
  checkDialect(raw.manifest.state_schema);
  if (
    raw.manifest.state_schema.type !== "object" ||
    raw.manifest.state_schema.properties?.paused?.type !== "boolean" ||
    !raw.manifest.state_schema.required?.includes("paused")
  )
    throw Error("state_requires_paused_boolean");
  const pause = raw.manifest.controls.find((c) => c.name === "pause");
  if (
    fingerprint(pause.input_schema) !==
    fingerprint(object({ paused: { type: "boolean" } }))
  )
    throw Error("pause_schema_requires_paused_boolean");
  const reset = raw.manifest.controls.find((c) => c.name === "reset");
  if (fingerprint(reset.input_schema) !== fingerprint(object({})))
    throw Error("reset_schema_requires_empty_object");
  const cases = raw.test_cases;
  if (!Array.isArray(cases) || !cases.length || cases.length > 40)
    throw Error("model_tests_required");
  for (const control of raw.manifest.controls) {
    if (!cases.some((t) => t.name === control.name))
      throw Error("every_control_requires_test");
  }
  for (const test of cases) {
    const control = raw.manifest.controls.find((c) => c.name === test.name);
    if (
      !control ||
      !ajv.compile(control.input_schema)(test.input) ||
      !ajv.compile(raw.manifest.state_schema)(test.expected_state) ||
      typeof test.selector !== "string" ||
      test.selector.length > 200 ||
      typeof test.readout !== "string"
    )
      throw Error("invalid_test_case");
  }
  return {
    ...identity,
    entry: "index.html",
    files,
    manifest: raw.manifest,
    test_cases: cases,
    provenance: "authored",
    validation: { passed: false, checks: [] },
  };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
