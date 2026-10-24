// Runs a batch of questions through the service's describer pipeline (describe with one repair
// turn, package, the service's package contract, model replay) and reports pass rate and timing.
// Costs one or two model calls per question; needs OPENAI_API_KEY in server/explainer/.env.
//   node --env-file-if-exists=.env engine/batch.mjs [--out dir] [--concurrency 3] [--browser]
import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePackage } from "../src/package.mjs";
import { replayPackage } from "../src/describer-worker.mjs";
import { describeScene } from "./describer.mjs";
import { packageScene } from "./package.mjs";

export const QUESTIONS = [
  "Explain how a space rocket works, interactive",
  "Why does a heavier weight stretch a spring more?",
  "How does a seesaw balance two kids of different weights?",
  "Why is water pressure stronger at the bottom of a pool?",
  "Why does a light bulb glow brighter with more batteries?",
  "Why does a ball roll faster down a steeper ramp?",
  "How do pulleys make lifting easier?",
  "How does a water tower get water to houses?",
  "Why do boats float?",
  "How does a car engine work?",
  "How does a thermometer show the temperature?",
  "How does a lever let you lift something heavy?",
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const out = option("--out", join(".work", "engine-batch"));
const concurrency = Number(option("--concurrency", 3));
const browser = args.includes("--browser");
if (!process.env.OPENAI_API_KEY) throw Error("OPENAI_API_KEY is not set");
mkdirSync(out, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
const validateBrowser = browser ? (await import("../src/browser-check.mjs")).validateBrowser : null;

async function one(question, index) {
  const started = performance.now();
  let firstPart = null;
  const row = { index, question };
  try {
    const described = await describeScene({
      client,
      env: process.env,
      question,
      onLine: ({ ms, op }) => {
        if (op.op === "part" && firstPart === null) firstPart = ms;
      },
    });
    Object.assign(row, {
      first_token_ms: described.first_token_ms,
      first_part_ms: firstPart,
      described_ms: described.described_ms,
      attempts: described.attempts,
      ops: described.ops.length,
      parts: described.desc.parts.size,
      kinds: [...new Set([...described.desc.parts.values()].map((part) => part.kind))],
      rejected: described.rejected.map((entry) => entry.error),
      problems: described.problems,
      history: described.history,
      output_tokens: described.usage.filter(Boolean).reduce((sum, usage) => sum + (usage.output_tokens ?? 0), 0),
    });
    writeFileSync(join(out, `${String(index).padStart(2, "0")}.jsonl`), described.ops.map((op) => JSON.stringify(op)).join("\n") + "\n");
    if (described.problems.length) throw Error(`checks:${described.problems.join(",")}`);
    const pkg = normalizePackage(packageScene(described.ops), { scene_id: `batch_${index}`, scene_version: 1 });
    replayPackage(described.desc, pkg);
    if (validateBrowser) {
      const result = await validateBrowser(pkg, { artifactDir: join(out, String(index).padStart(2, "0")) });
      if (!result.passed) throw Error("browser_failed");
    }
    row.passed = true;
  } catch (error) {
    row.passed = false;
    row.error = error.message;
  }
  row.total_ms = Math.round(performance.now() - started);
  console.log(`${row.passed ? "pass" : "FAIL"}  ${String(row.total_ms).padStart(6)} ms  ${question}${row.error ? `  (${row.error})` : ""}`);
  return row;
}

const rows = [];
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < QUESTIONS.length) {
      const index = next++;
      rows[index] = await one(QUESTIONS[index], index);
    }
  }),
);
const passed = rows.filter((row) => row.passed);
const sorted = (key) => rows.map((row) => row[key]).filter((value) => typeof value === "number").sort((a, b) => a - b);
const spread = (key) => {
  const list = sorted(key);
  const at = (q) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
  return list.length ? { min: list[0], median: at(0.5), p90: at(0.9), max: list[list.length - 1] } : null;
};
const summary = {
  questions: rows.length,
  passed: passed.length,
  passed_first_try: passed.filter((row) => row.attempts === 1).length,
  first_token_ms: spread("first_token_ms"),
  first_part_ms: spread("first_part_ms"),
  described_ms: spread("described_ms"),
  total_ms: spread("total_ms"),
};
writeFileSync(join(out, "results.json"), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
