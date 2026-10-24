// A scene description is a stream of small JSON operations, one per line, that a fast
// model can write in a few hundred tokens. They accumulate into a description that the
// engine draws and the runtime drives. Sending an op again with the same name or id
// replaces it, so a follow-up ("what if there were two?") is just a few more lines.
//
//   scene    { title, learning_goal, model_kind, assumptions, limitations, stage? }
//   value    { name, label, min, max, initial, integer?, unit? } | { name, label, options, initial }
//   derive   { name, expr, unit? }                    a formula over values and earlier derives
//   part     { id, kind, on?, at?, params?, bind? }   bind: { param: formula }
//   remove   { id }
//   control  { name, label, input: { field: spec }, set: { value: formula } }
//   touch    { part, control, input: { field: formula } }   tapping the part sends the control
//   readout  { text }                                 "{masses} weights · {stretch:0} mm"
//   beat     { speaker?, say, cues: [{ word, control, input } | { word, focus }] }   lines the characters can say
import { parse, namesOf, evaluate, KNOWN_NAMES } from "./expr.mjs";
import { CATALOG } from "./catalog.mjs";

const NAME = /^[a-z][a-z0-9_]{0,31}$/;
const ID = /^[a-z][a-z0-9_]{0,31}$/;
const CONTROL = /^[a-z][a-z0-9_]{0,47}$/;
const RESERVED = new Set(["paused", "focus", "input", ...KNOWN_NAMES]);
const BUILT_IN = new Set(["pause", "reset", "point_at"]);
export const LIMITS = { parts: 40, values: 12, derives: 16, controls: 12, beats: 24, text: 400 };
const STAGE = { w: 260, d: 150, h: 230 };

const fail = (code) => {
  throw Error(code);
};
const isText = (value, max = LIMITS.text) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const only = (op, keys) => {
  for (const key of Object.keys(op)) if (key !== "op" && !keys.includes(key)) fail(`unknown_field:${op.op}.${key}`);
};

export function createDescription() {
  return { scene: null, values: new Map(), derives: new Map(), parts: new Map(), controls: new Map(), touches: new Map(), readout: null, beats: [] };
}

const formula = (text, known, where) => {
  let tree;
  try {
    tree = parse(String(text));
  } catch (error) {
    fail(`${where}:${error.message}`);
  }
  for (const name of namesOf(tree)) if (!known(name) && !KNOWN_NAMES.includes(name)) fail(`${where}:unknown_name:${name}`);
  return { text: String(text), tree };
};
const knownIn = (desc, extra = []) => (name) => desc.values.has(name) || desc.derives.has(name) || name === "focus" || extra.includes(name);

