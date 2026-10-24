import OpenAI from 'openai';
import {createReadStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import manifest from '../cloudflare/hosted-manifest.mjs';
const api=new OpenAI();
const configURL=new URL('../cloudflare/agents-manifest.mjs',import.meta.url);
let saved;
try {saved=(await import(configURL.href)).default;} catch {}
if(saved?.sha256===manifest.tooling.sha256) {
  await api.files.retrieve(saved.file_id);
  console.log(JSON.stringify({reused:true,file_id:saved.file_id}));
} else {
  const file=await api.files.create({file:createReadStream(new URL('../.work/cloudflare/tooling.tar.gz',import.meta.url)),purpose:'user_data'});
  const config={file_id:file.id,sha256:manifest.tooling.sha256,bytes:manifest.tooling.bytes};
  await writeFile(configURL,'// Provisioned tooling resource; no secrets.\nexport default '+JSON.stringify(config,null,2)+';\n');
  console.log(JSON.stringify({uploaded:true,...config}));
}
