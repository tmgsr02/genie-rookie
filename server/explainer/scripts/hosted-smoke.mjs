import { mkdir, writeFile } from "node:fs/promises";
import { HostedWorker } from "../src/hosted-worker.mjs";
import { fixture } from "../test/fixtures.mjs";
const dir = new URL("../artifacts/hosted/", import.meta.url);
await mkdir(dir, { recursive: true });
const worker = new HostedWorker({
  onExecution: async (result) =>
    writeFile(
      new URL(`${result.phase}-execution.json`, dir),
      JSON.stringify(result, null, 2),
    ),
  onArtifacts: async (files) => {
    for (const [name, data] of Object.entries(files))
      await writeFile(new URL(name, dir), data);
  },
});
const results = [];
for (const topic of ["mathematics", "science", "language"]) {
  const started = Date.now();
  try {
    const result = await worker.validate(
      fixture(topic),
      {},
      { signal: AbortSignal.timeout(240000) },
    );
    results.push({ topic, elapsed_ms: Date.now() - started, ...result });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    console.error(
      JSON.stringify({ topic, error: error.message, detail: error.detail }),
    );
    process.exitCode = 1;
    break;
  }
}
await writeFile(
  new URL("fixture-results.json", dir),
  JSON.stringify(results, null, 2),
);