// Applies one operation; returns a short note of what changed for the renderer.
export function applyOp(desc, op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) fail("op_not_object");
  if (op.op !== "scene" && !desc.scene) fail("scene_first");
  switch (op.op) {
    case "scene": {
      only(op, ["title", "learning_goal", "model_kind", "assumptions", "limitations", "stage"]);
      if (!isText(op.title, 120) || !isText(op.learning_goal)) fail("scene_text");
      if (!["factual", "simplified", "analogy"].includes(op.model_kind)) fail("scene_model_kind");
      for (const list of ["assumptions", "limitations"]) if (op[list] !== undefined && (!Array.isArray(op[list]) || op[list].length > 8 || !op[list].every((line) => isText(line)))) fail(`scene_${list}`);
      const stage = { ...STAGE, ...(op.stage ?? {}) };
      if (![stage.w, stage.d, stage.h].every((value) => isNumber(value) && value >= 60 && value <= 480)) fail("scene_stage");
      if (desc.scene && JSON.stringify(desc.scene.stage) !== JSON.stringify(stage)) fail("scene_stage_fixed");
      desc.scene = { title: op.title, learning_goal: op.learning_goal, model_kind: op.model_kind, assumptions: op.assumptions ?? [], limitations: op.limitations ?? [], stage };
      return { kind: "scene" };
    }
    case "value": {
      only(op, ["name", "label", "min", "max", "initial", "integer", "unit", "options"]);
      if (!NAME.test(op.name ?? "") || RESERVED.has(op.name) || desc.derives.has(op.name)) fail("value_name");
      if (!isText(op.label, 80)) fail("value_label");
      if (!desc.values.has(op.name) && desc.values.size >= LIMITS.values) fail("too_many_values");
      let value;
      if (op.options !== undefined) {
        if (!Array.isArray(op.options) || op.options.length < 2 || op.options.length > 8 || !op.options.every((option) => /^[A-Za-z0-9_ -]{1,48}$/.test(option))) fail("value_options");
        if (!op.options.includes(op.initial)) fail("value_initial");
        value = { name: op.name, label: op.label, options: [...op.options], initial: op.initial };
      } else {
        if (![op.min, op.max, op.initial].every(isNumber) || op.min >= op.max || op.initial < op.min || op.initial > op.max) fail("value_range");
        if (op.integer && ![op.min, op.max, op.initial].every(Number.isInteger)) fail("value_integer");
        value = { name: op.name, label: op.label, min: op.min, max: op.max, initial: op.initial, integer: !!op.integer, unit: isText(op.unit, 16) ? op.unit : "" };
      }
      desc.values.set(op.name, value);
      return { kind: "value", name: op.name };
    }
    case "derive": {
      only(op, ["name", "expr", "unit", "label"]);
      if (!NAME.test(op.name ?? "") || RESERVED.has(op.name) || desc.values.has(op.name)) fail("derive_name");
      if (!desc.derives.has(op.name) && desc.derives.size >= LIMITS.derives) fail("too_many_derives");
      const earlier = [...desc.derives.keys()].filter((name) => name !== op.name);
      const expr = formula(op.expr, (name) => desc.values.has(name) || earlier.includes(name) || name === "focus", `derive.${op.name}`);
      desc.derives.set(op.name, { name: op.name, expr, unit: isText(op.unit, 16) ? op.unit : "" });
      return { kind: "derive", name: op.name };
    }
    case "part": {
      only(op, ["id", "kind", "on", "at", "params", "bind", "label"]);
      if (!ID.test(op.id ?? "") || op.id === "none") fail("part_id");
      const kind = CATALOG[op.kind];
      if (!kind) fail(`part_kind:${op.kind}`);
      if (!desc.parts.has(op.id) && desc.parts.size >= LIMITS.parts) fail("too_many_parts");
      let on = null;
      if (op.kind === "bench") {
        if (op.on) fail("bench_on");
      } else {
        const [parent, mount] = String(op.on ?? "").split(".");
        const host = desc.parts.get(parent);
        if (!host || parent === op.id) fail(`part_on:${op.id}`);
        const mounts = CATALOG[host.kind].mounts(resolve(desc, host, initialState(desc)));
        if (!Object.hasOwn(mounts, mount)) fail(`part_mount:${op.on}`);
        on = { part: parent, mount };
      }
      if (op.at !== undefined && (!Array.isArray(op.at) || op.at.length < 2 || op.at.length > 3 || !op.at.every(isNumber) || op.at.some((value) => Math.abs(value) > 480))) fail("part_at");
      const params = {};
      for (const [name, value] of Object.entries(op.params ?? {})) {
        const spec = kind.params[name];
        if (!spec) fail(`part_param:${op.kind}.${name}`);
        if (spec.ref) {
          const [target, mount] = String(value).split(".");
          const host = desc.parts.get(target);
          if (!host || target === op.id || !Object.hasOwn(CATALOG[host.kind].mounts(resolve(desc, host, initialState(desc))), mount)) fail(`part_ref:${op.id}.${name}`);
        } else if (spec.options ? !spec.options.includes(value) : !isNumber(value) || value < spec.min || value > spec.max) fail(`part_param_range:${op.id}.${name}`);
        params[name] = value;
      }
      for (const [name, spec] of Object.entries(kind.params)) if (spec.ref && params[name] === undefined) fail(`part_ref_missing:${op.id}.${name}`);
      const bind = {};
      for (const [name, text] of Object.entries(op.bind ?? {})) {
        const spec = kind.params[name];
        if (!spec || spec.options || spec.ref) fail(`part_bind:${op.kind}.${name}`);
        bind[name] = formula(text, knownIn(desc), `bind.${op.id}.${name}`);
      }
      const replacing = desc.parts.get(op.id);
      if (replacing && replacing.kind !== op.kind && childrenOf(desc, op.id).length) fail("part_kind_change_with_children");
      desc.parts.set(op.id, { id: op.id, kind: op.kind, on, at: [...(op.at ?? [0, 0]), 0].slice(0, 3), params, bind, label: isText(op.label, 60) ? op.label : "" });
      fitBench(desc);
      return { kind: "part", id: op.id, replaced: !!replacing };
    }
    case "remove": {
      only(op, ["id"]);
      if (!desc.parts.has(op.id)) fail("remove_unknown");
      if (childrenOf(desc, op.id).length) fail("remove_has_children");
      desc.parts.delete(op.id);
      desc.touches.delete(op.id);
      return { kind: "remove", id: op.id };
    }
    case "control": {
      only(op, ["name", "label", "input", "set"]);
      if (!CONTROL.test(op.name ?? "") || BUILT_IN.has(op.name)) fail("control_name");
      if (!isText(op.label, 80)) fail("control_label");
      if (!desc.controls.has(op.name) && desc.controls.size >= LIMITS.controls) fail("too_many_controls");
      const input = {};
      for (const [field, spec] of Object.entries(op.input ?? {})) {
        if (!NAME.test(field)) fail("control_field");
        if (spec?.options) {
          if (!Array.isArray(spec.options) || !spec.options.length || spec.options.length > 12 || !spec.options.every((option) => /^[A-Za-z0-9_ -]{1,48}$/.test(option))) fail("control_options");
          input[field] = { options: [...spec.options] };
        } else {
          if (!["integer", "number"].includes(spec?.type) || !isNumber(spec.min) || !isNumber(spec.max) || spec.min >= spec.max) fail("control_input_range");
          if (spec.type === "integer" && ![spec.min, spec.max].every(Number.isInteger)) fail("control_input_integer");
          input[field] = { type: spec.type, min: spec.min, max: spec.max };
        }
      }
      if (Object.keys(input).length > 4) fail("control_input_size");
      const fields = Object.keys(input).map((field) => `input.${field}`);
      const set = {};
      for (const [name, text] of Object.entries(op.set ?? {})) {
        if (!desc.values.has(name)) fail(`control_set:${name}`);
        set[name] = formula(text, knownIn(desc, fields), `control.${op.name}.${name}`);
      }
      if (!Object.keys(set).length) fail("control_sets_nothing");
      desc.controls.set(op.name, { name: op.name, label: op.label, input, set });
      return { kind: "control", name: op.name };
    }
    case "touch": {
      only(op, ["part", "control", "input"]);
      if (!desc.parts.has(op.part)) fail("touch_part");
      const control = desc.controls.get(op.control);
      if (!control) fail("touch_control");
      const input = {};
      for (const field of Object.keys(control.input)) {
        if (!Object.hasOwn(op.input ?? {}, field)) fail(`touch_input_missing:${field}`);
        input[field] = formula(op.input[field], knownIn(desc), `touch.${op.part}.${field}`);
      }
      desc.touches.set(op.part, { part: op.part, control: op.control, input });
      return { kind: "touch", part: op.part };
    }
    case "readout": {
      only(op, ["text"]);
      if (!isText(op.text, 120)) fail("readout_text");
      for (const [, name] of op.text.matchAll(/\{([a-z][a-z0-9_]*)(?::\d)?\}/g)) if (!knownIn(desc)(name)) fail(`readout_name:${name}`);
      desc.readout = { text: op.text };
      return { kind: "readout" };
    }
    case "beat": {
      only(op, ["say", "cues", "speaker"]);
      if (op.speaker !== undefined && !["genie", "rookie"].includes(op.speaker)) fail("beat_speaker");
      if (!isText(op.say, 300)) fail("beat_say");
      if (desc.beats.length >= LIMITS.beats) fail("too_many_beats");
      const words = op.say.trim().split(/\s+/).length;
      // A cue that names nothing real is dropped; the line itself is still worth saying.
      const dropped = [];
      const cues = (op.cues ?? []).flatMap((cue) => {
        const drop = (code) => (dropped.push(code), []);
        if (!Number.isInteger(cue?.word) || cue.word < 0 || cue.word >= words) return drop("cue_word");
        if (cue.focus !== undefined) {
          if (cue.focus !== "none" && !desc.parts.has(cue.focus)) return drop("cue_focus");
          return [{ word: cue.word, focus: cue.focus }];
        }
        const control = desc.controls.get(cue.control);
        if (!control) return drop("cue_control");
        if (!inputValid(control, cue.input)) return drop("cue_input");
        return [{ word: cue.word, control: cue.control, input: { ...cue.input } }];
      });
      desc.beats.push({ speaker: op.speaker ?? "genie", say: op.say, cues });
      return { kind: "beat", index: desc.beats.length - 1, dropped };
    }
    default:
      fail(`op_unknown:${op.op}`);
  }
}

