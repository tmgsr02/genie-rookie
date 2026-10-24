'use strict';
const $=id=>document.getElementById(id);const native=!!window.webkit?.messageHandlers?.lesson;
let model,phase='wonder',lastPhase='',ready=false,angle=0,target=0,lastTime=0,frame=0,visible=true;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
$('drawing').innerHTML=BENCH.svg;
if(native)document.querySelectorAll('.authoring').forEach(e=>e.remove());
const uuid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
function post(event){if(native)window.webkit.messageHandlers.lesson.postMessage(event);}
function event(kind,more={}){if(!model)return;post({kind,lesson_session:model.session,event_id:uuid(),...more});}
function carrier(side){const s=model.state,P=BENCH.P,x=(side==='left'?-1:1)*s[side+'_distance']*30;
 let markup='';const box=(dx,y,w,d,z,h,tone='mid')=>solidSvg(slabOf({x:x+dx,y,w,d,r:1.2},z,h,P,4,.5),{tone});
 markup+=box(-13,-13,26,26,88,3,'hi');
 // Four tray lips and one handle; weight blocks sit flush on the carrier plate.
 for(const y of [-13,10])markup+=box(-13,y,26,3,91,3,'mid');
 for(const dx of [-13,10])markup+=box(dx,-10,3,20,91,3,'mid');
 markup+=box(-4,13,8,5,88,4,'mid');
 for(let n=0;n<s[side+'_count'];n++)markup+=box(-9,-9,18,18,91+n*8,8,'hi');
 $(side+'_carrier').innerHTML=markup;
}
function draw(resetTrial=true){const s=model.state,r=model.result('readout');carrier('left');carrier('right');
 for(const id of ['left_carrier','right_carrier','beam','pivot'])$(id).classList.toggle('highlight',s.highlight===id);
 const text={balanced:'Balanced · level',left_down:'Left side turns down',right_down:'Right side turns down'}[r.outcome];
 $('readout').textContent=text;
 $('facts').textContent=`Left: ${s.left_count} block${s.left_count===1?'':'s'}, notch ${s.left_distance}. Right: ${s.right_count} block${s.right_count===1?'':'s'}, notch ${s.right_distance}. ${text}.`;
 $('bench-desc').textContent=$('facts').textContent;
 $('distance').value=s.right_distance;$('notch').textContent=s.right_distance;
 $('leftdistance').value=s.left_distance;$('leftcount').value=s.left_count;$('rightcount').value=s.right_count;
 $('inward').disabled=s.right_distance===1;$('outward').disabled=s.right_distance===4;
 // Every trial starts from horizontal; this is only an illustrative eased tilt.
 if(resetTrial)angle=0;target=r.outcome==='balanced'?0:r.outcome==='left_down'?-7:7;
 $('tilt').setAttribute('transform',`rotate(${angle} ${BENCH.pivot.join(' ')})`);animate();
}
function animate(){cancelAnimationFrame(frame);lastTime=0;if(reduced.matches||model.state.paused||!visible){$('tilt').setAttribute('transform',`rotate(${reduced.matches&&!model.state.paused?target:angle} ${BENCH.pivot.join(' ')})`);return;}
 const tick=t=>{let dt=lastTime?Math.min(.05,(t-lastTime)/1000):0;lastTime=t;angle+=(target-angle)*(1-Math.exp(-dt*6));$('tilt').setAttribute('transform',`rotate(${angle} ${BENCH.pivot.join(' ')})`);if(Math.abs(target-angle)>.02)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
}
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(model)animate();}).observe($('drawing'));
reduced.addEventListener('change',()=>model&&animate());
function act(type,payload={}){if(!ready)return;if(native&&['move_weight','set_weight','reset_experiment'].includes(type)&&!['experiment','transfer'].includes(phase))return;const a={session:model.session,action_id:uuid(),expected_scene_version:model.state.scene_version,type,...payload};const r=model.apply(a);if(r.status==='applied'){draw(!['pause_scene','highlight_part'].includes(type));event('scene_result',{result:r});}return r;}
window.applySceneCommand=a=>{if(!model)return;const result=model.apply(a);if(result.status==='applied')draw(!['pause_scene','highlight_part'].includes(a.type));event('scene_result',{result});return result;};
window.lessonBootstrap=session=>{model=new Balance.BalanceModel(session);ready=true;phase='wonder';lastPhase='';draw();event('scene_result',{result:model.result('initial')});};
function button(label,kind,choice,primary=false){const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';b.onclick=()=>event(kind,choice?{choice}:{});$('choices').append(b);}
window.lessonUpdate=s=>{
 if(!model||s.lesson_session!==model.session)return;
 phase=s.phase;$('phase').textContent=phase.toUpperCase();$('prompt').textContent=s.prompt;$('choices').replaceChildren();
 $('controls').disabled=!['experiment','transfer'].includes(phase);
 $('reset').disabled=!['experiment','transfer'].includes(phase);
 // Guided challenges keep the comparison fixed; extra sliders are for authoring preview.
 for(const id of ['leftdistance','leftcount','rightcount'])$(id).disabled=native;
 if(phase==='wonder')button('Make a prediction','continue',null,true);
 if(phase==='predict'){button('It could balance','prediction','balance');button('It will still tip left','prediction','left');button('I’m not sure','prediction','unsure');}
 if(phase==='observe')button('I notice it is level','continue',null,true);
 if(phase==='explain'){
  button('Weight AND distance matter','explanation','distance_and_weight',true);
  button('Only the weight matters','explanation','weight');button('Show me a hint','explanation','hint');button('I’ll show Rookie on the new challenge','explanation','demonstrate');
  const text=document.createElement('textarea');text.placeholder='Or write your idea (not saved)';text.setAttribute('aria-label','Your explanation');$('choices').append(text);
  const send=document.createElement('button');send.textContent='Share my idea';send.onclick=()=>{event('explanation',{choice:'typed',text:text.value.slice(0,500)});text.value='';};$('choices').append(send);
 }
 if(phase==='finish'){
  const note=document.createElement('p');note.textContent='To try again, ask a grown-up to open Settings and choose Restart balance lesson.';$('choices').append(note);
 }
 const changed=lastPhase!==phase;lastPhase=phase;
 if(phase==='transfer'&&changed)act('reset_experiment',{setup:'transfer'});
};
$('distance').oninput=e=>act('move_weight',{entity_id:'right_carrier',value:Number(e.target.value)});
$('inward').onclick=()=>act('move_weight',{entity_id:'right_carrier',value:model.state.right_distance-1});
$('outward').onclick=()=>act('move_weight',{entity_id:'right_carrier',value:model.state.right_distance+1});
for(const [id,entity,type] of [['leftdistance','left_carrier','move_weight'],['leftcount','left_carrier','set_weight'],['rightcount','right_carrier','set_weight']])$(id).oninput=e=>act(type,{entity_id:entity,value:Number(e.target.value)});
$('reset').onclick=()=>act('reset_experiment',{setup:phase==='transfer'?'transfer':'initial'});
$('pause').onclick=()=>{act('pause_scene',{paused:!model.state.paused});$('pause').setAttribute('aria-pressed',model.state.paused);$('pause').textContent=model.state.paused?'Resume motion':'Pause motion';};
if(native)post({kind:'ready'});else{window.lessonBootstrap('authoring-preview');$('connection').textContent='Authoring preview: apparatus controls are live. Native app uses the embedded Python lesson reducer.';$('phase').textContent='EXPLORE';$('prompt').textContent='Move the right carrier from notch one to notch three. Can one block balance three?';}
