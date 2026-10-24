const assert=require('node:assert/strict');const {BalanceModel}=require('../src/ios/PipecatVoice/LessonScene/model.js');
const lesson=require('../src/ios/PipecatVoice/LessonScene/lesson.json');let checks=0;
for(const fixture of lesson.worked_states){const m=new BalanceModel('s');for(const side of ['left','right'])for(const field of ['count','distance']){const r=m.apply({session:'s',action_id:side+field,expected_scene_version:m.state.scene_version,type:field==='count'?'set_weight':'move_weight',entity_id:side+'_carrier',value:fixture[`${side}_${field}`]});assert.equal(r.status,'applied');}const r=m.result('check');assert.equal(r.outcome,fixture.expected_outcome);assert.equal(r.left_score,fixture.expected_left_score);assert.equal(r.right_score,fixture.expected_right_score);checks++;}
const m=new BalanceModel('s');const action={session:'s',action_id:'first',expected_scene_version:0,type:'move_weight',entity_id:'right_carrier',value:3};const first=m.apply(action);assert.equal(first.outcome,'balanced');assert.deepEqual(m.apply(action),first);assert.equal(m.state.scene_version,1);assert.equal(m.apply({...action,action_id:'stale'}).error,'stale_version');assert.equal(m.apply({...action,session:'old'}).error,'session');
for(const value of [0,5,1.2,NaN,Infinity,'3',true])assert.equal(m.apply({...action,action_id:`invalid-${value}`,expected_scene_version:1,value}).error,'range');
assert.equal(m.apply({...action,action_id:'invalid-entity',expected_scene_version:1,entity_id:'script'}).error,'entity');
assert.equal(m.apply({...action,action_id:'invalid-type',expected_scene_version:1,type:'eval'}).error,'action');
const reset=m.apply({session:'s',action_id:'transfer',expected_scene_version:1,type:'reset_experiment',setup:'transfer'});assert.equal(reset.left_score,4);assert.equal(reset.right_score,3);assert.equal(reset.outcome,'left_down');
// Exhaustive state-space verifies model output and range invariants at every legal state.
for(let lc=1;lc<=4;lc++)for(let ld=1;ld<=4;ld++)for(let rc=1;rc<=4;rc++)for(let rd=1;rd<=4;rd++){const n=new BalanceModel('s');n.state={left_count:lc,left_distance:ld,right_count:rc,right_distance:rd,scene_version:0};const r=n.result('x');assert.equal(r.outcome,lc*ld===rc*rd?'balanced':lc*ld>rc*rd?'left_down':'right_down');checks++;}
console.log(`PASS ${checks} worked/exhaustive states; session, stale version, idempotency, bounds and action allowlist.`);

assert.equal(m.apply({...action,value:4}).error,'action_id_conflict');
assert.equal(m.apply({...action,action_id:'extra',expected_scene_version:2,script:'bad'}).error,'shape');
const {fromEnvelope}=require('../src/ios/PipecatVoice/LessonScene/model.js');
const e={session_id:'s',turn_id:'turn',action_id:'public',expected_world_version:2,command:{action:'move_weight',args:{scene_id:'balance_bench',expected_scene_version:2,entity_id:'right_carrier',distance:4}}};
assert.equal(m.apply(fromEnvelope(e,'s','turn')).outcome,'balanced');
assert.throws(()=>fromEnvelope(e,'s','old'));assert.throws(()=>fromEnvelope({...e,extra:true},'s','turn'));
console.log('PASS conflicting action ids, unknown properties and public schema translation.');
