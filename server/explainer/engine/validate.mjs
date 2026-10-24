// Packages a description and runs the service's own browser validator on it:
//   node engine/validate.mjs engine/examples/spring-scale.jsonl [more.jsonl …] [--out dir]
import { mkdirSync } from "node:fs";
import { normalizePackage } from "../src/package.mjs";
import { validateBrowser } from "../src/browser-check.mjs";
import { buildEngine } from "./build.mjs";
import { packageScene } from "./package.mjs";
import { readOps } from "./read-ops.mjs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const ops = args.flatMap((path) => readOps(path));

const t0 = performance.now();
await buildEngine();
const t1 = performance.now();
const pkg = normalizePackage(packageScene(ops), { scene_id: "engine_check", scene_version: args.length });
const t2 = performance.now();
if (out) mkdirSync(out, { recursive: true });
const result = await validateBrowser(pkg, { artifactDir: out ?? undefined });
const t3 = performance.now();
console.log(JSON.stringify({ ops: ops.length, build_ms: Math.round(t1 - t0), package_ms: Math.round(t2 - t1), browser_ms: Math.round(t3 - t2), ...result }, null, 2));
