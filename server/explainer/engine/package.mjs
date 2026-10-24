// Turns a finished description into an explainer package in the service's contract:
// index.html loads the trusted runtime.js and a scene.js made of the prebuilt engine plus
// the description. The manifest and one test case per control are derived from the
// description itself, so nothing here is written by the model.
import { applyOp, checkDescription, contractOf, createDescription, initialState, readoutOf, reduce } from "./describe.mjs";
import { script as ENGINE, css as CSS } from "./dist/engine-source.mjs";

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function describe(ops) {
  const desc = createDescription();
  for (const op of ops) applyOp(desc, op);
  const problems = checkDescription(desc);
  if (problems.length) throw Error(`description_check:${problems.join(",")}`);
  return desc;
}

// One case per control, run in sequence the way the browser validator runs them.
export function testCasesOf(desc) {
  const contract = contractOf(desc);
  let state = initialState(desc);
  const cases = [];
  const sample = (schema) =>
    Object.fromEntries(
      Object.entries(schema.properties).map(([field, spec]) => {
        if (spec.enum) return [field, spec.enum.find((option) => option !== "none" && option !== "bench") ?? spec.enum[0]];
        if (spec.type === "boolean") return [field, true];
        return [field, spec.maximum];
      }),
    );
  for (const control of contract.controls) {
    const input = control.name === "reset" ? {} : sample(control.input_schema);
    state = reduce(desc, state, control.name, input);
    cases.push({ name: control.name, input, expected_state: state, selector: "[data-readout]", readout: readoutOf(desc, state) });
  }
  return cases;
}

export function packageScene(ops, { engine = ENGINE, css = CSS } = {}) {
  const desc = describe(ops);
  const contract = contractOf(desc);
  const page = "body{margin:0;background:var(--anatomy-page);color:var(--anatomy-text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}";
  const html = `<!doctype html><html lang="en"><head><title>${escape(desc.scene.title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}${page}</style></head><body class="iso" data-theme="light"><main class="eg-page" id="scene"></main><script src="runtime.js"></script><script src="scene.js"></script></body></html>`;
  const scene = `${engine}\nSceneEngine.boot(${JSON.stringify(ops)});\n`;
  return {
    entry: "index.html",
    files: { "index.html": html, "scene.js": scene },
    manifest: {
      title: desc.scene.title,
      learning_goal: desc.scene.learning_goal,
      model_kind: desc.scene.model_kind,
      assumptions: desc.scene.assumptions,
      limitations: desc.scene.limitations,
      controls: contract.controls,
      state_schema: contract.state_schema,
      representation: "isometric",
    },
    test_cases: testCasesOf(desc),
    beats: desc.beats,
  };
}