export const childrenOf = (desc, id) => [...desc.parts.values()].filter((part) => part.on?.part === id);

function inputValid(control, input) {
  if (!input || typeof input !== "object") return false;
  const fields = Object.keys(control.input);
  if (Object.keys(input).length !== fields.length) return false;
  return fields.every((field) => {
    const spec = control.input[field];
    const value = input[field];
    if (spec.options) return spec.options.includes(value);
    return isNumber(value) && value >= spec.min && value <= spec.max && (spec.type !== "integer" || Number.isInteger(value));
  });
}

export function initialState(desc) {
  const state = { paused: false, focus: "none" };
  for (const value of desc.values.values()) state[value.name] = value.initial;
  return state;
}

// Values plus every derived quantity for a state.
export function scopeOf(desc, state) {
  const scope = { focus: state.focus };
  for (const value of desc.values.values()) scope[value.name] = state[value.name] ?? value.initial;
  for (const derive of desc.derives.values()) {
    const result = evaluate(derive.expr.tree, scope);
    scope[derive.name] = typeof result === "number" && !Number.isFinite(result) ? 0 : result;
  }
  return scope;
}

// A part's parameters with its bindings evaluated and clamped to the catalog's ranges.
export function resolve(desc, part, state, scope = scopeOf(desc, state)) {
  const kind = CATALOG[part.kind];
  const v = {};
  for (const [name, spec] of Object.entries(kind.params)) v[name] = part.params[name] ?? spec.default;
  for (const [name, bind] of Object.entries(part.bind)) {
    const spec = kind.params[name];
    const result = Number(evaluate(bind.tree, scope));
    v[name] = Number.isFinite(result) ? Math.min(spec.max, Math.max(spec.min, result)) : spec.default;
  }
  // The bench is only a base, so it grows to hold every part placed on it.
  if (part.kind === "bench" && desc.benchFit) {
    v.w = Math.min(kind.params.w.max, Math.max(v.w, desc.benchFit.w));
    v.d = Math.min(kind.params.d.max, Math.max(v.d, desc.benchFit.d));
  }
  return v;
}

