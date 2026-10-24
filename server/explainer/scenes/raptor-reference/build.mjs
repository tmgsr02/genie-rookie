import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createRaptorModel} from './model.mjs';
import {normalizePackage} from '../../src/package.mjs';
const root=new URL('./',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
export async function buildRaptor(){
  let markup=await read('reference-markup.html');
  // The app displays source titles; the reviewed URLs live in its report.
  markup=markup.replace(/ xmlns="http:\/\/www.w3.org\/2000\/svg"/g,'');
  markup=markup.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g,'<span>$1</span>');
  let live=await read('reference-live.js');
  const D=JSON.parse(live.match(/const D = (.*);/)[1]);
  const lessonSource=live.slice(live.indexOf('const LESSONS = '),live.indexOf('let lessonIndex'));
  const lessons=vm.runInNewContext(lessonSource+'LESSONS');
  // Keep original geometry/shaders/motion. Replace only the interaction wiring.
  live=live.slice(0,live.indexOf('stage.addEventListener("pointermove"'))+
    live.slice(live.indexOf('const LESSONS = '),live.indexOf('function stopLesson()'));
  live=live.replace('state.pending && clock >= state.pending.at','state.pending && (calm || clock >= state.pending.at)')
    .replace('let lessonPlaying = !still.matches;','let lessonPlaying = false;')
    .replace('  lessonTick(dt);','')
    .replace('const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;',
      'if (document.hidden || ExplainerScene.snapshot().state.paused || (!still.matches && ExplainerScene.isPaused())) { frame=0;last=0;return; }\n  const dt = still.matches ? 0 : (last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60);')
    .replace('frame = visible && (moving || burning || touring || (lessonPlaying && !still.matches))',
      'frame = visible && !ExplainerScene.isPaused() && (moving || burning)')
    .replace('    announce("cold");','    announce("cold");\n    queueMicrotask(()=>{if(ExplainerScene.snapshot().state.engine_status!=="cold")ExplainerScene.act("finish_firing",{});});');
  // Remove obsolete automatic tour calls in showLesson (used for highlighting only).
  live=live.replace('if (manual) { stopLesson(); quietTour(); }','');
  const model=createRaptorModel(lessons,Object.fromEntries(D.order.map(id=>[id,D.pieces[id]])));
  const js='(()=>{\nconst surface=document.getElementById("ffsc-surface");\n'+live+'\n'+
    (await read('model.mjs')).replace(/^export /gm,'')+'\n'+await read('bridge.js')+'\n})();';
  const css=await read('reference.css');
  const html='<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raptor — full-flow staged combustion</title><style>'+css+
    '\nhtml,body{margin:0;padding:0!important}#ffsc-surface{padding:12px;box-sizing:border-box}button{min-height:44px}#raptor-model-status{font-size:12px;line-height:1.5}#ffsc-surface .rp-head>div{display:none}#ffsc-surface .rp-head{justify-content:flex-end;margin-bottom:8px} .iso[data-theme=dark] .rp-stage[data-focus] .it:not([data-on]){--anatomy-hi:#9d9da5;--anatomy-mid:#777780;--anatomy-lo:#606069} .iso[data-theme=dark] .rp-stage[data-focus] .it[data-piece=stand]{--anatomy-mid:#777780}.rp-head h1{font-size:26px}@media(max-width:480px){.rp-head p{font-size:13px}.rp-stepnav{flex-wrap:wrap}}</style></head><body><div id="ffsc-surface" class="iso" data-theme="light">'+markup+'</div><script src="runtime.js"></script><script src="scene.js"></script></body></html>';
  const actions=[['set_stage',{stage:1}],['select_assembly',{assembly:D.order[2]}],['set_exploded',{exploded:false}],['ignite',{}],['pause',{paused:true}],['pause',{paused:false}],['shutdown',{}],['finish_firing',{}],['set_theme',{theme:'dark'}],['reset',{}]];
  let state=model.initial_state;
  const test_cases=actions.map(([name,input])=>{state=model.reduce(state,name,input);return {name,input,expected_state:state,selector:'#raptor-model-status',readout:state.status_text};});
  const raw={entry:'index.html',files:{'index.html':html,'scene.js':js},manifest:{
    title:'Raptor · full-flow staged combustion',learning_goal:'Explore the two propellant-rich turbine circuits, crossfeeds, cooling and main chamber in a detailed Raptor-style teaching reference.',
    representation:'isometric',model_kind:'simplified',
    assumptions:['Educational Raptor 2-style arrangement adapted from the supplied Anatomy reference.','Stages describe flow relationships; both turbine circuits operate together.'],
    limitations:['Geometry and routing are schematic, not a SpaceX engineering drawing.','Firing timing and normalized pressure are illustrative, not test telemetry.','Prepared reference scene; not newly generated for this request.'],
    controls:model.controls,state_schema:model.state_schema},test_cases};
  return {raw,package:normalizePackage(raw,{scene_id:'raptor_reference',scene_version:1}),lessons,D};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {raw}=await buildRaptor();const dir=new URL('../../.work/raptor-reference/',root);await mkdir(dir,{recursive:true});await writeFile(new URL('package.json',dir),JSON.stringify(raw));console.log('Built detailed Raptor package.');
}
