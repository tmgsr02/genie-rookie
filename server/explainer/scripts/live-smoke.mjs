import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ExplainerService } from "../src/service.mjs";
import { createWorker } from "../src/worker-factory.mjs";
import { Planner } from "../src/planner.mjs";
if (!process.env.OPENAI_API_KEY) {
  console.error(
    "BLOCKED: OPENAI_API_KEY is unset. Set the server-only key, run setup:hosted, then rerun.",
  );
  process.exit(2);
}
const question =
  process.argv.slice(2).join(" ") ||
  "Why does changing the order of words change a sentence? Let me move the words and compare the meaning.";
const artifactDir = resolve(
  process.env.LIVE_ARTIFACT_DIR ||
    fileURLToPath(new URL("../artifacts/hosted-live/", import.meta.url)),
);
await mkdir(artifactDir, { recursive: true });
const worker = createWorker({
  onAuthored: async (result) =>
    writeFile(join(artifactDir, "live-authoring.json"), JSON.stringify(result)),
  onExecution: async (result) => {
    await writeFile(
      join(artifactDir, `${result.phase}-execution.json`),
      JSON.stringify(result, null, 2),
    );
    if (result.attempt)
      await writeFile(
        join(artifactDir, `${result.phase}-${result.attempt}-execution.json`),
        JSON.stringify(result, null, 2),
      );
  },
  onArtifacts: async (files) => {
    for (const [name, data] of Object.entries(files))
      await writeFile(join(artifactDir, name), data);
  },
});
const author = worker.author.bind(worker);
worker.author = async (request) => {
  try {
    return await author(request);
  } catch (error) {
    // Operator-only diagnostics for this explicit smoke command. Never send
    // provider/worker details to the child's UI or print credential values.
    const detail = String(error.detail || error.message)
      .split(process.env.OPENAI_API_KEY)
      .join("[REDACTED]");
    console.error(
      JSON.stringify({
        type: "worker_failure",
        detail: detail.slice(-6000),
        errors: error.details,
      }),
    );
    throw error;
  }
};
const service = new ExplainerService({
  worker,
  planner: new Planner(),
});
const credentials = service.create(),
  s = service.session(credentials.session_id, credentials.session_token);
const started = Date.now();
try {
  const turn = await service.turn(s, {
    request_id: "live_" + randomUUID(),
    text: question,
  });
  console.log(
    JSON.stringify({
      type: "planner_response",
      dialogue: turn.dialogue,
      job_id: turn.job_id,
    }),
  );
  if (!turn.job_id) {
    console.error(
      "Planner requested clarification instead of authoring. Supply a more specific runtime question.",
    );
    process.exitCode = 3;
  } else {
    let job;
    do {
      await delay(1000);
      job = service.getJob(s, turn.job_id);
    } while (!["ready", "failed", "cancelled"].includes(job.status));
    const report = {
      status: job.status,
      error: job.error,
      metrics: job.metrics,
      total_wall_ms: Date.now() - started,
      provenance: job.package?.provenance,
      validation: job.package?.validation,
    };
    await writeFile(
      join(artifactDir, "live-result.json"),
      JSON.stringify(report, null, 2),
    );
    if (job.package)
      await writeFile(
        join(artifactDir, "live-package.json"),
        JSON.stringify(job.package),
      );
    console.log(JSON.stringify(report, null, 2));
    if (job.status !== "ready") process.exitCode = 1;
  }
} catch (error) {
  console.error("Live verification failed:", error.code || error.message);
  process.exitCode = 1;
}
