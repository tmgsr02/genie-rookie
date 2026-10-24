// Browser entry, bundled as the global `SceneEngine`. In a package it boots a complete
// description against the trusted bridge (runtime.js); the stream demo feeds ops as they arrive.
import { createEngine } from "./engine.mjs";
import { applyOp, checkDescription, contractOf, createDescription, initialState, lineReader, readoutOf, reduce, touchInput } from "./describe.mjs";

export { createEngine, applyOp, checkDescription, contractOf, createDescription, initialState, lineReader, readoutOf, reduce, touchInput };

export function invariant(desc, state) {
  for (const value of desc.values.values()) {
    const current = state[value.name];
    if (value.options ? !value.options.includes(current) : typeof current !== "number" || current < value.min || current > value.max) return false;
  }
  return typeof state.paused === "boolean" && (state.focus === "none" || desc.parts.has(state.focus));
}

export function boot(ops, { root = document.getElementById("scene") } = {}) {
  const scene = window.ExplainerScene;
  let engine = null;
  engine = createEngine(root, {
    stagger: 70,
    onTouch(part) {
      const command = touchInput(engine.desc, part, engine.state);
      if (command) scene.act(command.name, command.input);
    },
  });
  for (const op of ops) engine.feed(op);
  const problems = checkDescription(engine.desc);
  if (problems.length) throw Error(`description_check:${problems.join(",")}`);
  const contract = contractOf(engine.desc);
  scene.register({
    initial_state: initialState(engine.desc),
    state_schema: contract.state_schema,
    controls: contract.controls,
    reduce: (state, name, input) => reduce(engine.desc, state, name, input),
    invariants: (state) => invariant(engine.desc, state),
    render: (state, options) => engine.show(state, options),
  });
  return engine;
}
