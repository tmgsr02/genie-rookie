import {HostedWorker} from '../src/hosted-worker-core.mjs';
import manifest from './hosted-manifest.mjs';

export async function loadTooling(bucket, descriptor = manifest.tooling) {
  if (!bucket) throw Error('hosted_assets_binding_missing');
  const object=await bucket.get(descriptor.key);
  if (!object) throw Error('hosted_tooling_missing');
  if (object.size !== descriptor.bytes) throw Error('hosted_tooling_size_mismatch');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.byteLength!==descriptor.bytes) throw Error('hosted_tooling_size_mismatch');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==descriptor.sha256) throw Error('hosted_tooling_digest_mismatch');
  return bytes;
}
export function createHostedWorker(env, options = {}) {
  let tooling;
  return new HostedWorker({
    env,
    assets: {skill:manifest.skill,tooling:()=>tooling??=loadTooling(env.HOSTED_ASSETS).catch(error=>{tooling=undefined;throw error;})},
    ...options,
  });
}
export {manifest as hostedAssetManifest};
