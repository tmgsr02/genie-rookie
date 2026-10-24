// All semantic controls use the trusted reducer bridge. Animation remains local.
const model=createRaptorModel(LESSONS,Object.fromEntries(D.order.map(id=>[id,D.pieces[id]])));
let priorState=null;
let reducedShutdownTimer=null;
const snapshot=()=>ExplainerScene.snapshot().state;
const act=(name,input={})=>ExplainerScene.act(name,input);
const modelReadout=document.createElement('p');
modelReadout.id='raptor-model-status';modelReadout.setAttribute('aria-live','polite');
root.querySelector('.rp-lesson').append(modelReadout);
const resetButton=document.createElement('button');
resetButton.textContent='Reset lesson';resetButton.dataset.action='reset';
root.querySelector('.rp-stepnav').append(resetButton);
resetButton.addEventListener('click',()=>act('reset'));
fireButton.dataset.action='ignite';
fireButton.addEventListener('click',()=>act(snapshot().engine_status==='firing'?'shutdown':'ignite'));
explodeButton.dataset.action='set_exploded';
explodeButton.addEventListener('click',()=>act('set_exploded',{exploded:!snapshot().exploded}));
partButtons.forEach(button=>button.addEventListener('click',()=>act('select_assembly',{assembly:button.dataset.part})));
lessonButtons.forEach((button,index)=>button.addEventListener('click',()=>act('set_stage',{stage:index})));
root.querySelector('[data-next]').addEventListener('click',()=>act('set_stage',{stage:(snapshot().stage+1)%6}));
root.querySelector('[data-prev]').addEventListener('click',()=>act('set_stage',{stage:(snapshot().stage+5)%6}));
tourButton.addEventListener('click',()=>act('pause',{paused:!snapshot().paused}));
root.querySelector('[data-theme-toggle]').addEventListener('click',()=>act('set_theme',{theme:snapshot().theme==='light'?'dark':'light'}));
stage.addEventListener('click',event=>{
  const id=pieceAt(event);
  if(id && D.order.includes(id))act('select_assembly',{assembly:id});
  else act('set_exploded',{exploded:!snapshot().exploded});
});
stage.addEventListener('keydown',event=>{
  const s=snapshot(),i=D.order.indexOf(s.selected_assembly);
  let action=null;
  if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(event.key)){
    const n=event.key==='Home'?0:event.key==='End'?D.order.length-1:
      (i+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+D.order.length)%D.order.length;
    action=()=>act('select_assembly',{assembly:D.order[n]});
  } else if(event.key===' ')action=()=>act('set_exploded',{exploded:!s.exploded});
  else if(['i','I','Enter'].includes(event.key))action=()=>act(s.engine_status==='firing'?'shutdown':'ignite');
  else if(event.key==='Escape')action=()=>act('reset');
  if(action){event.preventDefault();action();}
});
function stopBurnImmediately(){
  // A view change has a deterministic cold pose, without a hidden firing state.
  burn.on=false;burn.armed=false;burn.t=-1;burn.pc=0;burn.pcRate=0;burn.stopping=-1;
  burn.mainAt=-100;burn.popAt=-100;burn.glowStop=null;
  for(const key of ['pre','vent','reach','splash','smoke','hue']){burn[key].x=0;burn[key].v=0;}
  fireState('');fireLabel.textContent='Ignite';stepBurn(0,true);
}
ExplainerScene.register({...model,completed:(_state,action)=>action?.source==='touch' && ['set_stage','select_assembly','set_exploded','ignite','shutdown','finish_firing'].includes(action.name),render(s,options){
  const changed=!priorState||s.engine_status!==priorState.engine_status;
  if(changed){
    if(s.engine_status==='firing'){stopBurnImmediately();ignite(false);}
    else if(s.engine_status==='shutdown_requested'){
      if(!options.reduced_motion)shutdown();
    }
    else stopBurnImmediately();
  }
  if(s.engine_status==='shutdown_requested' && options.reduced_motion){
    stopBurnImmediately();
    if(reducedShutdownTimer===null)reducedShutdownTimer=setTimeout(()=>{reducedShutdownTimer=null;if(snapshot().engine_status==='shutdown_requested')act('finish_firing');},500);
  } else if(s.engine_status!=='shutdown_requested' && reducedShutdownTimer!==null){clearTimeout(reducedShutdownTimer);reducedShutdownTimer=null;}
  lessonIndex=s.stage;
  const item=LESSONS[s.stage];
  titleEl.textContent=s.stage_title;textEl.textContent=s.explanation;factEl.textContent=s.fact;trailEl.textContent=s.flow_path;
  countEl.textContent=`${String(s.stage+1).padStart(2,'0')} / 06`;
  lessonButtons.forEach((button,index)=>button.setAttribute('aria-pressed',String(index===s.stage)));
  explicitApart=s.exploded;setApart(s.exploded);
  select(s.selected_assembly==='none'?null:s.selected_assembly);
  if(s.selected_assembly==='none')highlightLesson();
  partButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===s.selected_assembly)));
  explodeButton.textContent=s.exploded?'Assemble':'Explode view';explodeButton.setAttribute('aria-pressed',String(s.exploded));
  tourButton.textContent=s.paused?'Resume motion':'Pause motion';tourButton.setAttribute('aria-pressed',String(s.paused));
  surface.dataset.theme=s.theme;LIGHT=s.theme==='light'?1:0;
  root.querySelector('[data-theme-toggle]').textContent=s.theme==='light'?'Dark paper':'Light paper';
  modelReadout.textContent=s.status_text+' · '+s.assembly_name;
  priorState=s;lastKey='';run();
}});