// Records how large the bench must be to hold every part (with a margin), from the parts'
// floor footprints where the scene starts.
function fitBench(desc) {
  const bench = [...desc.parts.values()].find((part) => part.kind === "bench");
  if (!bench) return;
  desc.benchFit = null;
  let boxes;
  try {
    boxes = boxesOf(desc, initialState(desc));
  } catch {
    return;
  }
  const origin = boxes.get(bench.id) ? [(boxes.get(bench.id)[0][0] + boxes.get(bench.id)[1][0]) / 2, (boxes.get(bench.id)[0][1] + boxes.get(bench.id)[1][1]) / 2] : [0, 0];
  let w = 0;
  let d = 0;
  for (const [id, [lo, hi]] of boxes) {
    if (id === bench.id || CATALOG[desc.parts.get(id).kind].connector && lo[2] === hi[2]) continue;
    w = Math.max(w, 2 * Math.max(origin[0] - lo[0], hi[0] - origin[0]) + 16);
    d = Math.max(d, 2 * Math.max(origin[1] - lo[1], hi[1] - origin[1]) + 16);
  }
  desc.benchFit = { w: Math.ceil(w), d: Math.ceil(d) };
}

// World origin of every part, walking mounts from the bench up.
export function layout(desc, state, valuesOf = (part) => resolve(desc, part, state), { lift = true } = {}) {
  const placed = new Map();
  const visit = (part) => {
    if (placed.has(part.id)) return placed.get(part.id);
    const v = valuesOf(part);
    let origin = [part.at[0], part.at[1], part.at[2] ?? 0];
    let inherited = 0;
    if (part.on) {
      const host = desc.parts.get(part.on.part);
      const base = visit(host);
      const mount = CATALOG[host.kind].mounts(base.v)[part.on.mount] ?? [0, 0, 0];
      origin = [base.origin[0] + mount[0] + part.at[0], base.origin[1] + mount[1] + part.at[1], base.origin[2] + mount[2] + (part.at[2] ?? 0)];
      inherited = base.lift;
    }
    // Lift is how far a part has risen, and what is mounted on it rises with it. A part that
    // sets its own lift replaces what it inherits, so the same lift on a whole stack moves it once.
    const own = part.bind.lift !== undefined || part.params.lift !== undefined;
    const risen = own ? v.lift : inherited;
    if (lift) origin[2] += risen - inherited;
    const entry = { origin, v, lift: lift ? risen : 0 };
    placed.set(part.id, entry);
    return entry;
  };
  for (const part of desc.parts.values()) visit(part);
  return placed;
}

