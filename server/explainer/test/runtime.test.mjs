import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { runtime } from "../src/package.mjs";
import { fixture } from "./fixtures.mjs";
function setup(failAt = -1) {
  const events = [];
  let current;
  const pkg = fixture();
  const context = {
    structuredClone,
    JSON,
    Date,
    Set,
    Object,
    Number,
    Error,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { hidden: false, addEventListener() {} },
    CustomEvent: class {},
    window: {
      webkit: {
        messageHandlers: { explainer: { postMessage: (e) => events.push(e) } },
      },
      dispatchEvent() {},
      addEventListener() {},
    },
  };
  vm.runInNewContext(runtime, context);
  const scene = context.window.ExplainerScene;
  scene.register({
    controls: pkg.manifest.controls,
    state_schema: pkg.manifest.state_schema,
    initial_state: { value: 1, result: "2", paused: false },
    reduce: (s, n, i) =>
      n === "change"
        ? { ...s, value: i.value, result: String(i.value * 2) }
        : n === "pause"
          ? { ...s, paused: i.paused }
          : { value: 1, result: "2", paused: false },
    render: (s) => {
      current = s;
    },
    invariants: (s) => s.result === String(s.value * 2) && s.value !== failAt,
  });
  const id = { session_id: "s", scene_id: "x", scene_version: 1 };
  context.window.explainerBootstrap(id);
  return {
    events,
    scene,
    current: () => current,
    apply: context.window.explainerCommand,
    id,
  };
}
test("rejected request IDs remain rejected after state catches up", () => {
  const { apply, scene, id, events } = setup();
  const stale = {
    ...id,
    request_id: "same",
    expected_state_revision: 1,
    name: "change",
    input: { value: 5 },
  };
  apply(stale);
  apply({
    ...id,
    request_id: "first",
    expected_state_revision: 0,
    name: "change",
    input: { value: 3 },
  });
  apply(stale);
  assert.equal(scene.snapshot().state.value, 3);
  assert.equal(events.at(-1).error, "duplicate_request");
});
test("invalid model inputs cannot change model, stale scenes rejected, pause real", () => {
  const { apply, scene, id, events } = setup();
  apply({
    ...id,
    request_id: "bad",
    expected_state_revision: 0,
    name: "change",
    input: { value: 99 },
  });
  assert.equal(scene.snapshot().state_revision, 0);
  apply({
    ...id,
    scene_version: 2,
    request_id: "wrong",
    expected_state_revision: 0,
    name: "change",
    input: { value: 2 },
  });
  assert.equal(events.at(-1).error, "stale_scene");
  apply({
    ...id,
    request_id: "pause",
    expected_state_revision: 0,
    name: "pause",
    input: { paused: true },
  });
  assert.equal(scene.isPaused(), true);
  assert.equal(events.at(-2).state_revision, 1);
});
test("model invariant failures roll back without reporting success", () => {
  const { apply, scene, id } = setup(4);
  apply({
    ...id,
    request_id: "bad",
    expected_state_revision: 0,
    name: "change",
    input: { value: 4 },
  });
  assert.equal(scene.snapshot().state.value, 1);
});
