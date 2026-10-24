import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadTooling,createHostedWorker} from '../cloudflare/hosted-assets.mjs';
import {runtime} from '../src/runtime-source.mjs';

test('prebuilt tooling must match both pinned byte count and digest', async () => {
  const bytes=new TextEncoder().encode('test tooling');
  const descriptor={key:'test',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const bucket={async get(key){assert.equal(key,'test');return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};}};
  assert.deepEqual(await loadTooling(bucket,descriptor),bytes);
  await assert.rejects(loadTooling(undefined,descriptor),/binding_missing/);
  await assert.rejects(loadTooling({get:async()=>null},descriptor),/tooling_missing/);
  await assert.rejects(loadTooling(bucket,{...descriptor,bytes:1}),/size_mismatch/);
  await assert.rejects(loadTooling(bucket,{...descriptor,sha256:'0'.repeat(64)}),/digest_mismatch/);
});
test('portable hosted core uses explicitly injected environment and no node asset loader', async () => {
  const worker=createHostedWorker({HOSTED_AUTHOR_MODE:'direct',OPENAI_API_KEY:'not-a-real-key'},{client:{responses:{}}});
  assert.equal(worker.env.HOSTED_AUTHOR_MODE,'direct');
  assert.ok((await worker.asset('skill')).sha256);
  await assert.rejects(worker.asset('tooling'),/binding_missing/);
});
test('generated runtime source is byte-identical to the trusted browser runtime',async()=>{
  assert.equal(runtime,await readFile(new URL('../runtime/runtime.js',import.meta.url),'utf8'));
});
