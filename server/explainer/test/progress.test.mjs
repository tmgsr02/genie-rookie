import test from 'node:test';import assert from 'node:assert/strict';
import {ExplainerService} from '../src/service.mjs';
test('progress is bounded and rejects stale or terminal jobs',()=>{
 const service=new ExplainerService();const credentials=service.create();const s=service.sessions.get(credentials.session_id);
 const j={job_id:'job',scene_id:'scene',scene_version:1,status:'generating'};s.pendingJob=j;
 service.progress(s,j,{phase:'preparing',elapsed_ms:0});assert.deepEqual(j.progress,{phase:'preparing',elapsed_ms:0});
 assert.throws(()=>service.progress(s,j,{phase:'private reasoning',elapsed_ms:2}),/invalid_progress/);
 assert.throws(()=>service.progress(s,j,{phase:'authoring',elapsed_ms:-1}),/invalid_progress/);
 const count=s.events.length;s.pendingJob={};service.progress(s,j,{phase:'authoring',elapsed_ms:2});assert.equal(s.events.length,count);
 s.pendingJob=j;service.transition(s,j,'cancelled');assert.equal(j.progress,undefined);
 service.progress(s,j,{phase:'authoring',elapsed_ms:2});assert.equal(j.progress,undefined);
});
