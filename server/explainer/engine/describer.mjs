// Asks a model for a scene description and streams it into a description, with one repair
// turn that sends the rejected lines and failed checks back. Shared by the service's
// describer worker (Node and Cloudflare) and engine/describe-live.mjs; no filesystem use.
import { applyOp, boxesOf, checkDescription, createDescription, initialState, lineReader, samplesOf } from "./describe.mjs";
import { describerInstructions } from "./prompt.mjs";

// Hidden reasoning counts toward this too; 4,000 cut one batch question off mid-description.
const MAX_OUTPUT = 8000;

// What the model is asked: the planner's intent, or a child's words for local runs.
export function describerInput({ question, intent, previous }) {
  const ask = intent
    ? `Make an interactive scene for this.\nConcept: ${intent.concept}\nLearning goal: ${intent.learning_goal}\nInteraction: ${intent.interaction}\nModel: ${intent.model_kind}${intent.assumptions?.length ? `\nAssumptions: ${intent.assumptions.join("; ")}` : ""}${intent.limitations?.length ? `\nLimitations: ${intent.limitations.join("; ")}` : ""}`
    : question;
  if (!previous?.length) return ask;
  return `${ask}\n\nThe child is already looking at this scene:\n${previous.map((op) => JSON.stringify(op)).join("\n")}\n\nWrite only the lines to add or replace (same id or name replaces). Keep every part the child can see unless the change needs it gone; do not repeat the scene line.`;
}

async function streamOnce({ client, env, input, signal, desc, ops, rejected, onLine, started }) {
  let first = null;
  let usage = null;
  const ms = () => Math.round(performance.now() - started);
  const reader = lineReader(
    (op) => {
      try {
        const note = applyOp(desc, op);
        ops.push(op);
        for (const code of note.dropped ?? []) rejected.push({ error: code, line: JSON.stringify(op).slice(0, 400), soft: true });
        onLine?.({ ms: ms(), op, note });
      } catch (error) {
        rejected.push({ error: error.message, line: JSON.stringify(op).slice(0, 400) });
      }
    },
    (error, line) => rejected.push({ error: error.message, line: line.slice(0, 400) }),
  );
  const stream = await client.responses.create(
    {
      model: env.DESCRIBER_MODEL || env.FAST_AUTHOR_MODEL || "gpt-5.4-mini",
      store: false,
      stream: true,
      max_output_tokens: MAX_OUTPUT,
      reasoning: { effort: env.DESCRIBER_REASONING || "low" },
      instructions: describerInstructions(),
      input,
    },
    { signal, maxRetries: 0, timeout: Number(env.DESCRIBER_TIMEOUT_MS || 90000) },
  );
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      first ??= ms();
      reader.push(event.delta);
    }
    if (event.type === "response.completed") usage = event.response.usage;
    if (event.type === "response.incomplete" || event.type === "response.failed") throw Error("describer_response_incomplete");
  }
  reader.end();
  return { first_token_ms: first, usage };
}

// Returns { ops, desc, problems, rejected, attempts, usage, timings }. `previous` is the ops of
// the scene being revised; new lines are applied on top of it.
export async function describeScene({ client, env = {}, question, intent, previous = null, signal, onLine, repair = true }) {
  const started = performance.now();
  const usages = [];
  let attempt = 0;
  let result;
  let feedback = null;
  const history = [];
  // One description across attempts: a repair keeps every accepted line and adds only fixes,
  // so it costs a few hundred output tokens instead of a whole second description.
  const desc = createDescription();
  const ops = [];
  for (const op of previous ?? []) {
    applyOp(desc, op);
    ops.push(op);
  }
  const base = describerInput({ question, intent, previous });
  while (true) {
    attempt++;
    const rejected = [];
    const input = feedback
      ? `${base}\n\nThese lines were accepted:\n${ops.map((op) => JSON.stringify(op)).join("\n")}\n\nThese problems remain:\n${feedback}\n\nWrite only the lines that fix them: corrected versions of rejected lines (and of any later line that depended on one), or replacements using the same id or name. Do not repeat accepted lines.`
      : base;
    const streamed = await streamOnce({ client, env, input, signal, desc, ops, rejected, onLine, started });
    usages.push(streamed.usage);
    const problems = checkDescription(desc);
    history.push({ rejected: rejected.map((entry) => entry.error), problems });
    result = {
      ops,
      desc,
      problems,
      rejected,
      attempts: attempt,
      first_token_ms: result?.first_token_ms ?? streamed.first_token_ms,
    };
    // Only lines that leave the scene incomplete or broken are worth a repair; a dropped cue is not.
    const hard = rejected.filter((entry) => !entry.soft);
    if ((!problems.length && !hard.length) || !repair || attempt === 2) break;
    feedback = [...hard.map((entry) => `rejected ${entry.error}: ${entry.line}`), ...problems.map((code) => `check failed: ${explain(desc, code)}`)].join("\n").slice(0, 4000);
  }
  return { ...result, history, usage: usages, described_ms: Math.round(performance.now() - started) };
}

// Turns a check code into something the model can act on, with the parts' actual positions.
function explain(desc, code) {
  const [kind, a, b] = code.split(":");
  let boxes;
  try {
    boxes = boxesOf(desc, initialState(desc));
  } catch {
    return code;
  }
  const where = (id) => {
    const box = boxes.get(id);
    return box ? `${id} spans x ${Math.round(box[0][0])}..${Math.round(box[1][0])}, y ${Math.round(box[0][1])}..${Math.round(box[1][1])}, z ${Math.round(box[0][2])}..${Math.round(box[1][2])}` : id;
  };
  if (kind === "overlap") return `${code}: ${where(a)}; ${where(b)}. Move one with "at" so they do not intersect, or mount one on the other.`;
  if (kind === "off_bench") {
    const bench = [...desc.parts.values()].find((part) => part.kind === "bench");
    return `${code}: ${where(a)}, but the bench only spans ${bench ? where(bench.id).replace(`${bench.id} spans `, "") : "its plate"}. Move it inward or widen the bench.`;
  }
  if (kind === "needs_a_touch") return `${code}: add a touch line naming a declared part and control.`;
  if (kind === "below_floor") {
    // Name the value whose extreme drives the part through the bench, so the fix is targeted.
    const base = initialState(desc);
    for (const state of samplesOf(desc)) {
      let box;
      try {
        box = boxesOf(desc, state).get(a);
      } catch {
        continue;
      }
      if (box && box[0][2] < -18) {
        const changed = Object.keys(state).filter((name) => state[name] !== base[name]).map((name) => `${name} = ${state[name]}`);
        return `${code}: at ${changed.join(", ") || "the start"} its bottom reaches z ${Math.round(box[0][2])}, below the bench top (z 0). Raise what it hangs from, shorten the formula's reach, or narrow the value's range.`;
      }
    }
  }
  return code;
}
