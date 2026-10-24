import { readFile, writeFile, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
const work = "/mnt/data/gr/job";
const path = join(work, "package.json");
const stat = await lstat(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000)
  throw Error("invalid_output");
const pkg = JSON.parse(await readFile(path, "utf8"));
const reportPath = join(work, "authoring-report.json");
const reportStat = await lstat(reportPath);
if (
  !reportStat.isFile() ||
  reportStat.isSymbolicLink() ||
  reportStat.size > 32768
)
  throw Error("invalid_authoring_report");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const sources = {};
let sourceBytes = 0;
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix + entry.name;
    const full = join(directory, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      if (prefix.split("/").length < 4) await collect(full, relative + "/");
    } else if (
      relative.endsWith(".mjs") &&
      /^[a-zA-Z0-9_/-]+\.mjs$/.test(relative)
    ) {
      sourceBytes += info.size;
      if (sourceBytes > 2_000_000 || Object.keys(sources).length >= 48)
        throw Error("source_limit");
      sources[relative] = await readFile(full, "utf8");
    }
  }
}
if (pkg.manifest?.representation === "isometric") await collect(work);
if (pkg.manifest?.representation === "isometric" && !sources["build.mjs"])
  throw Error(
    "anatomy_build_source_required: implement a reproducible build.mjs using the actual Anatomy kit and audit before collecting",
  );
await writeFile(
  "/mnt/data/gr-result.json",
  JSON.stringify({
    package: pkg,

    authoring_report: report,
    audit_sources: sources,
  }),
);
