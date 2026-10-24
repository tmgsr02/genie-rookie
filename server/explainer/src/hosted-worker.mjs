// Node adapter. Cloudflare imports hosted-worker-core.mjs through its R2 adapter.
import { HostedWorker as HostedWorkerCore } from "./hosted-worker-core.mjs";
import { loadHostedSkill, toolingBundle } from "./hosted-assets.mjs";
export { completeAuthoring, verifiedShellOutput, withHostedContainer } from "./hosted-worker-core.mjs";
export class HostedWorker extends HostedWorkerCore {
  constructor(options = {}) {
    super({ env: process.env, assets: {skill: loadHostedSkill, tooling: toolingBundle}, ...options });
  }
}
