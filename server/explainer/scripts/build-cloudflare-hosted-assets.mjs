// Offline build only. No provider requests or runtime containers.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await import('./build-runtime-source.mjs');
const {loadHostedSkill,toolingBundle} = await import('../src/hosted-assets.mjs');
const skill=await loadHostedSkill();
const tooling=await toolingBundle();
const sha256=createHash('sha256').update(tooling).digest('hex');
const manifest={skill,tooling:{key:`hosted/tooling-${sha256}.tar.gz`,bytes:tooling.length,sha256}};
await mkdir(new URL('../.work/cloudflare/',import.meta.url),{recursive:true});
await mkdir(new URL('../cloudflare/',import.meta.url),{recursive:true});
await writeFile(new URL('../.work/cloudflare/tooling.tar.gz',import.meta.url),tooling);
await writeFile(new URL('../cloudflare/hosted-manifest.mjs',import.meta.url),'// Generated offline by scripts/build-cloudflare-hosted-assets.mjs. No secrets.\nexport default '+JSON.stringify(manifest,null,2)+';\n');
console.log(JSON.stringify({file:'.work/cloudflare/tooling.tar.gz',...manifest.tooling,skill_sha256:skill.sha256}));
