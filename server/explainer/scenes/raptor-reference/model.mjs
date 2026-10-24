// Semantic state is shared by touch, voice commands and tutor narration.
// Spring/shader frames are presentation; they never invent engine telemetry.
export function createRaptorModel(lessons, parts) {
  const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
  const string = (maxLength=2000) => ({type:'string',maxLength});
  const ids = Object.keys(parts);
  const controls = [
    ['ignite','Run the illustrative firing demonstration',{}],
    ['shutdown','Shut down the firing demonstration',{}],
    ['finish_firing','Acknowledge that the firing animation has finished',{}],
    ['set_exploded','Assemble or separate the engine',{exploded:{type:'boolean'}}],
    ['select_assembly','Inspect a named engine assembly',{assembly:{...string(40),enum:ids}}],
    ['set_stage','Show a stage of the combustion cycle',{stage:{type:'integer',minimum:0,maximum:5}}],
    ['set_theme','Change drawing paper',{theme:{...string(10),enum:['light','dark']}}],
    ['pause','Pause or resume motion',{paused:{type:'boolean'}}],
    ['reset','Reset the lesson',{}],
  ].map(([name,label,properties])=>({name,label,input_schema:object(properties)}));
  const state_schema=object({paused:{type:'boolean'},exploded:{type:'boolean'},
    engine_status:{...string(30),enum:['cold','firing','shutdown_requested']},
    selected_assembly:{...string(40),enum:['none',...ids]},assembly_name:string(200),assembly_description:string(),
    stage:{type:'integer',minimum:0,maximum:5},stage_title:string(200),explanation:string(),fact:string(),flow_path:string(),
    theme:{...string(10),enum:['light','dark']},status_text:string(),model_notice:string(),
  });
  const derive=s=>({...s,assembly_description:s.selected_assembly==='none'?'Explore the assembled engine and the six cycle stages.':parts[s.selected_assembly].say,assembly_name:s.selected_assembly==='none'?'Whole engine':parts[s.selected_assembly].name,
    stage_title:lessons[s.stage].title,explanation:lessons[s.stage].text,fact:lessons[s.stage].fact,flow_path:lessons[s.stage].trail,
    status_text:[s.engine_status==='firing'?'Firing demonstration':s.engine_status==='shutdown_requested'?'Shutdown requested':'Cold engine',s.exploded?'Exploded':'Assembled',lessons[s.stage].short,s.paused?'Paused':'Motion enabled'].join(' · '),
    model_notice:'Prepared Raptor-style teaching reference. Geometry and firing timing are schematic; pressure is normalized animation, not real telemetry. Stages describe simultaneous flow relationships, not startup order.'});
  const initial_state=derive({paused:false,exploded:false,engine_status:'cold',selected_assembly:'none',stage:0,theme:'light'});
  const reduce=(state,name,input)=>{
    let s={...state};
    switch(name){
      case 'ignite':s.engine_status='firing';s.exploded=false;s.selected_assembly='none';break;
      case 'shutdown':if(s.engine_status==='firing')s.engine_status='shutdown_requested';break;
      case 'finish_firing':s.engine_status='cold';break;
      case 'set_exploded':s.exploded=input.exploded;s.engine_status='cold';s.selected_assembly='none';break;
      case 'select_assembly':s.selected_assembly=input.assembly;s.exploded=true;s.engine_status='cold';break;
      case 'set_stage':s.stage=input.stage;s.selected_assembly='none';break;
      case 'set_theme':s.theme=input.theme;break;
      case 'pause':s.paused=input.paused;break;
      case 'reset':return {...initial_state};
      default:throw Error('unknown_raptor_control');
    }
    return derive(s);
  };
  const invariants=s=>typeof s.paused==='boolean' && s.stage>=0 && s.stage<lessons.length &&
    !(s.engine_status!=='cold' && s.exploded) &&
    (s.selected_assembly==='none'||(ids.includes(s.selected_assembly)&&s.exploded)) &&
    s.explanation===lessons[s.stage].text && s.fact===lessons[s.stage].fact &&
    s.assembly_name===(s.selected_assembly==='none'?'Whole engine':parts[s.selected_assembly]?.name) &&
    s.status_text===derive(s).status_text;
  return {controls,state_schema,initial_state,reduce,invariants};
}
