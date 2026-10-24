import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  cp,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);
export const root = fileURLToPath(new URL("../", import.meta.url));
export const configPath = () =>
  resolve(
    process.env.HOSTED_SKILL_CONFIG || join(root, ".work/hosted-skill.json"),
  );

// Hash the complete reviewed skill, including examples and license, ignoring Git metadata.
export async function skillDigest() {
  const hash = createHash("sha256");
  let count = 0;
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === ".git" || entry.name === ".DS_Store") continue;
      const path = join(dir, entry.name),
        relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error("skill_symlink");
      if (entry.isDirectory()) await walk(path, relative + "/");
      else {
        const data = await readFile(path);
        hash.update(relative + "\0" + data.length + "\0");
        hash.update(data);
        count++;
      }
    }
  }
  await walk(join(root, "vendor/anatomy"));
  return { sha256: hash.digest("hex"), files: count };
}
export async function loadHostedSkill() {
  let config;
  try {
    config = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    throw Error("hosted_skill_not_configured: run npm run setup:hosted");
  }
  if (
    !/^skill_[a-zA-Z0-9_-]+$/.test(config.skill_id) ||
    !/^\d+$/.test(config.version)
  )
    throw Error("invalid_hosted_skill_config");
  if (config.sha256 !== (await skillDigest()).sha256)
    throw Error("hosted_skill_changed: run npm run setup:hosted");
  return config;
}
export async function provisionSkill(client) {
  const digest = await skillDigest();
  let saved;
  try {
    saved = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {}
  if (saved?.sha256 === digest.sha256) {
    await client.skills.versions.retrieve(saved.version, {
      skill_id: saved.skill_id,
    });
    return saved;
  }
  await mkdir(join(root, ".work"), { recursive: true });
  const temp = await mkdtemp(join(root, ".work/skill-"));
  try {
    const zip = join(temp, "anatomy.zip");
    await exec(
      "zip",
      ["-qr", zip, "anatomy", "-x", "anatomy/.git/*", "*/.DS_Store"],
      { cwd: join(root, "vendor") },
    );
    const skill = await client.skills.create(
      { files: createReadStream(zip) },
      { maxRetries: 0 },
    );
    const config = {
      skill_id: skill.id,
      version: skill.default_version,
      ...digest,
      upstream_commit: (
        await readFile(join(root, "vendor/anatomy.commit"), "utf8")
      ).trim(),
    };
    // Save immediately, so an interrupted readiness check does not re-upload a duplicate.
    await mkdir(resolve(configPath(), ".."), { recursive: true });
    await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await client.skills.versions.retrieve(config.version, {
          skill_id: config.skill_id,
        });
        return config;
      } catch (error) {
        if (error.status !== 404 || attempt === 7) throw error;
        await delay(Math.min(500 * 2 ** attempt, 5000));
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

let bundlePromise;
export function toolingBundle() {
  return (bundlePromise ??= buildToolingBundle().catch((error) => {
    bundlePromise = undefined;
    throw error;
  }));
}
async function buildToolingBundle() {
  await mkdir(join(root, ".work"), { recursive: true });
  const temp = await mkdtemp(join(root, ".work/tooling-"));
  try {
    const app = join(temp, "app");
    await mkdir(join(app, "src"), { recursive: true });
    for (const file of [
      "package.mjs",
      "contracts.mjs",
      "schema-validator.mjs",
      "runtime-source.mjs",
      "browser-check.mjs",
      "validate-child.mjs",
      "hosted-collect.mjs",
      "hosted-preview.mjs",
    ])
      await cp(join(root, "src", file), join(app, "src", file));
    await cp(join(root, "runtime"), join(app, "runtime"), { recursive: true });
    // Only portable runtime dependencies. No SDK, credentials, diagnostics, or host binaries.
    for (const name of [
      "ajv",
      "fast-deep-equal",
      "fast-uri",
      "json-schema-traverse",
      "require-from-string",
      "playwright",
      "playwright-core",
    ])
      await cp(
        join(root, "node_modules", name),
        join(app, "node_modules", name),
        { recursive: true },
      );
    // A byte-identical mirror gives audit source imports a stable path in both sandboxes.
    await cp(join(root, "vendor/anatomy"), join(app, "vendor/anatomy"), {
      recursive: true,
      filter: (path) =>
        !path.split("/").includes(".git") && !path.endsWith("/.DS_Store"),
    });
    await exec(
      "tar",
      [
        ...(process.platform === "darwin"
          ? ["--no-xattrs", "--no-mac-metadata"]
          : []),
        "-czf",
        join(temp, "tooling.tar.gz"),
        "-C",
        temp,
        "app",
      ],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    return await readFile(join(temp, "tooling.tar.gz"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
