import test from "node:test";
import assert from "node:assert/strict";
import { parse, evaluate } from "../engine/expr.mjs";
import { CATALOG } from "../engine/catalog.mjs";
import { applyOp, checkDescription, contractOf, createDescription, initialState, layout, lineReader, readoutOf, reduce, scopeOf, stageOf, touchInput } from "../engine/describe.mjs";
import { buildEngine } from "../engine/build.mjs";
import { describe, packageScene } from "../engine/package.mjs";
import { readOps } from "../engine/read-ops.mjs";
import { normalizePackage } from "../src/package.mjs";
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";

const SPRING = readOps(new URL("../engine/examples/spring-scale.jsonl", import.meta.url));
const TWO = readOps(new URL("../engine/examples/spring-scale-two-springs.jsonl", import.meta.url));
const TANK = readOps(new URL("../engine/examples/tank-pressure.jsonl", import.meta.url));
const ROCKET = readOps(new URL("../engine/examples/rocket.jsonl", import.meta.url));

test("formulas evaluate arithmetic, comparisons and options without JavaScript", () => {
  assert.equal(evaluate(parse("min(masses + 1, 5) * 2 ^ 2"), { masses: 4 }), 20);
  assert.equal(evaluate(parse("focus == 'spring' ? 1 : 0"), { focus: "spring" }), 1);
  assert.equal(evaluate(parse("clamp(x / 0, -1, 1)"), { x: 3 }), 0);
  for (const bad of ["constructor.constructor('x')()", "alert(1)", "a[0]", "a; b", "`x`", "x => x", "this", "1 +"])
    assert.throws(() => evaluate(parse(bad), { a: [1], x: 1 }), bad);
  assert.throws(() => parse("1+".repeat(300) + "1"));
});

test("the spring description builds, checks clean and follows Hooke's law", () => {
  const desc = describe(SPRING);
  assert.deepEqual(checkDescription(desc), []);
  let state = initialState(desc);
  assert.equal(readoutOf(desc, state), "1 × 50 g · stretch 12 mm");
  state = reduce(desc, state, "set_masses", { count: 3 });
  assert.equal(Math.round(scopeOf(desc, state).stretch * 100) / 100, 36.79);
  const hanger = layout(desc, state).get("hanger").origin[2];
  const rest = layout(desc, initialState(desc)).get("hanger").origin[2];
  assert.ok(Math.abs(rest - hanger - (36.7875 - 12.2625)) < 1e-6, "the hanger drops by the extra stretch");
  assert.deepEqual(touchInput(desc, "hanger", { ...state, masses: 5 }), { name: "set_masses", input: { count: 0 } });
});

test("a follow-up stream changes the live description in place", () => {
  const desc = describe([...SPRING, ...TWO]);
  const state = reduce(desc, reduce(desc, initialState(desc), "set_masses", { count: 3 }), "set_springs", { count: 2 });
  assert.equal(readoutOf(desc, state), "3 × 50 g · 2 × spring · stretch 18 mm");
  assert.equal(desc.parts.size, 7, "the spring was replaced, not duplicated");
  assert.ok(contractOf(desc).controls.some((control) => control.name === "set_springs"));
});

test("streamed text in arbitrary chunks gives the same description as the whole file", () => {
  const text = SPRING.map((op) => JSON.stringify(op)).join("\n");
  const desc = createDescription();
  const reader = lineReader((op) => applyOp(desc, op));
  for (let at = 0; at < text.length; at += 7) reader.push(text.slice(at, at + 7));
  reader.end();
  assert.deepEqual(contractOf(desc), contractOf(describe(SPRING)));
});

test("descriptions that name missing things are rejected as they stream", () => {
  const head = SPRING.slice(0, 2);
  const fresh = () => {
    const desc = createDescription();
    for (const op of head) applyOp(desc, op);
    return desc;
  };
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "rocket", on: "bench.top" }), /part_kind/);
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "post", on: "bench.side" }), /part_mount/);
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "post", on: "nothing.top" }), /part_on/);
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "post", on: "bench.top", bind: { height: "mystery * 2" } }), /unknown_name/);
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "post", on: "bench.top", params: { height: 9000 } }), /part_param_range/);
  assert.throws(() => applyOp(fresh(), { op: "control", name: "reset", label: "Again", input: {}, set: {} }), /control_name/);
  assert.throws(() => applyOp(fresh(), { op: "part", id: "x", kind: "post", on: "bench.top", onclick: "x" }), /unknown_field/);
});

test("whole-scene checks catch parts off the bench and parts inside each other", () => {
  const desc = createDescription();
  for (const op of SPRING) applyOp(desc, op);
  // The bench grows to hold parts, but not past its largest size (420 wide).
  applyOp(desc, { op: "part", id: "far", kind: "block", on: "bench.top", at: [260, 0] });
  applyOp(desc, { op: "part", id: "clash", kind: "block", on: "bench.top", at: [-62, -8], params: { w: 30, d: 30, h: 30 } });
  const problems = checkDescription(desc);
  assert.ok(problems.includes("off_bench:far"), problems.join());
  assert.ok(problems.some((code) => code.startsWith("overlap:")), problems.join());
});

