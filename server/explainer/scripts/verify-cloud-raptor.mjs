import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {CSP} from '../src/package.mjs';
const base='https://genie-rookie-demo.genie-rookie.workers.dev';
const dir=new URL('../.work/raptor-reference/',import.meta.url);
await mkdir(dir,{recursive:true});
async function call(path,body,token){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
 const result=await r.json();assert.ok(r.ok,`${path}: ${r.status} ${result.error||''}`);return result;
}
const s=await call('/v1/sessions',{});
assert.equal(s.generation_engine,'openai_agents_v6','Wait for current coordinator deployment before testing');
const path='/v1/sessions/'+s.session_id;
const started=Date.now();
const turn=await call(path+'/turns',{request_id:'raptor_live',text:'/anatomy explain how a full-flow staged combustion rocket engine works, as a Raptor on a test stand, interactive'},s.session_token);
assert.ok(turn.job_id);let job;
for(let i=0;i<45;i++){job=await call(path+'/jobs/'+turn.job_id,null,s.session_token);if(['ready','failed','cancelled'].includes(job.status))break;await delay(2000);}
assert.equal(job.status,'ready');assert.equal(job.package.provenance,'configured');
const ready_ms=Date.now()-started,pkg=job.package;
await writeFile(new URL('cloud-package.json',dir),JSON.stringify(pkg));
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const report={ready_ms,provenance:pkg.provenance,validation:{visual:pkg.validation.visual_review.passed,factual:pkg.validation.factual_review.passed},dialogue:[],actions:[]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',route=>{const u=new URL(route.request().url()),name=u.pathname.slice(1)||'index.html';return u.origin==='http://127.0.0.1'&&pkg.files[name]?route.fulfill({body:pkg.files[name],contentType:name.endsWith('.js')?'application/javascript':'text/html',headers:{'Content-Security-Policy':CSP}}):route.abort();});
 const page=await context.newPage();let pending=Promise.resolve(),eventError;
 await page.exposeFunction('forwardEvent',event=>{pending=pending.then(()=>call(path+'/scene-events',event,s.session_token)).catch(e=>{eventError=e;});});
 await page.addInitScript(()=>window.addEventListener('explainer-event',e=>window.forwardEvent(e.detail)));
 await page.goto('http://127.0.0.1');
 await page.evaluate(identity=>window.explainerBootstrap(identity),{session_id:s.session_id,scene_id:pkg.scene_id,scene_version:pkg.scene_version});
 let cursor=0;
 async function narration(revision){
  await delay(100);await pending;if(eventError)throw eventError;
  for(let n=0;n<8;n++){
   const result=await call(path+'/events?after='+cursor,null,s.session_token);cursor=result.cursor;
   const match=result.events.find(e=>e.type==='dialogue'&&e.basis?.state_revision===revision);
   if(match){assert.ok(match.dialogue.length);report.dialogue.push({revision,dialogue:match.dialogue});return;}
  }throw Error('No grounded narration for revision '+revision);
 }
 await narration(0);
 await page.locator('[data-lesson="1"]').click();
 let state=await page.evaluate(()=>ExplainerScene.snapshot());await narration(state.state_revision);
 report.actions.push({name:'set_stage',state:state.state});
 await page.locator('summary').filter({hasText:'Inspect 11'}).click();await page.locator('[data-part="orpb"]').click();
 state=await page.evaluate(()=>ExplainerScene.snapshot());await narration(state.state_revision);
 report.actions.push({name:'select_assembly',state:state.state});
 await page.screenshot({path:fileURLToPath(new URL('cloud-interaction.png',dir)),fullPage:true});
 assert.equal(eventError,undefined);
 await writeFile(new URL('cloud-checks.json',dir),JSON.stringify({...report,passed:false},null,2));
 assert.match(report.dialogue.find(d=>d.revision===1).dialogue[0].text,/preburn|crossfeed|Burn a little/i,'Genie must explain the current preburner stage');
 assert.match(report.dialogue.find(d=>d.revision===2).dialogue[0].text,/oxygen.rich|oxidizer.rich/i,'Genie must identify the selected assembly');
 report.passed=true;
 await writeFile(new URL('cloud-checks.json',dir),JSON.stringify(report,null,2));
 console.log(JSON.stringify({ready_ms,provenance:report.provenance,validated:report.validation,narrated_revisions:report.dialogue.map(e=>e.revision)}));
}finally{await browser.close();}
