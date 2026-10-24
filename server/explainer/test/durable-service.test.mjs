import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplainerService } from '../src/service.mjs';
import { intent } from './fixtures.mjs';

test('session serialization preserves settled idempotency and marks interrupted work safely',async()=>{
 const a=new ExplainerService({planner:{plan:async()=>({dialogue:[],tools:[]})}});
 const c=a.create(),s=a.session(c.session_id,c.session_token),input={request_id:'one',text:'Question'};
 const answer=await a.turn(s,input);
 s.requests.set('pending',{hash:'abc',status:'pending',promise:new Promise(()=>{})});
 const b=new ExplainerService({planner:{plan:()=>{throw Error('must not repeat');}}});
 b.restore(JSON.parse(JSON.stringify(a.snapshot())));
 const restored=b.session(c.session_id,c.session_token);
 assert.deepEqual(await b.turn(restored,input),answer);
 await assert.rejects(restored.requests.get('pending').promise,/interrupted_request/);
});
test('external generation persists requested job before dispatch and accepts one completion',async()=>{
 const order=[];let params;
 const service=new ExplainerService({persist:async()=>order.push('persist'),dispatch:async(s,j,request)=>{order.push('dispatch');params=request;}});
 const c=service.create(),s=service.session(c.session_id,c.session_token);
 const job=await service.tool(s,{request_id:'create',name:'create_explainer',arguments:{intent}});
 assert.ok(order.indexOf('persist')<order.indexOf('dispatch'));assert.equal(params.scene_id,job.scene_id);
 const result={package:{scene_id:job.scene_id,scene_version:1,validation:{passed:true}},metrics:{total_ms:1}};
 service.complete(s,job.job_id,{result});service.complete(s,job.job_id,{result});
 assert.equal(service.getJob(s,job.job_id).status,'ready');
 assert.equal(s.events.filter(e=>e.status==='ready').length,1);
 const next=new ExplainerService({dispatch:async()=>{}});next.restore(JSON.parse(JSON.stringify(service.snapshot())));
 const r=next.session(c.session_id,c.session_token);assert.equal(next.getJob(r,job.job_id).status,'ready');
 assert.equal(r.pendingJob,r.jobs.get(job.job_id));
});
