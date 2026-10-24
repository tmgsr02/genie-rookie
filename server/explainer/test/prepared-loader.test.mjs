import test from 'node:test';
import assert from 'node:assert/strict';
import descriptor from '../cloudflare/raptor-manifest.mjs';
import {loadPreparedRaptor} from '../cloudflare/prepared-raptor.mjs';
const request={scene_id:'reviewed_reference',scene_version:1};
test('prepared loader fetches only its pinned key and rejects missing storage objects',async()=>{
 await assert.rejects(loadPreparedRaptor({get:async key=>{assert.equal(key,descriptor.key);return null;}},request),/reference_asset_missing/);
});
test('prepared loader rejects mismatched declared length before reading content',async()=>{
 await assert.rejects(loadPreparedRaptor({get:async()=>({size:descriptor.bytes+1,arrayBuffer:()=>assert.fail('must not read mismatched artifact')})},request),/reference_asset_missing/);
});
test('prepared loader rejects changed actual length and bytes even when declared length matches',async()=>{
 for(const length of [descriptor.bytes,descriptor.bytes+1]){
  await assert.rejects(loadPreparedRaptor({get:async()=>({size:descriptor.bytes,arrayBuffer:async()=>new Uint8Array(length).buffer})},request),/reference_digest_mismatch/);
 }
});
