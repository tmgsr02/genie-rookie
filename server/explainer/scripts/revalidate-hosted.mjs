import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { HostedWorker } from "../src/hosted-worker.mjs";
import { normalizePackage } from "../src/package.mjs";
if (!process.argv[2])
  throw Error(
    "Usage: revalidate-hosted.mjs saved-authoring-or-package.json [saved-authoring.json]",
  );
const input = resolve(process.argv[2]),
  data = JSON.parse(await readFile(input, "utf8"));
const source = process.argv[3]
  ? JSON.parse(await readFile(resolve(process.argv[3]), "utf8"))
  : data;
const raw = data.package || data;
const pkg = normalizePackage(raw, {
  scene_id: raw.scene_id || "revalidation",
  scene_version: raw.scene_version || 1,
});
const dir = resolve(process.env.LIVE_ARTIFACT_DIR || dirname(input));
await mkdir(dir, { recursive: true });
const worker = new HostedWorker({
  onExecution: async (result) =>
    writeFile(
      join(dir, "revalidation-execution.json"),
      JSON.stringify(result, null, 2),
    ),
  onArtifacts: async (files) => {
    for (const [name, bytes] of Object.entries(files))
      await writeFile(join(dir, name), bytes);
  },
});
const start = Date.now();
const result = await worker.validate(pkg, source.audit_sources || {}, {
  signal: AbortSignal.timeout(360000),
});
const report = {
  purpose: "revalidation_of_saved_artifact",
  elapsed_ms: Date.now() - start,
  ...result,
};
await writeFile(
  join(dir, "revalidation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
