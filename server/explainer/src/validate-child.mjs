import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateBrowser } from "./browser-check.mjs";
const exec = promisify(execFile);
const work = process.env.WORK_ROOT || "/work";
const anatomy = fileURLToPath(new URL("../vendor/anatomy/", import.meta.url));
let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (body.length > 6_000_000) throw Error("input_limit");
}
try {
  const { package: pkg, audit_sources: sources = {} } = JSON.parse(body);
  const inlineDocument = process.env.HOSTED_INLINE_DOCUMENT === "1";
  const validation = await validateBrowser(pkg, {
    artifactDir: process.env.VALIDATION_ARTIFACT_DIR,
    inlineDocument,
  });
  if (pkg.manifest.representation === "isometric") {
    if (!sources["build.mjs"]) throw Error("anatomy_build_source_required");
    await mkdir(join(work, "audit"), { recursive: true });
    let bytes = 0;
    for (const [path, source] of Object.entries(sources)) {
      if (
        !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(path) ||
        typeof source !== "string"
      )
        throw Error("unsafe_audit_source");
      bytes += Buffer.byteLength(source);
      if (bytes > 2_000_000 || Object.keys(sources).length > 48)
        throw Error("audit_source_limit");
      await mkdir(dirname(join(join(work, "audit"), path)), {
        recursive: true,
      });
      await writeFile(join(join(work, "audit"), path), source);
    }
    const env = {
      PATH: process.env.PATH,
      HOME: work,
      TMPDIR: "/tmp",
      CHROME_PATH: process.env.CHROME_PATH,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    };
    await mkdir(join(work, "delivery"), { recursive: true });
    for (const [path, source] of Object.entries(pkg.files)) {
      await mkdir(dirname(join(join(work, "delivery"), path)), {
        recursive: true,
      });
      await writeFile(join(join(work, "delivery"), path), source);
    }
    const lines = inlineDocument
      ? null
      : await exec(
          process.execPath,
          [
            join(anatomy, "scripts/lines.mjs"),
            join(work, "delivery/index.html"),
            "--out",
            join(work, "lines.png"),
          ],
          {
            cwd: join(work, "delivery"),
            timeout: 40000,
            maxBuffer: 512000,
            env,
          },
        );
    if (lines && !/line ends:\s*0\b/.test(lines.stdout))
      throw Error("anatomy_line_check_not_passed");
    const audit = await exec(process.execPath, ["build.mjs", "--audit"], {
      cwd: join(work, "audit"),
      timeout: 40000,
      maxBuffer: 512000,
      env,
    });
    if (
      !/\baudit passed\b/i.test(audit.stdout) ||
      /\b(?:failed|failures:\s*[1-9])\b/i.test(audit.stdout)
    )
      throw Error("anatomy_audit_not_passed");
    validation.checks.push(
      {
        name: "anatomy_geometry_audit",
        passed: true,
        output: audit.stdout.slice(-4000),
      },
      ...(lines
        ? [
            {
              name: "anatomy_delivered_line_check",
              passed: true,
              output: lines.stdout.slice(-4000),
            },
          ]
        : []),
    );
  }
  process.stdout.write(JSON.stringify(validation));
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
}
