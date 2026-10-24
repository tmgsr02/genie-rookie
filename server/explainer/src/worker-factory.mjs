import { HostedWorker } from "./hosted-worker.mjs";
import { CodexWorker } from "./worker.mjs";
import { DescriberWorker } from "./describer-worker.mjs";
function baseWorker(options) {
  const mode = process.env.EXPLAINER_WORKER || "hosted";
  if (mode === "hosted") return new HostedWorker(options);
  if (mode === "docker") return new CodexWorker(options);
  throw Error("EXPLAINER_WORKER must be hosted or docker");
}
// Isometric intents try the fast scene-engine describer first (DESCRIBER_MODE=off disables it).
// Locally the full browser validator also runs on its packages (DESCRIBER_BROWSER_CHECK=false skips it).
export function createWorker(options = {}) {
  const base = baseWorker(options);
  if ((process.env.DESCRIBER_MODE ?? "isometric") === "off") return base;
  const browserCheck = process.env.DESCRIBER_BROWSER_CHECK === "false" ? null : async (pkg) => (await import("./browser-check.mjs")).validateBrowser(pkg);
  return new DescriberWorker({ env: process.env, fallback: base, browserCheck });
}
