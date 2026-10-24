// One real authoring job and its independent hosted browser validation. No fixtures.
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {HostedWorker} from '../src/hosted-worker.mjs';
process.env.HOSTED_AUTHOR_MODE = 'direct';
const dir = new URL('../artifacts/generation-speed/', import.meta.url);
await mkdir(dir, {recursive: true});
const started = Date.now();
const intent = {
  learning_goal: 'Understand that one half can be represented as two quarters and that changing the number of equal slices changes the fraction name without changing the amount shown.',
  concept: 'Equivalent fractions: one half and two quarters',
  interaction: 'Choose two or four equal slices of the same whole strip and compare the shaded half. Show the fraction name changing while the shaded amount stays constant.',
  representation: 'mathematical', model_kind: 'factual',
  assumptions: ['Same whole length.', 'Equal partitions.', 'Shaded amount stays one half.'],
  limitations: ['Focus on 1/2 = 2/4; this is not a general fractions curriculum.'],
};
const safe = (data) => JSON.stringify(data, (key, value) => key === 'encrypted_content' ? undefined : value, 2);
await writeFile(new URL('intent.json',dir), safe(intent));
let validationAttempt = 0;
const worker = new HostedWorker({
  onExecution: async result => {
    const suffix = result.attempt || ++validationAttempt;
    await writeFile(new URL(`${result.phase}-${suffix}-execution.json`,dir), safe(result));
    console.log(JSON.stringify({phase: result.phase, attempt: suffix, elapsed_ms: Date.now()-started, usage: result.response.usage}));
  },
  onAuthored: result => writeFile(new URL('authoring.json',dir),safe(result)),
  onArtifacts: async files => { for (const [name,data] of Object.entries(files)) await writeFile(new URL(name,dir),data); },
});
try {
  const result = await worker.author({intent,scene_id:'speed_fractions',scene_version:1,signal:AbortSignal.timeout(300000)});
  await writeFile(new URL('package.json',dir),safe(result.package));
  const baseline = JSON.parse(await readFile(new URL('../artifacts/hosted-fractions/live-result.json',import.meta.url),'utf8'));
  const report = {status:'ready',...result.metrics,total_wall_ms:Date.now()-started,validation:result.package.validation,
    baseline_generation_ms:baseline.metrics.generation_ms,
    comparison:'Same learning goal, newly authored scene; one sample, no latency distribution or general quality equivalence claimed.',
    speedup:baseline.metrics.generation_ms/result.metrics.generation_ms};
  await writeFile(new URL('result.json',dir),safe(report));
  console.log(safe(report));
} catch(error) {
  const result = {status:'failed',elapsed_ms:Date.now()-started,error:error.message,detail:error.detail};
  await writeFile(new URL('result.json',dir),safe(result));
  console.error(safe(result)); process.exitCode=1;
}
