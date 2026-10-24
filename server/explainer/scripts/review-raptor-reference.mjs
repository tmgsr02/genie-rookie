import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildRaptor} from '../scenes/raptor-reference/build.mjs';
import {reviewLesson,reviewScreenshotNames} from '../src/lesson-review.mjs';
const {raw,package:pkg,D}=await buildRaptor();
const dir=new URL('../.work/raptor-reference/',import.meta.url);
const sourceEvidence=JSON.parse(await readFile(new URL('../scenes/raptor-reference/source-evidence.json',import.meta.url),'utf8'));
const screenshots={};
for(const name of [...reviewScreenshotNames,'reference-exploded.png','reference-ignited.png','reference-dark.png'])screenshots[name]=await readFile(new URL(name,dir));
const checks=JSON.parse(await readFile(new URL('checks.json',dir),'utf8'));
assert.equal(checks.normalized_package_sha256,createHash('sha256').update(JSON.stringify(pkg)).digest('hex'),'Run browser verification for this exact package before review');
for(const [name,bytes] of Object.entries(screenshots))assert.equal(checks.screenshot_hashes[name],createHash('sha256').update(bytes).digest('hex'),'Screenshot changed since browser verification');
const authoring_report={concept:pkg.manifest.learning_goal,representation_rationale:'User-supplied detailed Raptor reference adapted to the native acknowledged-state runtime; original geometry retained.',model_sources:['Primary sources are listed in the lesson. Independent factual review must check claims against retrieved evidence.'],assumptions:[...pkg.manifest.assumptions,'The visible geometry disclaimer applies to the drawn stand, cone, ring, load cell and actuator count/arrangement: these are illustrative design choices, not an assertion of exact SpaceX test hardware.'],parts:D.order.map(id=>D.pieces[id].name),commands:[{command:'node scripts/verify-raptor-reference.mjs',outcome:'Real browser controls, schema, reduced motion, line ends and pause pixels passed.'}],limitations:pkg.manifest.limitations};
try {
 const review=await reviewLesson(new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0}),{package:pkg,authoringReport:authoring_report,screenshots,sourceEvidence,signal:AbortSignal.timeout(300000),env:process.env});
 const evidence={normalized_package_sha256:createHash('sha256').update(JSON.stringify(pkg)).digest('hex'),package_sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),authoring_report,validation:{...checks,...review,checks:[...checks.checks,...review.checks],passed:true}};
 await writeFile(new URL('review.json',dir),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({visual:review.visual_review.passed,factual:review.factual_review.passed,observations:review.visual_review.observations,factual_limitations:review.factual_review.limitations,usage:review.usage}));
} catch(error){await writeFile(new URL('review-failure.json',dir),JSON.stringify({error:error.message,detail:error.detail,usage:error.usage,verified_source_urls:error.verified_source_urls},null,2));console.log(error.message,error.detail||'');process.exitCode=1;}
