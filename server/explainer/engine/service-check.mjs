// Asks a running explainer service one question through its public API, the way the app does,
// and reports the job's timing and metrics. Costs one planner turn and one generation.
//   node engine/service-check.mjs [https://service] ["question"]
const base = process.argv[2] ?? "https://genie-rookie-demo.genie-rookie.workers.dev";
const question = process.argv[3] ?? "/anatomy explain how a space rocket works, interactive";
const started = Date.now();
const ms = () => Date.now() - started;

async function call(path, { method = "GET", token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(`${method} ${path} ${response.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const session = await call("/v1/sessions", { method: "POST", body: {} });
const token = session.session_token;
const turn = await call(`/v1/sessions/${session.session_id}/turns`, { method: "POST", token, body: { request_id: `check_${Date.now()}`, text: question } });
const planned = ms();
const job = turn.job_id;
if (!job) throw Error(`no job started: ${JSON.stringify(turn).slice(0, 300)}`);
console.error(`${planned} ms  planned, session ${session.session_id}, job ${job}`);
let cursor = 0;
let status = "";
const marks = {};
while (!["ready", "failed", "cancelled"].includes(status) && ms() < 6 * 60 * 1000) {
  // Read the job itself too, so a missed event never leaves this waiting.
  status = (await call(`/v1/sessions/${session.session_id}/jobs/${job}`, { token })).status ?? status;
  if (["ready", "failed", "cancelled"].includes(status)) break;
  const events = await call(`/v1/sessions/${session.session_id}/events?after=${cursor}`, { token });
  cursor = events.cursor ?? cursor;
  for (const event of events.events ?? []) {
    if (event.job_id !== job) continue;
    status = event.status ?? status;
    const key = event.progress?.phase ? `${status}:${event.progress.phase}` : status;
    if (!marks[key]) {
      marks[key] = ms();
      console.error(`${marks[key]} ms  ${key}`);
    }
  }
}
const result = await call(`/v1/sessions/${session.session_id}/jobs/${job}`, { token });
console.log(JSON.stringify({ status: result.status, planned_ms: planned, total_ms: ms(), metrics: result.metrics, provenance: result.package?.provenance, title: result.package?.manifest?.title, checks: result.package?.validation?.checks?.map((check) => check.name) }, null, 2));
