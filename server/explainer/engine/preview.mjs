// Writes a package as one standalone HTML page (runtime and scene inlined, bootstrapped
// with a local identity) for screenshots and the Anatomy line tool:
//   node engine/preview.mjs out.html a.jsonl [b.jsonl …]
import { writeFileSync } from "node:fs";
import { runtime } from "../src/runtime-source.mjs";
import { buildEngine } from "./build.mjs";
import { packageScene } from "./package.mjs";
import { readOps } from "./read-ops.mjs";

export function standalone(pkg) {
  const boot = `window.explainerBootstrap({session_id:"preview",scene_id:"preview",scene_version:1});`;
  const inline = (code) => `<script>${code.replace(/<\/(script)/gi, "<\\/$1")}</script>`;
  // A replacer function, because the minified bundle can contain `$'` and other replacement patterns.
  return pkg.files["index.html"].replace('<script src="runtime.js"></script><script src="scene.js"></script>', () => inline(runtime) + inline(pkg.files["scene.js"]) + inline(boot));
}

if (process.argv[1].endsWith("preview.mjs")) {
  const [out, ...paths] = process.argv.slice(2);
  await buildEngine();
  writeFileSync(out, standalone(packageScene(paths.flatMap((path) => readOps(path)))));
  console.log("wrote", out);
}
