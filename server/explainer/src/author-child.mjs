import { authorInstruction } from "./author-prompt.mjs";
import { Codex } from "@openai/codex-sdk";
import {
  mkdir,
  writeFile,
  readFile,
  lstat,
  readdir,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (body.length > 4_000_000) throw Error("input_limit");
}
const request = JSON.parse(body),
  work = "/work/job";
await mkdir(work, { recursive: true });
await mkdir("/work/home", { recursive: true });
await mkdir(join(work, ".agents/skills"), { recursive: true });
await symlink(
  "/app/vendor/anatomy",
  join(work, ".agents/skills/anatomy"),
  "dir",
);
await writeFile(join(work, "intent.json"), JSON.stringify(request.intent));
if (request.previous)
  await writeFile(
    join(work, "previous.json"),
    JSON.stringify(request.previous),
  );
const instruction = authorInstruction();
const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
  env: {
    PATH: process.env.PATH,
    HOME: "/work/home",
    TMPDIR: "/tmp",
    CHROME_PATH: process.env.CHROME_PATH || "",
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright",
  },
  config: {
    shell_environment_policy: {
      inherit: "none",
      set: {
        PATH: process.env.PATH,
        HOME: "/work/home",
        TMPDIR: "/tmp",
        CHROME_PATH: process.env.CHROME_PATH || "",
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright",
      },
    },
    sandbox_workspace_write: {
      exclude_tmpdir_env_var: true,
      exclude_slash_tmp: false,
    },
  },
});
const thread = codex.startThread({
  model: process.env.CODEX_MODEL || "gpt-5.4",
  workingDirectory: work,
  skipGitRepoCheck: true,
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
});
const result = await thread.run(instruction, {
  signal: AbortSignal.timeout(Number(process.env.JOB_TIMEOUT_MS || 900000)),
});
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
process.stdout.write(
  JSON.stringify({
    package: pkg,
    usage: result.usage,
    authoring_report: report,
    audit_sources: sources,
  }),
);
