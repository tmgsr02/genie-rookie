import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentsWorker, managedRequest} from '../src/agents-worker.mjs';
const assets={skill:{skill_id:'skill_test',version:'1',sha256:'digest'},tooling:{file_id:'file_test'}};
const request={intent:{representation:'isometric'},previous:null,scene_id:'scene',scene_version:1};
test('managed session pins Anatomy, disables network and contains no provider credential',()=>{
 const r=managedRequest(request,assets,{OPENAI_API_KEY:'sk-test-DO-NOT-EXPOSE-123'},'job');
 assert.equal(r.environment.type,'openai_hosted');
 assert.deepEqual(r.environment.skills,[{type:'skill_reference',skill_id:'skill_test',version:'1'}]);
 assert.equal(r.environment.network.access,'disabled');
 assert.equal(r.stream,false); assert.ok(!JSON.stringify(r).includes('sk-test-DO-NOT-EXPOSE-123'));
});
function worker(session,turns,artifacts=[]){return new AgentsWorker({assets,client:{beta:{agents:{sessions:{retrieve:async()=>session,turns:{list:async()=>({data:turns})},artifacts:{list:async()=>({data:artifacts,has_more:false})}}}}}});}
test('idle session without a completed root turn is still preparing',async()=>{
 assert.equal((await worker({status:'idle',environment:{status:'pending'}},[]).poll('s')).phase,'preparing');
});
test('subagent completion never completes the root job',async()=>{
 assert.equal((await worker({status:'in_progress',environment:{status:'connected'}},[{id:'t',status:'completed',subagent_id:'sub'}]).poll('s')).done,false);
});
test('failed root turn rejects and completed root turn identifies output turn',async()=>{
 await assert.rejects(worker({status:'idle',environment:{}},[{id:'t',status:'failed',subagent_id:null}]).poll('s'),/agents_turn_failed/);
 assert.deepEqual(await worker({status:'idle',environment:{}},[{id:'t',status:'completed',subagent_id:null}]).poll('s'),{done:true,turn_id:'t',phase:'checking'});
});
test('artifact collection rejects wrong turn and oversized output',async()=>{
 const w=worker({},[],[{id:'a',path:'/workspace/outputs/gr-result.json',turn_id:'old',session_id:'s',size_bytes:10}]);
 await assert.rejects(w.collect('s','t'),/agents_artifact_missing/);
 const w2=worker({},[],[{id:'a',path:'/workspace/outputs/gr-result.json',turn_id:'t',session_id:'s',size_bytes:7000000}]);
 await assert.rejects(w2.collect('s','t'),/agents_artifact_limit/);
});
test('session creation recovers job metadata and never submits paid input',async()=>{
 let created,starts=0;
 const sessions={list:async()=>({data:[],has_more:false}),create:async body=>{starts++;created=body;return {id:'sess_new',created_at:10};}};
 const w=new AgentsWorker({assets,client:{beta:{agents:{sessions}}}});
 assert.deepEqual(await w.start(request,'job'),{session_id:'sess_new',started_at:10000});assert.equal(created.input,undefined);
 sessions.list=async()=>({data:[{id:'sess_recovered',created_at:10,metadata:{application:'genie-rookie',job_id:'job'}}]});
 assert.equal((await w.start(request,'job')).session_id,'sess_recovered');assert.equal(starts,1);
});
test('input submission has a stable message idempotency key; cleanup deletes even if cancel fails',async()=>{
 const requests=[];let deleted=0;
 const sessions={events:{create:async(...args)=>requests.push(args)},delete:async()=>{deleted++;}};
 const w=new AgentsWorker({assets,client:{beta:{agents:{sessions}}}});
 await w.begin('s','job',request);await w.begin('s','job',request);
 assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0][2].headers['Idempotency-Key'],'genie-rookie-input-job');
 sessions.events.create=async()=>{throw Object.assign(Error('unavailable'),{status:500});};await w.cleanup('s');assert.equal(deleted,1);
});
test('root turn can be found beyond a page of subagent turns',async()=>{
 let calls=0;
 const sessions={retrieve:async()=>({status:'idle'}),turns:{list:async()=>++calls===1?{data:[{id:'sub',subagent_id:'sub',status:'completed'}],has_more:true}:{data:[{id:'root',subagent_id:null,status:'completed'}],has_more:false}}};
 const w=new AgentsWorker({assets,client:{beta:{agents:{sessions}}}});
 assert.equal((await w.poll('s')).turn_id,'root');assert.equal(calls,2);
});
test('lost creation response is recovered from metadata before retry can create again',async()=>{
 let remote=null,creates=0;
 const sessions={list:async()=>({data:remote?[remote]:[],has_more:false}),create:async body=>{assert.equal(body.input,undefined);creates++;remote={id:'sess_recovered',created_at:10,metadata:body.metadata};throw Error('lost_response');}};
 const w=new AgentsWorker({assets,client:{beta:{agents:{sessions}}}});
 await assert.rejects(w.start(request,'job'),/lost_response/);
 assert.equal((await w.start(request,'job')).session_id,'sess_recovered');assert.equal(creates,1);
});
test('running turn is still preparing until its hosted environment is connected',async()=>{
 const sessions={retrieve:async()=>({status:'in_progress',environment:{id:'env'}}),turns:{list:async()=>({data:[{subagent_id:null,status:'in_progress'}]})}};
 let status='pending';const w=new AgentsWorker({assets,client:{beta:{agents:{sessions,environments:{retrieve:async()=>({status})}}}}});
 assert.equal((await w.poll('s')).phase,'preparing');status='connected';assert.equal((await w.poll('s')).phase,'authoring');status='failed';await assert.rejects(w.poll('s'),/agents_environment_failed/);
});