export function reduce(desc, state, name, input) {
  if (name === "pause") return { ...state, paused: input.paused };
  if (name === "reset") return initialState(desc);
  if (name === "point_at") return { ...state, focus: input.part };
  const control = desc.controls.get(name);
  if (!control) fail("unknown_control");
  if (!inputValid(control, input)) fail("invalid_control_input");
  const scope = scopeOf(desc, state);
  for (const [field, value] of Object.entries(input)) scope[`input.${field}`] = value;
  const next = { ...state };
  for (const [target, expr] of Object.entries(control.set)) {
    const value = desc.values.get(target);
    const result = evaluate(expr.tree, scope);
    if (value.options) {
      if (!value.options.includes(result)) fail(`set_option:${target}`);
      next[target] = result;
    } else {
      let number = Number(result);
      if (!Number.isFinite(number)) fail(`set_number:${target}`);
      number = Math.min(value.max, Math.max(value.min, number));
      next[target] = value.integer ? Math.round(number) : Math.round(number * 1e6) / 1e6;
    }
  }
  return next;
}

export function touchInput(desc, part, state) {
  const touch = desc.touches.get(part);
  if (!touch) return null;
  const scope = scopeOf(desc, state);
  const control = desc.controls.get(touch.control);
  const input = {};
  for (const [field, expr] of Object.entries(touch.input)) {
    const spec = control.input[field];
    let value = evaluate(expr.tree, scope);
    if (!spec.options) {
      value = Math.min(spec.max, Math.max(spec.min, Number(value)));
      if (spec.type === "integer") value = Math.round(value);
    }
    input[field] = value;
  }
  return { name: touch.control, input };
}

export function readoutOf(desc, state) {
  if (!desc.readout) return "";
  const scope = scopeOf(desc, state);
  // Runs of spaces are collapsed, as the page shows them, so the readout and its checks agree.
  return desc.readout.text
    .replace(/\{([a-z][a-z0-9_]*)(?::(\d))?\}/g, (_, name, digits) => {
      const value = scope[name];
      if (typeof value !== "number") return String(value ?? "");
      return digits === undefined ? String(Math.round(value * 100) / 100) : value.toFixed(Number(digits));
    })
    .replace(/\s+/g, " ")
    .trim();
}

