import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorObject } from '../cloudflare/tutor-object.mjs';
import { intent } from './fixtures.mjs';
class Storage {
 constructor(){this.values=new Map();this.writes=0;}
 async get(key){if(Array.isArray(key)){assert.ok(key.length<=128);return new Map(key.filter(k=>this.values.has(k)).map(k=>[k,structuredClone(this.values.get(k))]));}return structuredClone(this.values.get(key));}
 async put(key,value){const entries=typeof key==='object'?Object.entries(key):[[key,value]];assert.ok(entries.length<=128);for(const [k,v]of entries){assert.ok(Buffer.byteLength(JSON.stringify(v))<128*1024);this.values.set(k,structuredClone(v));this.writes++;}}
 async delete(keys){for(const k of typeof keys==='string'?[keys]:keys){if(this.values.delete(k))this.writes++;}}
 async transaction(run){return run(this);}
}
function setup(storage=new Storage(),overrides={}){
 const workflows=new Map();const env={PUBLIC_DEMO_ENABLED:'true',GENERATION:{async create({id,params}){assert.deepEqual(Object.keys(params).sort(),['job_id','session_id']);if(workflows.has(id))throw Error('exists');workflows.set(id,{params});},async get(id){if(!workflows.has(id))throw Error('missing');return {async status(){return {status:'running'};},async terminate(){workflows.get(id).terminated=true;}};}},...overrides};
 const ctx={storage,blockConcurrencyWhile:fn=>fn()};const object=new TutorObject(ctx,env);
 object.service.planner={plan:async()=>({dialogue:[],tools:[]})};
 return {object,storage,env,workflows};
}
const call=(object,path,value,token)=>object.fetch(new Request('https://coordinator'+path,{method:value===undefined?'GET':'POST',headers:token?{Authorization:'Bearer '+token}:{},...(value===undefined?{}:{body:JSON.stringify(value)})}));
const session=async object=>(await call(object,'/v1/sessions',{})).json();
test('Durable Object restores credentials, completed generation and request replay across chunks',async()=>{
 const {object,storage,env}=setup();const c=await session(object),path='/v1/sessions/'+c.session_id;
 const create={request_id:'one',name:'create_explainer',arguments:{intent}};
 const first=await(await call(object,path+'/tools',create,c.session_token)).json();
 const request=await(await call(object,'/internal/jobs/request',{session_id:c.session_id,job_id:first.job_id})).json();assert.equal(request.request.intent.concept,intent.concept);
 const result={package:{scene_id:first.scene_id,scene_version:1,validation:{passed:true},files:{'index.html':'a'.repeat(2300000)}},metrics:{}};
 assert.equal((await call(object,'/internal/jobs/result',{session_id:c.session_id,job_id:first.job_id,result})).status,200);
 assert.ok((await storage.get('session:'+c.session_id)).chunks>128);
 const b=setup(storage,env).object;
 const restored=await call(b,path+'/jobs/'+first.job_id,undefined,c.session_token);assert.equal(restored.status,200);assert.equal((await restored.json()).package.files['index.html'].length,2300000);
 const replay=await(await call(b,path+'/tools',create,c.session_token)).json();assert.equal(replay.job_id,first.job_id);
 assert.equal((await storage.get('demo-usage')).counts.generation,1);
 const count=b.service.sessions.get(c.session_id).events.filter(e=>e.status==='ready').length;
 await call(b,'/internal/jobs/result',{session_id:c.session_id,job_id:first.job_id,result});assert.equal(b.service.sessions.get(c.session_id).events.filter(e=>e.status==='ready').length,count);
 const writes=storage.writes;await call(b,path+'/jobs/'+first.job_id,undefined,c.session_token);assert.equal(storage.writes,writes);
});
test('a change to one session rewrites only that session, not a large scene stored in another',async()=>{
 const {object,storage}=setup();const a=await session(object),pathA='/v1/sessions/'+a.session_id;
 const first=await(await call(object,pathA+'/tools',{request_id:'one',name:'create_explainer',arguments:{intent}},a.session_token)).json();
 const result={package:{scene_id:first.scene_id,scene_version:1,validation:{passed:true},files:{'index.html':'a'.repeat(2300000)}},metrics:{}};
 assert.equal((await call(object,'/internal/jobs/result',{session_id:a.session_id,job_id:first.job_id,result})).status,200);
 const b=await session(object);const writes=storage.writes;
 assert.equal((await call(object,'/v1/sessions/'+b.session_id+'/turns',{request_id:'q',text:'Why?'},b.session_token)).status,200);
 assert.ok(storage.writes-writes<=4,`a turn in another session wrote ${storage.writes-writes} rows`);
 const restored=setup(storage).object;
 assert.equal((await call(restored,pathA+'/jobs/'+first.job_id,undefined,a.session_token)).status,200);
 assert.equal((await call(restored,'/v1/sessions/'+b.session_id+'/turns',{request_id:'q',text:'Why?'},b.session_token)).status,200);
});
test('sessions saved in the single-blob format restore and migrate to per-session keys',async()=>{
 const {object,storage,env}=setup();const c=await session(object);
 const legacy=new Storage();
 const {encodeState}=await import('../cloudflare/state-codec.mjs');
 const blob=encodeState(object.service.snapshot());
 legacy.values.set('session-state-meta',{version:1,chunks:Math.ceil(blob.length/16384)});
 for(let i=0;i*16384<blob.length;i++)legacy.values.set('session-state-'+i,blob.slice(i*16384,(i+1)*16384));
 const migrated=setup(legacy,env).object;
 assert.equal((await call(migrated,'/v1/sessions/'+c.session_id+'/turns',{request_id:'q',text:'Hi'},c.session_token)).status,200);
 assert.equal(legacy.values.has('session-state-meta'),false);assert.equal(legacy.values.has('session-state-0'),false);
 assert.ok(legacy.values.has('session:'+c.session_id));
 assert.equal((await call(setup(legacy,env).object,'/v1/sessions/'+c.session_id+'/turns',{request_id:'q',text:'Hi'},c.session_token)).status,200);
});
test('interrupted planner cannot repeat its provider call or reservation after restart',async()=>{
 const {object,storage,env}=setup();let entered;
 const admitted=new Promise(r=>entered=r);object.service.planner={plan:async()=>{entered();return new Promise(()=>{});}};
 const c=await session(object),path='/v1/sessions/'+c.session_id+'/turns',turn={request_id:'one',text:'Question'};
 void call(object,path,turn,c.session_token);await admitted;
 const other=setup(storage,env).object;
 const r=await call(other,path,turn,c.session_token);assert.equal(r.status,409);assert.equal((await r.json()).error,'interrupted_request');assert.equal((await storage.get('demo-usage')).counts.planner,1);
 // Voice reservations do not wait for the long planner request.
 assert.equal((await call(object,'/internal/quota',{kind:'speech',amount:4})).status,200);
});
test('durable speech quota is shared and exact at the daily boundary',async()=>{
 const {object,storage,env}=setup(undefined,{DEMO_DAILY_SPEECH_CHARACTERS:'5'});
 assert.equal((await call(object,'/internal/quota',{kind:'speech',amount:5})).status,200);
 const b=setup(storage,env).object;assert.equal((await call(b,'/internal/quota',{kind:'speech',amount:1})).status,429);
});
test('private managed operations use only the persisted job session and do not hold the mutation queue',async()=>{
 const {object}=setup();const c=await session(object),path='/v1/sessions/'+c.session_id;
 const job=await(await call(object,path+'/tools',{request_id:'managed',name:'create_explainer',arguments:{intent}},c.session_token)).json();
 const input={session_id:c.session_id,job_id:job.job_id,remote_session_id:'sess_untrusted'};
 assert.equal((await call(object,'/internal/jobs/managed-poll',input)).status,409);
 await call(object,'/internal/jobs/remote',{...input,remote_session_id:'sess_saved'});
 let release,entered;const enteredPromise=new Promise(r=>entered=r);
 object.remoteAgent={poll:async id=>{assert.equal(id,'sess_saved');entered();return new Promise(r=>release=r);},cleanup:async id=>{assert.equal(id,'sess_saved');}};
 const pending=call(object,'/internal/jobs/managed-poll',input);await enteredPromise;
 assert.equal((await call(object,'/internal/jobs/status',input)).status,200);
 release({done:false,phase:'authoring'});assert.deepEqual(await(await pending).json(),{done:false,phase:'authoring'});
 assert.deepEqual(await(await call(object,'/internal/jobs/managed-cleanup',input)).json(),{cleaned:true});
 assert.equal((await call(object,'/internal/jobs/managed-cleanup',{...input,job_id:'missing'})).status,404);
});
