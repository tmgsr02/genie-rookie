// Streams a description from a real model for a child's question, through the same describer
// (and repair turn) the service uses, then packages and browser-validates the result. Costs one
// or two model calls; needs OPENAI_API_KEY in server/explainer/.env.
//   node --env-file-if-exists=.env engine/describe-live.mjs "Why do boats float?" [--out dir] [--no-repair]
import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePackage } from "../src/package.mjs";
import { validateBrowser } from "../src/browser-check.mjs";
import { buildEngine } from "./build.mjs";
import { describeScene } from "./describer.mjs";
import { packageScene } from "./package.mjs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : join(".work", "engine-live");
const repairAt = args.indexOf("--no-repair");
if (repairAt >= 0) args.splice(repairAt, 1);
const question = args.join(" ").trim();
if (!question) throw Error('usage: describe-live.mjs "question" [--out dir] [--no-repair]');
if (!process.env.OPENAI_API_KEY) throw Error("OPENAI_API_KEY is not set");
mkdirSync(out, { recursive: true });
await buildEngine();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
const started = performance.now();
const timeline = [];
const described = await describeScene({
  client,
  env: process.env,
  question,
  repair: repairAt < 0,
  onLine: ({ ms, op, note }) => {
    timeline.push({ ms, op: op.op, ...(note.id ? { id: note.id } : {}) });
    console.log(`${String(ms).padStart(6)} ms  ${op.op}${note.id ? " " + note.id : note.name ? " " + note.name : ""}`);
  },
});
writeFileSync(join(out, "description.jsonl"), described.ops.map((op) => JSON.stringify(op)).join("\n") + "\n");
let validation = null;
if (!described.problems.length) {
  try {
    const pkg = normalizePackage(packageScene(described.ops), { scene_id: "live_check", scene_version: 1 });
    validation = await validateBrowser(pkg, { artifactDir: out });
  } catch (error) {
    validation = { passed: false, error: error.message };
  }
}
const result = {
  question,
  first_token_ms: described.first_token_ms,
  first_part_ms: timeline.find((entry) => entry.op === "part")?.ms ?? null,
  described_ms: described.described_ms,
  total_ms: Math.round(performance.now() - started),
  attempts: described.attempts,
  ops: described.ops.length,
  rejected: described.rejected,
  problems: described.problems,
  usage: described.usage,
  validation,
};
writeFileSync(join(out, "result.json"), JSON.stringify({ ...result, timeline }, null, 2));
console.log(JSON.stringify({ ...result, validation: validation && { passed: validation.passed, error: validation.error } }, null, 2));
