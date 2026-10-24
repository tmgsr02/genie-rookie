import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner} from '../src/planner.mjs';
import {ExplainerService} from '../src/service.mjs';
import {intent} from './fixtures.mjs';

function plannerStub() {
  let request;
  const planner = new Planner({client:{responses:{create:async value => {
    request = value;
    return {output:[], output_text:JSON.stringify({dialogue:[
      {speaker:'rookie',text:'I wonder what makes a raindrop fall?'},
      {speaker:'genius',text:'Let’s think it through together.'}
    ],context_summary:'Exploring rain.'})};
  }}}});
  return {planner, get request(){ return request; }};
}
async function setup() {
  const stub = plannerStub();
  const charges = [];
  const service = new ExplainerService({planner:stub.planner,dispatch:async()=>{},usage:{charge:kind=>charges.push(kind)}});
  const c = service.create(), s = service.session(c.session_id,c.session_token);
  const job = await service.tool(s,{request_id:'create',name:'create_explainer',arguments:{intent}});
  return {service,s,job,charges,stub};
}
const request = (job, id='banter', phase='waiting') => ({request_id:id,job_id:job.job_id,phase,heard:[]});

test('automatic banter uses topic and heard history without authoring tools', async()=>{
  const stub = plannerStub();
  const heard=[{speaker:'child',text:'Maybe clouds are like sponges?'}];
  await stub.planner.plan({pendingJob:{job_id:'j',status:'generating',intent}},'',{generation:'waiting',heard});
  assert.deepEqual(stub.request.tools,[]);
  const input=JSON.parse(stub.request.input);
  assert.deepEqual(input.context.pending_job.intent,intent);
  assert.deepEqual(input.heard_history,heard);
  assert.equal(input.generation_conversation,'waiting');
});

test('a user joining pending conversation cannot accidentally restart authoring',async()=>{
  const stub=plannerStub();
  await stub.planner.plan({pendingJob:{job_id:'j',status:'generating',intent}},'Maybe gravity?');
  assert.deepEqual(stub.request.tools.map(t=>t.name).sort(),['cancel_generation','get_generation_status']);
});

test('automatic exchanges are idempotent, paced, bounded and survive reload',async()=>{
  const {service,s,job,charges}=await setup();
  const first=await service.generationDialogue(s,request(job));
  assert.equal(first.dialogue.length,2);
  assert.deepEqual(await service.generationDialogue(s,request(job)),first);
  assert.equal(charges.filter(c=>c==='planner').length,1);
  assert.deepEqual((await service.generationDialogue(s,request(job,'too-soon'))).dialogue,[]);
  for(let i=1;i<8;i++) {
    s.pendingJob.conversationAt=Date.now()-13000;
    assert.equal((await service.generationDialogue(s,request(job,'round'+i))).dialogue.length,2);
  }
  s.pendingJob.conversationAt=0;
  assert.deepEqual((await service.generationDialogue(s,request(job,'capped'))).dialogue,[]);
  const restored=new ExplainerService({planner:service.planner});
  restored.restore(service.snapshot());
  const restoredSession=restored.sessions.get(s.session_id);
  assert.deepEqual((await restored.generationDialogue(restoredSession,request(job,'after-restart'))).dialogue,[]);
});

test('failed job gets one spoken recovery and ready/cancelled/replaced jobs stay silent',async()=>{
  const {service,s,job}=await setup();
  s.pendingJob.status='failed';
  assert.equal((await service.generationDialogue(s,request(job,'failed','failed'))).dialogue.length,2);
  assert.deepEqual((await service.generationDialogue(s,request(job,'again','failed'))).dialogue,[]);
  for(const status of ['ready','cancelled']) {
    s.pendingJob.status=status;
    assert.deepEqual((await service.generationDialogue(s,request(job,status))).dialogue,[]);
  }
  s.pendingJob=null;
  assert.deepEqual((await service.generationDialogue(s,request(job,'replaced'))).dialogue,[]);
});

test('late provider response cannot speak over a newer user turn or finished job',async()=>{
  for(const change of [s=>s.conversationTurn=(s.conversationTurn||0)+1,s=>s.pendingJob.status='ready']) {
    const {service,s,job}=await setup();
    let finish, started;
    const invoked=new Promise(r=>started=r);
    service.planner={plan:()=>{started();return new Promise(r=>finish=r);}};
    const pending=service.generationDialogue(s,request(job));
    await invoked;
    change(s);
    finish({dialogue:[{speaker:'rookie',text:'Old thought'}],tools:[]});
    assert.deepEqual((await pending).dialogue,[]);
  }
});

test('provider failure yields a warm recovery without a false follow-up promise',async()=>{
  const {service,s,job}=await setup();
  s.pendingJob.status='failed';
  service.planner={plan:async()=>{throw Error('provider unavailable');}};
  const result=await service.generationDialogue(s,request(job,'failed','failed'));
  assert.equal(result.dialogue.length,2);
  assert.match(result.dialogue.map(d=>d.text).join(' '),/talk|words/i);
  assert.doesNotMatch(result.dialogue.map(d=>d.text).join(' '),/get back to you/i);
});
