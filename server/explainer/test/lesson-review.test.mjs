import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLesson,reviewScreenshotNames} from '../src/lesson-review.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const options={package:{manifest:{representation:'mathematical',model_kind:'simplified',assumptions:['Integers only']},files:{'index.html':'<p>2 × 2 = 4</p>','scene.js':'n => n * 2'},test_cases:[]},authoringReport:{model_sources:['unverified']},screenshots:Object.fromEntries(reviewScreenshotNames.map(name=>[name,png]))};
const visual=()=>({passed:true,findings:[],observations:['Labels legible; model visible in both screenshots.']});
const factual=()=>({passed:true,findings:[],claims:[{claim:'2 × 2 = 4',basis:'formal_derivation',evidence:'Multiplication: 2 + 2 = 4.',source_urls:[]}],limitations:['Model review can miss errors.']});
function fake(results=[visual(),factual()],output=[]){const calls=[];return {calls,client:{responses:{create:async body=>{calls.push(body);const result=results[calls.length-1];return {status:'completed',output_text:JSON.stringify(result),output,usage:{input_tokens:10,output_tokens:5}};}}}};}
test('review submits actual screenshot pixels at high detail and separate factual context',async()=>{
 const f=fake();const result=await reviewLesson(f.client,options);
 const images=f.calls[0].input[0].content.filter(p=>p.type==='input_image');
 assert.equal(images.length,4);assert.equal(images[0].image_url,'data:image/png;base64,'+png.toString('base64'));assert.equal(images[0].detail,'high');
 assert.equal(f.calls[0].text.format.strict,true);assert.equal(f.calls.length,2);
 assert.match(f.calls[1].instructions,/not.*proof/i);assert.match(f.calls[1].input,/scene.js/);
 assert.equal(result.visual_review.passed,true);assert.equal(result.factual_review.passed,true);
 assert.match(result.limitations.join(' '),/not.*guarantee/i);
});
test('failed visual review rejects and does not spend a factual call',async()=>{
 const f=fake([{...visual(),passed:false,findings:['Controls overlap the diagram.']}]);
 await assert.rejects(reviewLesson(f.client,options),/visual_review_failed/);assert.equal(f.calls.length,1);
});
test('missing screenshots fails closed before a model call',async()=>{
 const f=fake();await assert.rejects(reviewLesson(f.client,{...options,screenshots:{}}),/review_screenshot_missing/);assert.equal(f.calls.length,0);
});
test('malformed, refused, and incomplete reviews never pass',async()=>{
 for(const response of [{status:'incomplete',output_text:JSON.stringify(visual())},{status:'completed',output_text:'{}'},{status:'completed',output_text:'not json'}]){
  await assert.rejects(reviewLesson({responses:{create:async()=>response}},options),/review_response/);
 }
});
test('unsupported claims are rejected even when reviewer incorrectly sets passed true',async()=>{
 const result=factual();result.claims[0].basis='unsupported';const f=fake([visual(),result]);
 await assert.rejects(reviewLesson(f.client,options),/factual_review_failed/);
});
test('reviewer cannot fabricate supplied source citations or pass empty claim coverage',async()=>{
 for(const claims of [[],[{claim:'Claim',basis:'supplied_source',evidence:'Alleged evidence',source_urls:['https://invented.test']}]] ){
  const f=fake([visual(),{...factual(),claims}]);await assert.rejects(reviewLesson(f.client,options),/factual_review_failed|review_response_invalid/);
 }
});
test('primary source excerpts are delivered as evidence and avoid web search',async()=>{
 const claim={claim:'A source-backed fact',basis:'supplied_source',evidence:'Supported by the supplied excerpt.',source_urls:['https://science.nasa.gov/example']};
 const f=fake([visual(),{...factual(),claims:[claim]}]);
 await reviewLesson(f.client,{...options,sourceEvidence:[{url:claim.source_urls[0],title:'NASA reference',excerpt:'A source-backed fact.'}]});
 assert.deepEqual(f.calls[1].tools,[]);assert.match(f.calls[1].input,/A source-backed fact/);
});
test('web evidence requires a completed search and exact source URL from actual tool output',async()=>{
 const claim={claim:'Force changes momentum.',basis:'web_source',evidence:'NASA describes the momentum relation.',source_urls:['https://www.nasa.gov/force']};
 const response={...factual(),claims:[claim]};
 const success=fake([visual(),response],[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url:claim.source_urls[0]}]}}]);
 await reviewLesson(success.client,options);assert.equal(success.calls[1].tools[0].type,'web_search');assert.equal(success.calls[1].max_tool_calls,3);
 for(const output of [[],[{type:'web_search_call',status:'failed',action:{type:'search',sources:[{type:'url',url:claim.source_urls[0]}]}}]]){
  const f=fake([visual(),response],output);await assert.rejects(reviewLesson(f.client,options),/factual_review_failed/);
 }
});


