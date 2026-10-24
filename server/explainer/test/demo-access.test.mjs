import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExplainerService } from '../src/service.mjs';
import { createServer } from '../src/server.mjs';
import { intent } from './fixtures.mjs';

const temp = (t) => { const dir=mkdtempSync(join(tmpdir(),'demo-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return join(dir,'usage.json'); };
const listen = async (t, server) => { await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>{server.closeAllConnections();server.close();}); return `http://127.0.0.1:${server.address().port}`; };
test('public demo bypasses bootstrap only explicitly and requires a durable ledger', async t=>{
  const env={PUBLIC_DEMO_ENABLED:'true',DEMO_USAGE_PATH:temp(t),BOOTSTRAP_TOKEN:'private'};
  const base=await listen(t,createServer(new ExplainerService(),{env}));
  const response=await fetch(base+'/v1/sessions',{method:'POST',body:'{}'});
  assert.equal(response.status,201);
  assert.ok((await response.json()).session_token);
  assert.equal((await (await fetch(base+'/health')).json()).access_mode,'public_demo');
  assert.throws(()=>createServer(new ExplainerService(),{env:{PUBLIC_DEMO_ENABLED:'true'}}),/DEMO_USAGE_PATH/);
});
test('bootstrap remains required outside public mode; voice credentials are app scoped',async t=>{
  const base=await listen(t,createServer(new ExplainerService(),{env:{BOOTSTRAP_TOKEN:'private',BOSON_API_KEY:'test'}}));
  assert.equal((await fetch(base+'/v1/sessions',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/v1/voice-sessions',{method:'POST',body:'{}'})).status,401);
  const result=await fetch(base+'/v1/voice-sessions',{method:'POST',headers:{Authorization:'Bearer private'},body:'{}'});
  assert.equal(result.status,201);
  const credential=await result.json(); assert.ok(credential.token.length>=64); assert.ok(Date.parse(credential.expires_at)>Date.now());
  assert.equal((await fetch(base+'/v1/ready',{headers:{Authorization:'Bearer '+credential.token}})).status,401);
  const ready=await fetch(base+'/v1/ready',{headers:{Authorization:'Bearer '+credential.token,'X-App-ID':'genius-rookie'}});
  assert.deepEqual(await ready.json(),{voices:['genius','rookie'],format:'pcm_s16le',sample_rate:24000,channels:1});
});
test('generation quota is durable, idempotent and checked before cancelling an existing job',async t=>{
  const path=temp(t), env={PUBLIC_DEMO_ENABLED:'true',DEMO_USAGE_PATH:path,DEMO_DAILY_GENERATIONS:'1'};
  const service=new ExplainerService({worker:{author:()=>new Promise(()=>{})}});
  const server=createServer(service,{env}); t.after(()=>server.close());
  const c=service.create(),s=service.session(c.session_id,c.session_token);
  const call={request_id:'first',name:'create_explainer',arguments:{intent}};
  const a=await service.tool(s,call); assert.equal((await service.tool(s,call)).job_id,a.job_id);
  await assert.rejects(service.tool(s,{...call,request_id:'second'}),/demo_generation_limit/);
  assert.equal(s.pendingJob.abort.signal.aborted,false);
  assert.equal(JSON.parse(readFileSync(path)).counts.generation,1);
  const other=new ExplainerService(); const restart=createServer(other,{env}); t.after(()=>restart.close());
  const d=other.create(); await assert.rejects(other.tool(other.session(d.session_id,d.session_token),call),/demo_generation_limit/);
});
test('planner retry charges once and corrupt ledger fails closed',async t=>{
  const path=temp(t),service=new ExplainerService({planner:{plan:async()=>({dialogue:[],tools:[]})}});
  const server=createServer(service,{env:{PUBLIC_DEMO_ENABLED:'true',DEMO_USAGE_PATH:path,DEMO_DAILY_PLANNER_TURNS:'1'}}); t.after(()=>server.close());
  const c=service.create(),s=service.session(c.session_id,c.session_token),turn={request_id:'one',text:'Question'};
  await service.turn(s,turn);await service.turn(s,turn);
  await assert.rejects(service.turn(s,{...turn,request_id:'two'}),/demo_planner_limit/);
  writeFileSync(path,'broken');
  await assert.rejects(service.tool(s,{request_id:'job',name:'create_explainer',arguments:{intent}}),/demo_usage_unavailable/);
  assert.equal(s.jobs.size,0);
});

test('voice provisioning requires explicit public mode or configured bootstrap and a Bearer scheme',async t=>{
 const local=await listen(t,createServer(new ExplainerService(),{env:{}}));
 assert.equal((await fetch(local+'/v1/voice-sessions',{method:'POST',body:'{}'})).status,503);
 const base=await listen(t,createServer(new ExplainerService(),{env:{BOOTSTRAP_TOKEN:'private',BOSON_API_KEY:'test'}}));
 assert.equal((await fetch(base+'/v1/voice-sessions',{method:'POST',headers:{Authorization:'private'},body:'{}'})).status,401);
 const {token}=await(await fetch(base+'/v1/voice-sessions',{method:'POST',headers:{Authorization:'Bearer private'},body:'{}'})).json();
 assert.equal((await fetch(base+'/v1/ready',{headers:{Authorization:token,'X-App-ID':'genius-rookie'}})).status,401);
});

test('daily budgets reset at UTC midnight and failed persistence stays closed',async t=>{
 const {DemoUsage}=await import('../src/demo-access.mjs');
 let now=Date.parse('2026-10-24T23:59:59Z');const path=temp(t);
 const ledger=new DemoUsage(path,{generation:2,planner:2,speech:5},{now:()=>now});
 ledger.charge('speech',5);assert.throws(()=>ledger.charge('speech',1),/demo_speech_limit/);
 now+=1000;ledger.charge('speech',1);assert.equal(JSON.parse(readFileSync(path)).counts.speech,1);
 rmSync(path);assert.throws(()=>ledger.charge('generation'),/demo_usage_unavailable/);
 assert.throws(()=>ledger.charge('generation'),/demo_usage_unavailable/);
 assert.throws(()=>new DemoUsage(join(path,'nonexistent','usage.json'),{generation:2,planner:2,speech:5}),/demo_usage_unavailable/);
});
test('voice sessions expire, enforce capacity, and limit speech requests',async()=>{
 const {VoiceSessions}=await import('../src/demo-access.mjs');let now=0;
 const registry=new VoiceSessions({ttl:100,max:1,now:()=>now});const first=registry.create();
 assert.throws(()=>registry.create(),/voice_session_capacity/);
 for(let i=0;i<30;i++)registry.authorize(first.token,'genius-rookie');
 assert.throws(()=>registry.authorize(first.token,'genius-rookie'),/speech_rate_limited/);
 now=100;assert.throws(()=>registry.authorize(first.token,'genius-rookie'),/unauthorized/);
 assert.ok(registry.create().token);
});
test('pending queue rejection does not charge or cancel an existing candidate',async t=>{
 const service=new ExplainerService({maxConcurrent:0});const path=temp(t);
 const server=createServer(service,{env:{PUBLIC_DEMO_ENABLED:'true',DEMO_USAGE_PATH:path,MAX_PENDING_JOBS:'1'}});t.after(()=>server.close());
 const c=service.create(),s=service.session(c.session_id,c.session_token),call={request_id:'one',name:'create_explainer',arguments:{intent}};
 await service.tool(s,call);
 await assert.rejects(service.tool(s,{...call,request_id:'two'}),/queue_capacity/);
 assert.equal(s.pendingJob.abort.signal.aborted,false);assert.equal(JSON.parse(readFileSync(path)).counts.generation,1);
});
test('public sessions can reserve only six jobs, including cancelled jobs',async t=>{
 const service=new ExplainerService({maxConcurrent:0}),path=temp(t);
 const server=createServer(service,{env:{PUBLIC_DEMO_ENABLED:'true',DEMO_USAGE_PATH:path}});t.after(()=>server.close());
 const c=service.create(),s=service.session(c.session_id,c.session_token);
 for(let i=0;i<6;i++)await service.tool(s,{request_id:'job'+i,name:'create_explainer',arguments:{intent}});
 await assert.rejects(service.tool(s,{request_id:'seventh',name:'create_explainer',arguments:{intent}}),/job_limit/);
 assert.equal(JSON.parse(readFileSync(path)).counts.generation,6);
});
