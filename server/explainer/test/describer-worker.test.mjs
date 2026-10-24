import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DescriberWorker } from "../src/describer-worker.mjs";
import { buildEngine } from "../engine/build.mjs";
import { script as bundled } from "../engine/dist/engine-source.mjs";

const read = (name) => readFileSync(new URL(`../engine/examples/${name}`, import.meta.url), "utf8");
const intent = (representation = "isometric") => ({
  learning_goal: "A spring stretches in proportion to the weight hanging on it.",
  concept: "Hooke's law",
  interaction: "Add slotted masses and read the stretch on a ruler.",
  representation,
  model_kind: "simplified",
  assumptions: [],
  limitations: [],
});

// A stand-in for the OpenAI client that streams each queued answer in small chunks.
function fakeClient(answers) {
  const calls = [];
  return {
    calls,
    responses: {
      async create(body) {
        calls.push(body);
        const text = answers.shift();
        return (async function* () {
          for (let at = 0; at < text.length; at += 40) yield { type: "response.output_text.delta", delta: text.slice(at, at + 40) };
          yield { type: "response.completed", response: { usage: { input_tokens: 2000, output_tokens: 700 } } };
        })();
      },
    },
  };
}
const fallback = (log) => ({
  async author(request) {
    log.push(request.intent.representation);
    return { package: { fallback: true }, metrics: { worker: "fallback" } };
  },
});

test("an isometric intent becomes a validated engine package without model-written code", async () => {
  const client = fakeClient([read("spring-scale.jsonl")]);
  const worker = new DescriberWorker({ env: {}, client });
  let validating = false;
  const result = await worker.author({ intent: intent(), previous: null, scene_id: "scene_a", scene_version: 1, onValidating: () => (validating = true) });
  assert.equal(validating, true);
  assert.equal(result.package.validation.passed, true);
  assert.deepEqual(result.package.validation.checks.map((check) => check.name), ["description_checks", "package_schema_and_resource_bounds", "engine_model_replay"]);
  assert.equal(result.package.scene_id, "scene_a");
  assert.equal(result.metrics.worker, "scene_engine_describer");
  assert.equal(result.metrics.describer_attempts, 1);
  assert.ok(result.package.description.length > 10);
  assert.match(client.calls[0].input, /Concept: Hooke's law/);
});

test("a repair keeps accepted lines and asks only for the fixes", async () => {
  const lines = read("spring-scale.jsonl").trim().split("\n");
  const broken = lines.map((line) => line.replace('"kind":"mass_hanger"', '"kind":"weight_pan"')).join("\n");
  // The fix: the corrected hanger and the lines that depended on it.
  const fix = lines.filter((line) => /"id":"(hanger|pointer)"|"op":"touch"/.test(line)).join("\n");
  const client = fakeClient([broken, fix]);
  const result = await new DescriberWorker({ env: {}, client }).author({ intent: intent(), scene_id: "s", scene_version: 1 });
  assert.equal(result.metrics.describer_attempts, 2);
  assert.match(client.calls[1].input, /part_kind:weight_pan/);
  assert.match(client.calls[1].input, /These lines were accepted/);
  assert.equal(result.package.validation.passed, true);
  assert.equal(result.package.description.filter((op) => op.op === "scene").length, 1, "accepted lines are not repeated");
});

test("a description that still fails falls back to the existing author", async () => {
  const log = [];
  const bad = '{"op":"scene","title":"x","learning_goal":"nothing here","model_kind":"simplified"}\n';
  const result = await new DescriberWorker({ env: {}, client: fakeClient([bad, bad]), fallback: fallback(log) }).author({ intent: intent(), scene_id: "s", scene_version: 1 });
  assert.deepEqual(log, ["isometric"]);
  assert.equal(result.metrics.describer_fallback, "describer_checks_failed");
});

test("other representations and DESCRIBER_MODE=off go straight to the existing author", async () => {
  const log = [];
  const client = fakeClient([]);
  await new DescriberWorker({ env: {}, client, fallback: fallback(log) }).author({ intent: intent("mathematical"), scene_id: "s", scene_version: 1 });
  await new DescriberWorker({ env: { DESCRIBER_MODE: "off" }, client, fallback: fallback(log) }).author({ intent: intent(), scene_id: "s", scene_version: 1 });
  assert.deepEqual(log, ["mathematical", "isometric"]);
  assert.equal(client.calls.length, 0);
});

test("a revision asks only for changes and builds on the scene the child sees", async () => {
  const first = await new DescriberWorker({ env: {}, client: fakeClient([read("spring-scale.jsonl")]) }).author({ intent: intent(), scene_id: "s", scene_version: 1 });
  const client = fakeClient([read("spring-scale-two-springs.jsonl")]);
  const second = await new DescriberWorker({ env: {}, client }).author({ intent: intent(), previous: first.package, scene_id: "s", scene_version: 2 });
  assert.match(client.calls[0].input, /Write only the lines to add or replace/);
  assert.ok(second.package.manifest.controls.some((control) => control.name === "set_springs"));
  assert.equal(second.package.scene_version, 2);
});

test("the bundled engine module matches the engine sources", async () => {
  const { script } = await buildEngine();
  assert.equal(script, bundled, "run node engine/build.mjs");
});