test('hosted validation requires review even without an artifacts callback and cleans up on rejection',async()=>{
 const {HostedWorker}=await import('../src/hosted-worker-core.mjs');
 for(const approved of [true,false]){
  let deleted=false,requests=0,downloads=0;
  const f=fake([{...visual(),passed:approved},factual()]);
  const client={containers:{create:async()=>({id:'cntr_review'}),delete:async()=>{deleted=true;},files:{
   create:async(id,{file})=>({path:'/mnt/data/'+file.name}),
   list:async function*(){for(const name of reviewScreenshotNames)yield {id:name,path:'/mnt/data/gr/screenshots/'+name,bytes:png.length};},
   content:{retrieve:async()=>{downloads++;return {body:(async function*(){yield png;})()};}},
  }},responses:{create:async body=>{
   requests++;
   if(requests>1)return f.client.responses.create(body);
   const action=JSON.parse(body.input.split('\n').at(-1));
   return {status:'completed',usage:{input_tokens:1,output_tokens:1},output:[
    {type:'shell_call',status:'completed',call_id:'c',environment:{container_id:'cntr_review'},action},
    {type:'shell_call_output',status:'completed',call_id:'c',output:[{stdout:JSON.stringify({passed:true,checks:[{name:'browser',passed:true}]}),stderr:'',outcome:{type:'exit',exit_code:0}}]},
   ]};
  }}};
  const worker=new HostedWorker({client,assets:{tooling:Buffer.from('test')}});
  if(approved){const result=await worker.validate(options.package);assert.equal(result.validation.visual_review.passed,true);assert.equal(result.validation.factual_review.passed,true);}
  else await assert.rejects(worker.validate(options.package),/visual_review_failed/);
  assert.equal(downloads,4);assert.equal(deleted,true);
 }
});

test('factual context excludes bulky drawing coordinates but preserves labels, model code and source evidence',async()=>{
 const f=fake();
 const pkg={...options.package,files:{'index.html':'<style>body{color:red}</style><svg><path d="'+('M1 2 L3 4 '.repeat(150000))+'"/><text>Thrust is not a percentage of mass</text></svg><p>Illustrative throttle only</p>','scene.js':'const explanation="Fuel and oxidizer react";'}};
 await reviewLesson(f.client,{...options,package:pkg});
 assert.ok(f.calls[1].input.length<20000);assert.match(f.calls[1].input,/Thrust is not a percentage/);assert.match(f.calls[1].input,/Illustrative throttle/);assert.match(f.calls[1].input,/Fuel and oxidizer react/);
 assert.doesNotMatch(f.calls[1].input,/M1 2 L3/);
});


test('additional captured states are reviewed and hashed with bounded payloads',async()=>{
 const f=fake();
 const result=await reviewLesson(f.client,{...options,screenshots:{...options.screenshots,'exploded.png':png}});
 assert.equal(f.calls[0].input[0].content.filter(c=>c.type==='input_image').length,5);
 assert.ok(result.visual_review.screenshots.find(s=>s.name==='exploded.png'&&s.sha256.length===64));
 const many={...options.screenshots};for(let i=0;i<5;i++)many['extra-'+i+'.png']=png;
 await assert.rejects(reviewLesson(f.client,{...options,screenshots:many}),/review_screenshot_limit/);
});

test('provider URL citations require a completed web tool and literal source_urls',async()=>{
 const url='https://www.nasa.gov/verified';
 const result={...factual(),claims:[{claim:'A checked fact',basis:'web_source',evidence:'A source citation supports it.',source_urls:[url]}]};
 const citation={type:'message',content:[{type:'output_text',annotations:[{type:'url_citation',url}]}]};
 const completed={type:'web_search_call',status:'completed',action:{type:'search',sources:[]}};
 await reviewLesson(fake([visual(),result],[completed,citation]).client,options);
 await assert.rejects(reviewLesson(fake([visual(),result],[citation]).client,options),/factual_review_failed/);
 result.claims[0].source_urls=[];
 const empty=fake([visual(),result],[completed,citation]);
 await assert.rejects(reviewLesson(empty.client,options),/factual_review_failed/);
 assert.match(empty.calls[1].instructions,/MUST have at least one literal exact URL/);
});
