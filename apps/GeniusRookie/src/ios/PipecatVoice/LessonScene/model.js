/* One source of truth: an ideal symmetric balance, not an angular dynamics simulation. */
(function(root){
'use strict';
const LIMIT=4, initial={left_count:3,left_distance:1,right_count:1,right_distance:1,paused:false};
const outcome=s=>s.left_count*s.left_distance===s.right_count*s.right_distance?'balanced':s.left_count*s.left_distance>s.right_count*s.right_distance?'left_down':'right_down';
class BalanceModel {
 constructor(session){if(typeof session!=='string'||!session)throw Error('session');this.session=session;this.state={...initial,scene_version:0};this.applied=new Map();}
 result(action_id,status='applied',error){let s=this.state;return {action_id,status,error,scene_version:s.scene_version,values:{left_count:s.left_count,left_distance:s.left_distance,right_count:s.right_count,right_distance:s.right_distance,paused:s.paused},outcome:outcome(s),left_score:s.left_count*s.left_distance,right_score:s.right_count*s.right_distance};}
 apply(a){
  const reject=error=>this.result(a?.action_id,'rejected',error);
  if(!a||a.session!==this.session)return reject('session');
  if(typeof a.action_id!=='string'||!a.action_id||a.action_id.length>100)return reject('action_id');
  const fields={move_weight:['entity_id','value'],set_weight:['entity_id','value'],reset_experiment:['setup'],pause_scene:['paused'],highlight_part:['entity_id']}[a.type];
  if(!fields)return reject('action');
  if(Object.keys(a).some(k=>!['session','action_id','expected_scene_version','type',...fields].includes(k)))return reject('shape');
  const fingerprint=JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]));
  if(this.applied.has(a.action_id)){const prior=this.applied.get(a.action_id);return prior.fingerprint===fingerprint?prior.result:reject('action_id_conflict');}
  if(this.applied.size>=4096)return reject('session_limit');
  if(a.expected_scene_version!==this.state.scene_version)return reject('stale_version');
  let next={...this.state};
  switch(a.type){
   case 'move_weight':case 'set_weight': {
    if(!['left_carrier','right_carrier'].includes(a.entity_id))return reject('entity');
    const key=(a.entity_id==='left_carrier'?'left':'right')+(a.type==='move_weight'?'_distance':'_count');
    if(!Number.isInteger(a.value)||a.value<1||a.value>LIMIT)return reject('range');next[key]=a.value;break;
   }
   case 'reset_experiment':
    if(a.setup!==undefined&&!['initial','transfer'].includes(a.setup))return reject('setup');
    next={...next,...initial,...(a.setup==='transfer'?{left_count:2,left_distance:2,right_distance:3}:{})};break;
   case 'pause_scene':if(typeof a.paused!=='boolean')return reject('paused');next.paused=a.paused;break;
   case 'highlight_part':if(!['left_carrier','right_carrier','beam','pivot'].includes(a.entity_id))return reject('entity');next.highlight=a.entity_id;break;
   default:return reject('action');
  }
  next.scene_version++;this.state=next;let result=this.result(a.action_id);this.applied.set(a.action_id,{fingerprint,result});return result;
 }
}
// Public action-schema adapter. Single-scene lesson uses scene version as world version.
function fromEnvelope(e,currentSession,currentTurn){
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(o,k));
 if(!exact(e,['session_id','turn_id','action_id','expected_world_version','command'])||e.session_id!==currentSession||e.turn_id!==currentTurn||typeof e.action_id!=='string'||!e.action_id||!Number.isInteger(e.expected_world_version)||e.expected_world_version<0)throw Error('envelope');
 if(!exact(e.command,['action','args']))throw Error('command');
 const {action,args}=e.command;const fields={move_weight:['entity_id','distance'],set_weight:['entity_id','block_count'],reset_experiment:['preset'],highlight_part:['entity_id'],pause_scene:['paused']}[action];
 if(!fields||!exact(args,['scene_id','expected_scene_version',...fields])||args.scene_id!=='balance_bench'||args.expected_scene_version!==e.expected_world_version)throw Error('args');
 const a={session:e.session_id,action_id:e.action_id,expected_scene_version:args.expected_scene_version,type:action};
 if(args.entity_id!==undefined)a.entity_id=args.entity_id;
 if(action==='move_weight')a.value=args.distance;
 if(action==='set_weight')a.value=args.block_count;
 if(action==='reset_experiment')a.setup=args.preset;
 if(action==='pause_scene')a.paused=args.paused;
 return a;
}
root.Balance={BalanceModel,outcome,initial,fromEnvelope};if(typeof module!=='undefined')module.exports=root.Balance;
})(typeof window==='undefined'?globalThis:window);
