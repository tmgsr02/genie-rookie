// TEST FIXTURES ONLY. Never imported by production server/worker/planner.
import { object } from "../src/contracts.mjs";
import { normalizePackage } from "../src/package.mjs";
const state_schema = object({
  value: { type: "integer", minimum: 0, maximum: 10 },
  result: { type: "string", maxLength: 100 },
  paused: { type: "boolean" },
});
const controls = [
  {
    name: "change",
    label: "Try a different amount",
    input_schema: object({
      value: { type: "integer", minimum: 0, maximum: 10 },
    }),
  },
  { name: "reset", label: "Reset", input_schema: object({}) },
  {
    name: "pause",
    label: "Pause",
    input_schema: object({ paused: { type: "boolean" } }),
  },
];
export const intent = {
  learning_goal: "Explore how changing a quantity changes the result.",
  concept: "Runtime contract verification",
  interaction: "Change the quantity and inspect the model output.",
  representation: "mathematical",
  model_kind: "simplified",
  assumptions: ["Explicit test fixture"],
  limitations: ["Not a generated lesson."],
};
export function fixture(
  topic = "mathematics",
  identity = { scene_id: "fixture_" + topic, scene_version: 1 },
) {
  const expression =
    topic === "mathematics"
      ? "String(n)+' × 2 = '+String(n*2)"
      : topic === "science"
        ? "String(n*3)+' N m'"
        : "String(n)+' '+(n===1?'fox':'foxes')";
  const model = new Function("n", "return " + expression);
  const initial = { value: 1, result: model(1), paused: false };
  const manifest = {
    title: topic + " test fixture",
    learning_goal:
      topic === "language"
        ? "Discover singular and plural forms."
        : topic === "science"
          ? "Explore torque for a force at a fixed lever arm."
          : "Explore doubling quantities.",
    model_kind: "simplified",
    representation: topic === "language" ? "language" : "mathematical",
    assumptions: [
      "Deterministic regression fixture",
      ...(topic === "science"
        ? ["Perpendicular force, three metre lever arm"]
        : []),
    ],
    limitations: [
      "This is a test fixture, not live generation or Anatomy artwork.",
    ],
    controls,
    state_schema,
  };
  const html =
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:22px;background:#faf8f2;color:#34364b;font:18px system-ui}h1{font-size:25px}p{line-height:1.5}.surface{background:#fff;border:1px solid #dedce5;border-radius:22px;padding:20px}svg{width:100%;height:180px}button{padding:12px;margin:5px;border-radius:14px;border:1px solid #b9b5cd;background:#f1eefa;font:inherit}#readout{font-size:28px;font-weight:600}</style></head><body><p>REGRESSION FIXTURE · ' +
    topic +
    "</p><h1>" +
    manifest.learning_goal +
    '</h1><div class="surface"><svg id="figure" viewBox="0 0 320 180" aria-label="Model quantity"></svg><p id="readout"></p><button id="change" data-action>Try one more</button><button id="pause">Pause</button><button id="reset">Start again</button></div><p>This fixture verifies model, controls, bridge and readout. It is not newly authored content.</p><script src="runtime.js"></script><script src="scene.js"></script></body></html>';
  const script =
    "(()=>{const model=n=>" +
    expression +
    ";const controls=" +
    JSON.stringify(controls) +
    ";const state_schema=" +
    JSON.stringify(state_schema) +
    ";ExplainerScene.register({controls,state_schema,initial_state:" +
    JSON.stringify(initial) +
    ',reduce(s,name,input){if(name==="reset")return ' +
    JSON.stringify(initial) +
    ';if(name==="pause")return {...s,paused:input.paused};return {...s,value:input.value,result:model(input.value)};},render(s){document.getElementById("readout").textContent=s.result;document.getElementById("figure").innerHTML=Array.from({length:s.value},(_,i)=>\'<circle cx="\'+(20+(i%5)*65)+\'" cy="\'+(40+Math.floor(i/5)*80)+\'" r="18" fill="#9d9cda" stroke="#55516a"/>\').join("");document.getElementById("pause").textContent=s.paused?"Resume":"Pause";},invariants(s){return s.result===model(s.value)&&s.value>=0&&s.value<=10;}});document.getElementById("change").onclick=()=>ExplainerScene.act("change",{value:(ExplainerScene.snapshot().state.value+1)%11});document.getElementById("pause").onclick=()=>ExplainerScene.act("pause",{paused:!ExplainerScene.snapshot().state.paused});document.getElementById("reset").onclick=()=>ExplainerScene.act("reset",{});})();';
  const raw = {
    entry: "index.html",
    files: { "index.html": html, "scene.js": script },
    manifest,
    test_cases: [
      {
        name: "change",
        input: { value: 4 },
        expected_state: { value: 4, result: model(4), paused: false },
        selector: "#readout",
        readout: model(4),
      },
      {
        name: "pause",
        input: { paused: true },
        expected_state: { value: 4, result: model(4), paused: true },
        selector: "#readout",
        readout: model(4),
      },
      {
        name: "reset",
        input: {},
        expected_state: initial,
        selector: "#readout",
        readout: model(1),
      },
    ],
  };
  const pkg = normalizePackage(raw, identity);
  pkg.provenance = "configured";
  return pkg;
}
