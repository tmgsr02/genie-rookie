import test from 'node:test';import assert from 'node:assert/strict';
import {runManagedGeneration,coordinatedWorker} from '../cloudflare/managed-generation.mjs';
const step={do:async(_name,...args)=>args.at(-1)(),sleep:async()=>{}};
function harness(initial='generating'){
 const events=[];let state=initial,polls=0;
 const call=async(path,extra)=>{events.push(path);if(path==='status')return {status:state};if(path==='request')return {request:{intent:{representation:'isometric'},previous:{files:{large:'x'.repeat(1200000)}}}};if(path==='result'){state='ready';return {status:state};}return {status:state};};
 const managedWorker={begin:async()=>({submitted:true}),start:async()=>{events.push('start');return {session_id:'sess_x',started_at:Date.now()};},poll:async()=>({done:++polls===2,phase:'authoring',turn_id:'turn'}),collect:async()=>{events.push('collect');return {};},validate:async()=>{events.push('validate');return {package:{}};},cleanup:async()=>{events.push('cleanup');}};
 return {events,call,managedWorker,set state(s){state=s;}};
}
test('cancelled queued jobs never create a remote session',async()=>{
 const h=harness('cancelled');assert.deepEqual(await runManagedGeneration({env:{},step,job_id:'job',...h}),{status:'cancelled'});assert.ok(!h.events.includes('start'));
});
test('large revision inputs never become step results; validate before delivery then cleanup',async()=>{
 const h=harness();const checkpoints=[];const traced={...step,do:async(name,...args)=>{const value=await args.at(-1)();assert.ok(JSON.stringify(value??null).length<1000);checkpoints.push(name);return value;}};
 assert.deepEqual(await runManagedGeneration({env:{},step:traced,job_id:'job',...h}),{status:'ready'});
 assert.ok(h.events.indexOf('validate')<h.events.indexOf('result'));assert.equal(h.events.at(-1),'cleanup');
 assert.equal(checkpoints.filter(s=>s==='start-managed-session').length,1);
});
test('cancellation during remote work skips artifact publication and cleans up',async()=>{
 const h=harness();h.managedWorker.poll=async()=>{h.state='cancelled';return {done:false,phase:'authoring'};};
 assert.deepEqual(await runManagedGeneration({env:{},step,job_id:'job',...h}),{status:'cancelled'});assert.ok(!h.events.includes('collect'));assert.equal(h.events.at(-1),'cleanup');
});
test('cancel between persisted session and input prevents paid generation and deletes session',async()=>{
 const h=harness();let begins=0;h.managedWorker.begin=async()=>{begins++;};
 const call=async(path,...args)=>{const result=await h.call(path,...args);if(path==='remote')h.state='cancelled';return result;};
 assert.deepEqual(await runManagedGeneration({env:{},step,job_id:'job',...h,call}),{status:'cancelled'});
 assert.equal(begins,0);assert.equal(h.events.at(-1),'cleanup');
});
test('long generations keep recurring provider calls out of the Workflow request budget',async()=>{
 const h=harness();let localPolls=0,localCleanup=0,remotePolls=0;
 h.managedWorker.poll=async()=>{localPolls++;throw Error('Workflow external request limit');};
 h.managedWorker.cleanup=async()=>{localCleanup++;};
 const call=async(path,...args)=>path==='managed-poll'
   ? {done:++remotePolls===100,phase:'authoring',turn_id:'turn'}
   : path==='managed-cleanup'?{cleaned:true}:h.call(path,...args);
 const worker=coordinatedWorker(h.managedWorker,call);
 assert.deepEqual(await runManagedGeneration({env:{},step,job_id:'job',...h,call,managedWorker:worker}),{status:'ready'});
 assert.equal(remotePolls,100);assert.equal(localPolls,0);assert.equal(localCleanup,0);
});
test('cleanup retains the checkpointed remote ID if the coordinator session expired or save failed',async()=>{
 let cleaned;
 const worker=coordinatedWorker({cleanup:async id=>{cleaned=id;}},async()=>{throw Error('job_not_found');});
 await worker.cleanup('sess_checkpointed');assert.equal(cleaned,'sess_checkpointed');
});
