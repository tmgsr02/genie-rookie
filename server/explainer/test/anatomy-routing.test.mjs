import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner} from '../src/planner.mjs';
const intent={learning_goal:'Understand a rocket engine',concept:'Engine',interaction:'Explore the gas paths',representation:'other',model_kind:'simplified',assumptions:[],limitations:[]};
function planner(output){let request; return {p:new Planner({client:{responses:{create:async r=>{request=r;return {output,output_text:'',usage:{}};}}}}),get request(){return request;}};}
const call=(name,args)=>({type:'function_call',name,arguments:JSON.stringify(args)});
test('explicit anatomy forces generation and overwrites a planner representation downgrade',async()=>{
 const m=planner([call('create_explainer',{intent})]);
 const result=await m.p.plan({},'/Anatomy Explain the engine');
 assert.equal(result.tools[0].arguments.intent.representation,'isometric');
 assert.deepEqual(m.request.tool_choice,{type:'function',name:'create_explainer'});
 assert.equal(m.request.tools.length,1);
 assert.equal(JSON.parse(m.request.input).child_question,'Explain the engine');
});
test('anatomy revisions target the actual active scene',async()=>{
 const m=planner([call('revise_explainer',{intent,scene_id:'invented',scene_version:400})]);
 const result=await m.p.plan({active:{scene_id:'actual',scene_version:2}},'/anatomy explore the engine');
 assert.equal(result.tools[0].arguments.scene_id,'actual');assert.equal(result.tools[0].arguments.scene_version,2);
});
test('missing generation call and empty anatomy question fail rather than silently choosing fast path',async()=>{
 await assert.rejects(planner([]).p.plan({},'/anatomy Engine'),/anatomy_generation_required/);
 await assert.rejects(planner([]).p.plan({},'/anatomy'),/empty_anatomy_question/);
});
test('ordinary mentions of anatomy do not force a command',async()=>{
 const m=planner([]);await m.p.plan({},'What does anatomy mean?');assert.equal(m.request.tool_choice,undefined);
});
