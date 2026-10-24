import { readFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizePackage } from "./package.mjs";
const job = "/mnt/data/gr/job";
// Collect and exercise exactly the same input as the independent final gate.
await import("./hosted-collect.mjs");
const result = JSON.parse(await readFile("/mnt/data/gr-result.json", "utf8"));
const pkg = normalizePackage(result.package, {
  scene_id: "preview",
  scene_version: 1,
});
await mkdir(`${job}/preview`, { recursive: true });
const check = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./validate-child.mjs", import.meta.url))],
  {
    input: JSON.stringify({
      package: pkg,
      audit_sources: result.audit_sources,
    }),
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1000000,
    env: {
      ...process.env,
      HOSTED_INLINE_DOCUMENT: "1",
      WORK_ROOT: "/mnt/data/gr/preview-check",
      VALIDATION_ARTIFACT_DIR: `${job}/preview`,
    },
  },
);
if (check.error || check.status !== 0)
  throw Error(check.error?.message || check.stderr || "preview_failed");
console.log(check.stdout);