// The runtime contract the shared bridge checks: controls with input schemas and the state schema.
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export function contractOf(desc) {
  const fieldSchema = (spec) => (spec.options ? { type: "string", enum: [...spec.options], maxLength: 48 } : { type: spec.type, minimum: spec.min, maximum: spec.max });
  const focus = { type: "string", enum: ["none", ...desc.parts.keys()], maxLength: 48 };
  const controls = [
    ...[...desc.controls.values()].map((control) => ({
      name: control.name,
      label: control.label,
      input_schema: object(Object.fromEntries(Object.entries(control.input).map(([field, spec]) => [field, fieldSchema(spec)]))),
    })),
    { name: "point_at", label: "Point at a part", input_schema: object({ part: focus }) },
    { name: "pause", label: "Pause", input_schema: object({ paused: { type: "boolean" } }) },
    { name: "reset", label: "Start again", input_schema: object({}) },
  ];
  const properties = { paused: { type: "boolean" }, focus };
  for (const value of desc.values.values()) properties[value.name] = value.options ? { type: "string", enum: [...value.options], maxLength: 48 } : { type: value.integer ? "integer" : "number", minimum: value.min, maximum: value.max };
  return { controls, state_schema: object(properties) };
}

// Whole-description checks that need everything in place. They are deterministic and fast,
// because the parts are proved once in the catalog rather than per scene.
export function checkDescription(desc) {
  const problems = [];
  const note = (code) => problems.push(code);
  if (!desc.scene) note("missing_scene");
  const benches = [...desc.parts.values()].filter((part) => part.kind === "bench");
  if (benches.length !== 1) note("needs_one_bench");
  if (!desc.controls.size) note("needs_a_control");
  // A scene without a readout gets one listing its first quantities, like a plain instrument display.
  if (!desc.readout && desc.values.size) {
    const shown = [...desc.values.values()].slice(0, 2).map((value) => `${value.name.replace(/_/g, " ")} {${value.name}${value.options || value.integer ? "" : ":1"}}${value.unit ? ` ${value.unit}` : ""}`);
    desc.readout = { text: shown.join(" · ").slice(0, 120) };
  }
  if (!desc.readout) note("needs_readout");
  if (!desc.touches.size) note("needs_a_touch");
  if (problems.length) return problems;
  // Every value at its extremes, one at a time, must keep everything finite, over the bench and above the floor.
  const base = initialState(desc);
  const bench = boxesOf(desc, base).get(benches[0].id);
  const needed = stageOf(desc);
  if (needed.w > 480 || needed.d > 480 || needed.h > 480) note("stage_too_large");
  for (const state of samplesOf(desc)) {
    let scope;
    try {
      scope = scopeOf(desc, state);
    } catch (error) {
      note(`derive_failed:${error.message}`);
      continue;
    }
    for (const [name, value] of Object.entries(scope)) if (typeof value === "number" && !Number.isFinite(value)) note(`not_finite:${name}`);
    for (const [id, box] of boxesOf(desc, state)) {
      if (box[0][0] < bench[0][0] - 1 || box[1][0] > bench[1][0] + 1 || box[0][1] < bench[0][1] - 1 || box[1][1] > bench[1][1] + 1) note(`off_bench:${id}`);
      if (box[0][2] < -18) note(`below_floor:${id}`);
    }
  }
  // Parts that are not mounted on each other must not overlap at rest.
  const boxes = boxesOf(desc, base);
  const related = (a, b) => {
    const chain = (id) => {
      const out = new Set([id]);
      let part = desc.parts.get(id);
      while (part?.on) {
        out.add(part.on.part);
        part = desc.parts.get(part.on.part);
      }
      return out;
    };
    // Only a part and what it is mounted on may touch; parts sharing a mount must not overlap.
    // Connectors (pipes, frames, fins, flames) are meant to reach across other parts.
    if (CATALOG[desc.parts.get(a).kind].connector || CATALOG[desc.parts.get(b).kind].connector) return true;
    return chain(a).has(b) || chain(b).has(a);
  };
  const ids = [...boxes.keys()].filter((id) => desc.parts.get(id).kind !== "bench");
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [boxes.get(ids[i]), boxes.get(ids[j])];
      const gap = Math.max(a[0][0] - b[1][0], b[0][0] - a[1][0], a[0][1] - b[1][1], b[0][1] - a[1][1], a[0][2] - b[1][2], b[0][2] - a[1][2]);
      if (gap < -0.5 && !related(ids[i], ids[j])) note(`overlap:${ids[i]}:${ids[j]}`);
    }
  for (const beat of desc.beats) for (const cue of beat.cues) if (cue.control) try { reduce(desc, base, cue.control, cue.input); } catch (error) { note(`cue_failed:${error.message}`); }
  return [...new Set(problems)];
}