test("every catalog kind draws at its default and extreme parameters", () => {
  const P = k.fitProjection(k.boxCorners({ x: -150, y: -100, w: 300, d: 200 }, -20, 300), 600, 520);
  const at = (point) => k.iso(point, P);
  for (const [name, kind] of Object.entries(CATALOG)) {
    for (const pick of ["default", "min", "max"]) {
      const v = Object.fromEntries(Object.entries(kind.params).map(([param, spec]) => [param, spec.ref ? "other.port" : spec.options ? spec.default : spec[pick]]));
      const items = kind.draw(v, { P, at, O: [0, 0, 0], k, t: 1.5, id: "part", mountAt: () => [40, 30, -20] });
      assert.ok(items.length > 0, name);
      for (const item of items) {
        assert.ok(item.at.every(Number.isFinite), `${name} anchor`);
        assert.doesNotMatch(item.svg, /NaN|undefined|Infinity/, `${name} at ${pick}`);
      }
      const [lo, hi] = kind.extent(v);
      assert.ok(lo.every((value, index) => value <= hi[index]), `${name} extent`);
    }
  }
});

test("packages pass the service's package contract, with a test case per control", async () => {
  await buildEngine();
  for (const [index, ops] of [SPRING, [...SPRING, ...TWO], TANK, ROCKET].entries()) {
    const raw = packageScene(ops);
    const pkg = normalizePackage(raw, { scene_id: "engine_test", scene_version: index + 1 });
    assert.ok(pkg.files["runtime.js"] && pkg.files["scene.js"].length < 200_000);
    assert.deepEqual(pkg.test_cases.map((c) => c.name).sort(), pkg.manifest.controls.map((c) => c.name).sort());
  }
});

test("a model-written title cannot inject markup into the package page", async () => {
  await buildEngine();
  const ops = structuredClone(SPRING);
  ops[0].title = 'Springs</title><script src="x.js"></script>';
  const pkg = normalizePackage(packageScene(ops), { scene_id: "engine_test", scene_version: 1 });
  assert.match(pkg.files["index.html"], /Springs&lt;\/title&gt;&lt;script/);
});

test("the service's browser validator accepts an engine package, line check included", { timeout: 60_000 }, async () => {
  const { validateBrowser } = await import("../src/browser-check.mjs");
  await buildEngine();
  const pkg = normalizePackage(packageScene([...SPRING, ...TWO]), { scene_id: "engine_test", scene_version: 2 });
  const result = await validateBrowser(pkg);
  assert.equal(result.passed, true);
  assert.ok(result.checks.some((check) => check.name === "anatomy_lines_reduced" && /^line ends: 0 of [1-9]/.test(check.output)));
});

test("a line that is not JSON is reported and skipped without ending the stream", () => {
  const desc = createDescription();
  const bad = [];
  const reader = lineReader((op) => applyOp(desc, op), (error, line) => bad.push([error.message, line]));
  const lines = SPRING.map((op) => JSON.stringify(op));
  lines.splice(3, 0, '{"op":"part","id":"x","kind":"block","on":"bench.top","at":[-arm_len,0]}');
  reader.push(lines.join("\n"));
  reader.end();
  assert.equal(bad.length, 1);
  assert.match(bad[0][0], /^bad_json/);
  assert.deepEqual(checkDescription(desc), []);
});

test("the stage grows to hold parts at their largest values", () => {
  const ops = structuredClone(SPRING);
  ops[0].stage = { w: 200, d: 120, h: 100 };
  const desc = describe(ops);
  const stage = stageOf(desc);
  assert.ok(stage.h >= 200, `stage ${JSON.stringify(stage)} fits the post`);
  assert.deepEqual(checkDescription(desc), []);
});

test("rocket parts join pipes to named mounts, and the whole stack lifts with its chamber", () => {
  const desc = describe(ROCKET);
  assert.deepEqual(checkDescription(desc), []);
  const idle = layout(desc, initialState(desc));
  const full = layout(desc, reduce(desc, initialState(desc), "set_throttle", { level: 1 }));
  for (const id of ["chamber", "ox_tank", "nose", "ox_pump", "flame"]) assert.ok(full.get(id).origin[2] - idle.get(id).origin[2] > 100, id);
  assert.equal(full.get("stand").origin[2], idle.get("stand").origin[2]);
  assert.throws(() => applyOp(describe(ROCKET), { op: "part", id: "bad", kind: "pipe", on: "ox_tank.port", params: { to: "nowhere.port" } }), /part_ref/);
  assert.throws(() => applyOp(describe(ROCKET), { op: "part", id: "bad", kind: "pipe", on: "ox_tank.port" }), /part_ref_missing/);
});

test("the same lift on every part of a stack moves the stack once, not once per level", () => {
  const ops = structuredClone(ROCKET);
  for (const op of ops) if (["ox_tank", "fuel_tank", "nose"].includes(op.id)) op.bind = { ...(op.bind ?? {}), lift: "rise" };
  const desc = describe(ops);
  const idle = layout(desc, initialState(desc));
  const full = layout(desc, reduce(desc, initialState(desc), "set_throttle", { level: 1 }));
  const rise = (id) => full.get(id).origin[2] - idle.get(id).origin[2];
  for (const id of ["ox_tank", "fuel_tank", "nose", "fins"]) assert.ok(Math.abs(rise(id) - rise("chamber")) < 1e-9, id);
});
