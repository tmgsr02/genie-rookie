import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildRaptor} from '../scenes/raptor-reference/build.mjs';
import {validateBrowser} from '../src/browser-check.mjs';
import {CSP} from '../src/package.mjs';
import {LINE_ENDS} from '../vendor/anatomy/scripts/line-ends.mjs';
// Run these regressions alone without replacing screenshots used by review:
// node scripts/verify-raptor-reference.mjs --dynamic-motion-only
const dynamicMotionOnly=process.argv.includes('--dynamic-motion-only');
async function verifyDynamicMotion(page){
 const act=(name,input={})=>page.evaluate(([name,input])=>ExplainerScene.act(name,input),[name,input]);
 const pose=()=>page.locator('.rp-engine .it').evaluateAll(nodes=>nodes.map(node=>[
  node.dataset.i,node.dataset.piece,node.getAttribute('transform'),
 ]).sort((a,b)=>Number(a[0])-Number(b[0])));
 // Establish the fully exploded still pose from the actual drawing, then
 // compare a preference change while staggered assembly motion is pending.
 await page.emulateMedia({reducedMotion:'reduce'});
 await act('reset');await act('set_exploded',{exploded:true});
 await page.waitForTimeout(100);
 const expectedPose=await pose();
 assert.ok(expectedPose.some(node=>node[2]),'exploded reference must move geometry');
 await act('reset');await page.waitForTimeout(100);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await act('set_exploded',{exploded:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForTimeout(100);
 assert.deepEqual(await pose(),expectedPose,'enabling reduced motion must settle every pending assembly');
 // Enabling reduced motion during an already requested shutdown must still
 // acknowledge completion, even though the animated clock no longer advances.
 await act('reset');await page.emulateMedia({reducedMotion:'no-preference'});
 await act('ignite');await page.waitForTimeout(1500);await act('shutdown');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>ExplainerScene.snapshot().state.engine_status==='cold',{},{timeout:2000});
 // A later preference reversal must not cancel the outstanding completion.
 await act('ignite');await page.waitForTimeout(100);await act('shutdown');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.waitForFunction(()=>ExplainerScene.snapshot().state.engine_status==='cold',{},{timeout:2000});
 await act('reset');
}
const artifactDir=fileURLToPath(new URL('../.work/raptor-reference/',import.meta.url));
if(!dynamicMotionOnly)await mkdir(artifactDir,{recursive:true});
const {package:pkg}=await buildRaptor();
const checks=dynamicMotionOnly?null:await validateBrowser(pkg,{artifactDir});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
 const errors=[];
 await context.route('**/*',route=>{
  const url=new URL(route.request().url()),name=url.pathname.slice(1)||'index.html';
  if(url.origin!=='http://127.0.0.1'||!pkg.files[name]){errors.push('unexpected_network');return route.abort();}
  return route.fulfill({body:pkg.files[name],contentType:name.endsWith('.js')?'application/javascript':'text/html',headers:{'Content-Security-Policy':CSP}});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1');
 await page.evaluate(()=>{window.__events=[];window.addEventListener('explainer-event',e=>window.__events.push(e.detail));window.explainerBootstrap({session_id:'verify',scene_id:'raptor_reference',scene_version:1});});
 if(dynamicMotionOnly){
  await verifyDynamicMotion(page);assert.deepEqual(errors,[]);
 } else {
 const state=()=>page.evaluate(()=>ExplainerScene.snapshot().state);
 const shot=name=>page.screenshot({path:artifactDir+'/'+name,fullPage:true});
 await shot('reference-assembled.png');
 await page.locator('[data-explode]').click();await page.waitForTimeout(1800);
 assert.equal((await state()).exploded,true);await shot('reference-exploded.png');
 const apartLines=await page.evaluate(`(${LINE_ENDS})({})`);assert.equal(apartLines.problems.length,0);
 await page.locator('summary').filter({hasText:'Inspect 11'}).click();
 await page.locator('[data-part="orpb"]').click();
 assert.equal((await state()).selected_assembly,'orpb');assert.match((await state()).assembly_description,/oxygen|rich/i);
 await page.locator('[data-lesson="1"]').click();
 assert.equal((await state()).stage,1);assert.match((await state()).explanation,/crossfeed/);
 await page.locator('[data-explode]').click();await page.waitForTimeout(1800);
 await page.locator('[data-fire]').click();await page.waitForTimeout(2600);
 assert.equal((await state()).engine_status,'firing');await shot('reference-ignited.png');
 await page.locator('[data-tour]').click();assert.equal((await state()).paused,true);
 await page.waitForTimeout(200);
 const before=await page.locator('.rp-stage').screenshot();await page.waitForTimeout(450);
 const after=await page.locator('.rp-stage').screenshot();assert.equal(before.equals(after),true,'paused scene must visually hold');
 await page.locator('[data-tour]').click();await page.locator('[data-fire]').click();
 assert.equal((await state()).engine_status,'shutdown_requested');
 await page.waitForFunction(()=>ExplainerScene.snapshot().state.engine_status==='cold',{},{timeout:8000});
 await page.locator('[data-theme-toggle]').click();await page.locator('[data-explode]').click();await page.waitForTimeout(1800);await shot('reference-dark.png');
 await page.locator('[data-action="reset"]').click();assert.equal((await state()).paused,false);
 // Pause during arming must hold the original pose instead of jumping to full fire.
 await page.locator('[data-explode]').click();await page.waitForTimeout(1200);
 await page.locator('[data-fire]').click();await page.locator('[data-tour]').click();
 await page.waitForTimeout(150);
 const heldReadout=await page.locator('[data-readout]').innerText();
 const heldPose=await page.locator('.rp-stage').screenshot();await page.waitForTimeout(450);
 assert.equal((await page.locator('.rp-stage').screenshot()).equals(heldPose),true);
 assert.equal(await page.locator('[data-readout]').innerText(),heldReadout);
 await page.locator('[data-tour]').click();
 await page.locator('[data-fire]').click();await page.locator('[data-fire]').click();
 assert.equal((await state()).engine_status,'firing');
 await page.waitForTimeout(500);assert.doesNotMatch(await page.locator('[data-readout]').innerText(),/shutdown/);
 await page.locator('[data-action="reset"]').click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('[data-fire]').click();await page.locator('[data-fire]').click();
 await page.waitForFunction(()=>ExplainerScene.snapshot().state.engine_status==='cold',{},{timeout:2000});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await verifyDynamicMotion(page);
 const completed=await page.evaluate(()=>window.__events.filter(e=>e.kind==='interaction_completed'));
 assert.ok(completed.some(e=>e.state.selected_assembly==='orpb'),'assembly tap must request grounded narration');
 assert.ok(completed.some(e=>e.state.stage===1),'stage tap must request grounded narration');
 const acknowledged=await page.evaluate(()=>window.__events.filter(e=>e.kind==='action_applied').map(e=>({revision:e.state_revision,state:e.state})));
 assert.ok(acknowledged.length>=10);assert.deepEqual(errors,[]);
 checks.checks.push({name:'raptor_real_controls_explode_assembly_stages_ignite_pause_shutdown_reset',passed:true},{name:'raptor_exploded_lines',passed:true},{name:'raptor_paused_pixels_stable',passed:true});
 checks.checks.push({name:'raptor_dynamic_reduced_motion_transitions',passed:true});
 await writeFile(artifactDir+'/interaction-evidence.json',JSON.stringify({acknowledged,webgl:await page.locator('.rp-plume').evaluate(e=>!!e.getContext('webgl'))},null,2));
 }
} finally {await browser.close();}
if(!dynamicMotionOnly){
checks.normalized_package_sha256=createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
checks.screenshot_hashes={};
for(const name of ['phone-initial.png','phone.png','phone-reduced.png','phone-detail.png','reference-exploded.png','reference-ignited.png','reference-dark.png'])checks.screenshot_hashes[name]=createHash('sha256').update(await readFile(artifactDir+'/'+name)).digest('hex');
await writeFile(artifactDir+'/checks.json',JSON.stringify(checks,null,2));
}
console.log(dynamicMotionOnly?'Raptor dynamic reduced-motion assembly and shutdown regressions passed.':'Raptor browser, reduced motion, real controls, acknowledged state, pause pixels, and exploded line checks passed.');
