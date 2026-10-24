import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRaptor} from '../scenes/raptor-reference/build.mjs';
import {createRaptorModel} from '../scenes/raptor-reference/model.mjs';
import {Planner} from '../src/planner.mjs';
import {preparedRaptorIntent,isPreparedRaptor,requestsPreparedRaptor} from '../src/prepared-raptor.mjs';
const built=await buildRaptor();
test('prepared reference is explicit and never hijacks revisions or other questions',async()=>{
 assert.equal(requestsPreparedRaptor('/anatomy explain how a full-flow staged combustion rocket engine works, as a Raptor on a test stand, interactive'),true);
 assert.equal(requestsPreparedRaptor('/anatomy design another rocket experiment'),false);
 assert.equal(isPreparedRaptor({intent:preparedRaptorIntent,previous:{}}),false);
 const plan=await new Planner({preparedReferences:true,client:{responses:{create(){throw Error('unexpected inference');}}}}).plan({},'show the raptor reference');
 assert.match(plan.dialogue[0].text,/prepared/);assert.equal(isPreparedRaptor({intent:plan.tools[0].arguments.intent}),true);
});
test('Raptor state preserves core causal teaching and coherent view/engine transitions',()=>{
 const m=createRaptorModel(built.lessons,built.D.pieces);
 let s=m.reduce(m.initial_state,'set_stage',{stage:1});
 assert.match(s.explanation,/small methane crossfeed/);assert.match(s.explanation,/small oxygen crossfeed/);
 s=m.reduce(s,'select_assembly',{assembly:'orpb'});assert.equal(s.exploded,true);assert.equal(s.assembly_name,'Oxygen-rich preburner');
 s=m.reduce(s,'ignite',{});assert.equal(s.exploded,false);assert.equal(s.selected_assembly,'none');assert.equal(s.engine_status,'firing');
 s=m.reduce(s,'pause',{paused:true});assert.equal(s.paused,true);assert.equal(m.invariants(s),true);
 s=m.reduce(s,'shutdown',{});assert.equal(s.engine_status,'shutdown_requested');
 s=m.reduce(s,'finish_firing',{});assert.equal(s.engine_status,'cold');
 s=m.reduce(s,'reset',{});assert.deepEqual(s,m.initial_state);
 assert.equal(m.invariants({...s,explanation:'Fuel and oxygen never mix before the chamber.'}),false);
});
test('reference retains dense geometry and all required interactions without remote assets',()=>{
 const p=built.package;assert.ok(p.files['index.html'].length>1000000);
 for(const name of ['ignite','shutdown','set_exploded','select_assembly','set_stage','pause','reset'])assert.ok(p.manifest.controls.some(c=>c.name===name));
 assert.equal(built.D.order.length,11);assert.equal(built.lessons.length,6);
 assert.doesNotMatch(p.files['index.html'],/<iframe|https?:\/\//);
});

test('interaction narration receives selected assembly semantics and prioritizes observed state',async()=>{
 let body;
 const planner=new Planner({client:{responses:{create:async request=>{body=request;return {output:[],output_text:JSON.stringify({dialogue:[{speaker:'genius',text:'The oxygen-rich preburner drives its turbine.'}],context_summary:'Inspecting the preburner.'})};}}}});
 const m=createRaptorModel(built.lessons,built.D.pieces),state=m.reduce(m.initial_state,'select_assembly',{assembly:'orpb'});
 await planner.plan({active:built.package,acknowledged:{state_revision:1,state}},{kind:'interaction_completed',state},{event:true});
 assert.match(body.instructions,/Explain the current observed state FIRST/);
 assert.match(body.instructions,/name the selected assembly/);
 assert.equal(JSON.parse(body.input).acknowledged_event.state.assembly_name,'Oxygen-rich preburner');
 assert.deepEqual(body.tools,[]);
});
