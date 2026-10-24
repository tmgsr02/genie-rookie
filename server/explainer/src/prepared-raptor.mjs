// Explicit reference reuse, never a substitute for arbitrary Anatomy requests.
export const preparedRaptorIntent={
 learning_goal:'Explore the supplied detailed Raptor reference: full-flow staged combustion, crossfeeds, turbines, cooling, and thrust.',
 concept:'Prepared reference: Raptor full-flow staged combustion',
 interaction:'Inspect eleven assemblies, explode and reassemble the engine, ignite and shut down the illustrative firing, and explore six guided stages.',
 representation:'isometric',model_kind:'simplified',
 assumptions:['Use the supplied reviewed Raptor reference; preserve its detailed geometry and controls.'],
 limitations:['Prepared reference, not newly generated. Geometry and timing are schematic, not real engine telemetry.'],
};
export function requestsPreparedRaptor(text){
 const q=text.trim().toLowerCase().replace(/^\/anatomy\s+/,'').replace(/[?.!,]/g,'').replace(/\s+/g,' ');
 return ['show the raptor reference','show raptor reference',
  'explain how a full-flow staged combustion rocket engine works as a raptor on a test stand interactive'].includes(q);
}
export function isPreparedRaptor(request){
 return !request.previous && request.intent && Object.keys(request.intent).length===Object.keys(preparedRaptorIntent).length && Object.entries(preparedRaptorIntent).every(([key,value])=>JSON.stringify(request.intent[key])===JSON.stringify(value));
}
