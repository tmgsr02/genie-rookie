// Writes the end-to-end stream demo: a page that plays a conversation while a scene
// description streams in at a model-like token rate, feeds each completed line to the
// engine, speaks the description's lines with word-timed cues, and then streams a
// follow-up into the same live scene.
//   node engine/demo.mjs [out.html]      (page options: ?tps=120&ttft=600&wps=2.6)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngine } from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(HERE, "..", ".work", "engine", "stream-demo.html");
const { script, css } = await buildEngine();
const turns = [
  { child: "Why does a heavier weight stretch a spring more?", opener: { speaker: "genie", say: "Ooh, good question. Let me set up a spring for us to test." }, stream: readFileSync(join(HERE, "examples", "spring-scale.jsonl"), "utf8") },
  { child: "What if there were two springs?", opener: { speaker: "rookie", say: "Two springs? Let me hang another one." }, stream: readFileSync(join(HERE, "examples", "spring-scale-two-springs.jsonl"), "utf8") },
];

const harness = String.raw`
const TURNS = __TURNS__;
const params = new URLSearchParams(location.search);
const TPS = Number(params.get("tps") || 120);      // model output tokens per second
const TTFT = Number(params.get("ttft") || 600);    // time to first token, ms
const WPS = Number(params.get("wps") || 2.6);      // speech rate, words per second
const CHARS_PER_TOKEN = 3.6;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
let engine, state, interrupted = false, t0 = 0;
const now = () => Math.round(performance.now() - t0);
function mark(text) {
  log.push(now() + " ms " + text);
  $("#log").textContent = log.slice(-6).join("\n");
  document.body.dataset.phase = text;
}
function show() { engine.show(state, { paused: false, reduced_motion: still }); }
function apply(name, input) {
  state = SceneEngine.reduce(engine.desc, state, name, input);
  show();
}
function heard(text) { $("#child").textContent = text; $("#child").dataset.on = ""; }
async function say(line) {
  interrupted = false;
  const words = line.say.split(/\s+/);
  const box = $("#caption");
  box.dataset.speaker = line.speaker;
  $("#speaker").textContent = line.speaker === "rookie" ? "Rookie" : "Genie";
  const holder = box.querySelector(".words");
  holder.replaceChildren(...words.map((word) => {
    const span = document.createElement("span");
    span.textContent = word + " ";
    return span;
  }));
  for (let i = 0; i < words.length; i++) {
    if (interrupted) { mark("interrupted · visual kept"); return false; }
    box.querySelectorAll("span").forEach((s, j) => s.toggleAttribute("data-said", j <= i));
    for (const cue of line.cues ?? []) if (cue.word === i) {
      if (cue.focus) { state = { ...state, focus: cue.focus }; show(); }
      else apply(cue.control, cue.input);
    }
    await sleep(1000 / WPS);
  }
  await sleep(350);
  return true;
}
async function stream(text) {
  const started = now();
  let first = null, firstPart = null, ops = 0;
  const reader = SceneEngine.lineReader((op) => {
    const note = engine.feed(op);
    ops++;
    if (first === null) first = now();
    if (note.kind === "part" && firstPart === null) { firstPart = now(); mark("first part on screen"); }
    state = { ...engine.state, ...state };
    $("#status").textContent = "streaming description · " + ops + " ops · " + ((now() - started) / 1000).toFixed(1) + " s";
  });
  await sleep(TTFT);
  const chunk = Math.max(4, Math.round(CHARS_PER_TOKEN * TPS / 30));
  for (let at = 0; at < text.length; at += chunk) {
    reader.push(text.slice(at, at + chunk));
    await sleep(1000 / 30);
  }
  reader.end();
  const problems = SceneEngine.checkDescription(engine.desc);
  const total = now() - started;
  $("#status").textContent = (problems.length ? "check failed: " + problems.join(", ") : "scene ready") + " · " + ops + " ops · first part " + ((firstPart - started) / 1000).toFixed(1) + " s · complete " + (total / 1000).toFixed(1) + " s";
  mark(problems.length ? "description check failed" : "scene ready");
  return problems;
}
async function run() {
  t0 = performance.now();
  $("#scene").replaceChildren();
  log.length = 0;
  engine = SceneEngine.createEngine($("#scene"), {
    onTouch(part) {
      const command = SceneEngine.touchInput(engine.desc, part, state);
      if (command) { apply(command.name, command.input); mark("touch · " + command.name + " " + JSON.stringify(command.input)); }
    },
  });
  state = { paused: false, focus: "none" };
  for (const [index, turn] of TURNS.entries()) {
    heard(turn.child);
    mark("child asked · turn " + (index + 1));
    await sleep(500);
    // The characters keep talking while the description streams in.
    const streaming = stream(turn.stream);
    await say(turn.opener);
    await streaming;
    for (const beat of engine.desc.beats.slice(turn.firstBeat ?? 0)) {
      if (beat.done) continue;
      beat.done = true;
      if (!(await say(beat))) break;
    }
    await sleep(900);
  }
  state = { ...state, focus: "none" }; show();
  mark("done");
  document.body.dataset.done = "";
}
addEventListener("keydown", (event) => { if (event.key === " ") { event.preventDefault(); interrupted = true; } });
run();
`;

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scene engine stream demo</title><style>${css}
body{margin:0;background:var(--anatomy-page);color:var(--anatomy-text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
.demo{max-width:720px;margin:0 auto;padding:12px;display:grid;gap:10px}
#child{font-size:14px;color:var(--anatomy-muted);min-height:1.5em}
#child::before{content:"Child · ";font-family:var(--anatomy-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
#caption{min-height:4.4em;padding:10px 14px;border-radius:12px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-faint)}
#speaker{display:block;font-family:var(--anatomy-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--anatomy-muted)}
#caption[data-speaker=rookie] #speaker{color:#b4691f}
.words span{color:var(--anatomy-muted);transition:color .12s}
.words span[data-said]{color:var(--anatomy-strong)}
#status,#log{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);white-space:pre-wrap;margin:0}
</style></head><body class="iso" data-theme="light"><main class="demo"><div id="child"></div><div id="scene"></div><div id="caption"><span id="speaker"></span><span class="words"></span></div><p id="status"></p><pre id="log"></pre></main><script>${script.replace(/<\/(script)/gi, "<\\/$1")}</script><script>${harness.replace("__TURNS__", () => JSON.stringify(turns))}</script></body></html>`;
writeFileSync(out, page);
console.log("wrote", out, `${(page.length / 1024).toFixed(0)} KB`);