// The states a scene is checked and framed in: initial, each value at each extreme, and every value at its maximum.
export function samplesOf(desc) {
  const base = initialState(desc);
  const samples = [base];
  for (const value of desc.values.values()) {
    if (value.options) for (const option of value.options) samples.push({ ...base, [value.name]: option });
    else samples.push({ ...base, [value.name]: value.min }, { ...base, [value.name]: value.max });
  }
  const all = { ...base };
  for (const value of desc.values.values()) if (!value.options) all[value.name] = value.max;
  samples.push(all);
  return samples;
}

// The stage the camera frames: the described stage, grown to hold every part in every sampled state.
// A model cannot know how tall a stack of blocks gets, but the engine knows every part's exact size.
// Lift counts only where the scene starts: something that rises further (a rocket leaving its
// stand) may fly out of the picture.
export function stageOf(desc) {
  const stage = { ...desc.scene.stage };
  if (!desc.parts.size) return stage;
  const [start, ...others] = samplesOf(desc);
  for (const [state, lift] of [[start, true], ...others.map((sample) => [sample, false])]) {
    let boxes;
    try {
      boxes = boxesOf(desc, state, { lift });
    } catch {
      continue;
    }
    for (const [lo, hi] of boxes.values()) {
      stage.w = Math.max(stage.w, Math.ceil(2 * Math.max(-lo[0], hi[0])));
      stage.d = Math.max(stage.d, Math.ceil(2 * Math.max(-lo[1], hi[1])));
      stage.h = Math.max(stage.h, Math.ceil(hi[2] + 4));
    }
  }
  return stage;
}

// World position of a "part.mount" reference, once parts are placed.
export const mountResolver = (desc, placed) => (ref) => {
  const [id, name] = String(ref).split(".");
  const part = desc.parts.get(id);
  const entry = placed.get(id);
  const offset = part && entry ? CATALOG[part.kind].mounts(entry.v)[name] : null;
  return offset ? [entry.origin[0] + offset[0], entry.origin[1] + offset[1], entry.origin[2] + offset[2]] : null;
};

export function boxesOf(desc, state, { lift = true } = {}) {
  const placed = layout(desc, state, undefined, { lift });
  const mountAt = mountResolver(desc, placed);
  const out = new Map();
  for (const part of desc.parts.values()) {
    const kind = CATALOG[part.kind];
    const { origin, v } = placed.get(part.id);
    const [lo, hi] = kind.extent(v);
    const box = [lo.map((value, i) => value + origin[i]), hi.map((value, i) => value + origin[i])];
    // A part that reaches another part's mount (a pipe) also covers that end and its bulge.
    for (const [name, spec] of Object.entries(kind.params)) {
      const end = spec.ref ? mountAt(v[name]) : null;
      if (!end) continue;
      const pad = v.bulge ?? 0;
      for (let i = 0; i < 3; i++) {
        box[0][i] = Math.min(box[0][i], end[i] - (i < 2 ? pad : 0));
        box[1][i] = Math.max(box[1][i], end[i] + (i < 2 ? pad : 0));
      }
    }
    out.set(part.id, box);
  }
  return out;
}

// Splits streamed text into whole JSON lines; a partial last line waits for more text.
// A line that is not JSON is reported and skipped, so one bad line never ends the stream.
export function lineReader(onOp, onBad = (error) => {
  throw error;
}) {
  let buffer = "";
  const take = (line) => {
    if (!line) return;
    let op;
    try {
      op = JSON.parse(line);
    } catch (error) {
      return onBad(Error(`bad_json:${error.message}`), line);
    }
    onOp(op);
  };
  return {
    push(text) {
      buffer += text;
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        take(line);
      }
    },
    end() {
      const line = buffer.trim();
      buffer = "";
      take(line);
    },
  };
}
