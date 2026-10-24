import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedWorker } from '../src/hosted-worker.mjs';
import { fixture, intent } from './fixtures.mjs';
const previousMode = process.env.HOSTED_AUTHOR_MODE;
test.before(() => { process.env.HOSTED_AUTHOR_MODE = 'direct'; });
test.after(() => { if (previousMode === undefined) delete process.env.HOSTED_AUTHOR_MODE; else process.env.HOSTED_AUTHOR_MODE = previousMode; });

function candidate() {
  const pkg = fixture();
  return {
    html: pkg.files['index.html'], javascript: pkg.files['scene.js'],
    manifest_json: JSON.stringify(pkg.manifest), test_cases_json: JSON.stringify(pkg.test_cases),
    authoring_report_json: JSON.stringify({concept: 'test', representation_rationale: '2D', model_sources: ['Unverified test model'], assumptions: [], parts: [], commands: [], limitations: ['Test only']}),
  };
}
function setup(outputs = [candidate()]) {
  const requests = [];
  const worker = new HostedWorker({ client: { responses: { async create(body) {
    requests.push(body);
    return {status: 'completed', output: [], output_text: JSON.stringify(outputs[Math.min(requests.length - 1, outputs.length - 1)]), usage: { input_tokens: 10, output_tokens: 20 }};
  } } } });
  const validated = [];
  worker.validate = async (pkg, sources) => {
    validated.push({pkg, sources});
    return {validation: {passed: true, checks: [{name: 'independent_test_gate', passed: true}]}, usage: {input_tokens: 2, output_tokens: 3}};
  };
  return {worker, requests, validated};
}
const job = {intent, scene_id: 'fast_test', scene_version: 1};
test('2D authoring uses a single direct response then the independent gate and truthful provenance', async () => {
  const {worker, requests, validated} = setup();
  const result = await worker.author(job);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tools.length, 0);
  assert.equal(requests[0].text.format.strict, true);
  assert.equal(validated.length, 1);
  assert.deepEqual(validated[0].sources, {});
  assert.equal(result.package.provenance, 'authored');
  assert.equal(result.package.validation.passed, true);
  assert.equal(result.metrics.worker, 'openai_direct_hosted_validation');
  assert.equal(result.metrics.skill, null);
  assert.equal(result.metrics.usage.output_tokens, 23);
});
test('fast authoring cannot deliver isometric output through the 2D gate', async () => {
  const bad = candidate();
  bad.manifest_json = JSON.stringify({...JSON.parse(bad.manifest_json), representation: 'isometric'});
  const {worker, requests, validated} = setup([bad]);
  await assert.rejects(worker.author(job), /fast_representation_mismatch/);
  assert.equal(requests.length, 2);
  assert.equal(validated.length, 0);
});
test('failed independent validation gets one bounded repair and is never returned as success', async () => {
  const {worker, requests} = setup();
  let validations = 0;
  worker.validate = async () => { validations++; throw Object.assign(Error('hosted_validation_failed'), {detail: 'readout_mismatch:change'}); };
  await assert.rejects(worker.author(job), /hosted_validation_failed/);
  assert.equal(validations, 2);
  assert.equal(requests.length, 2);
  assert.match(requests[1].input, /readout_mismatch:change/);
});
test('cancellation cannot trigger a direct request or a repair', async () => {
  const {worker, requests} = setup();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(worker.author({...job, signal: controller.signal}));
  assert.equal(requests.length, 0);
});

test('hosted prompt preserves Anatomy detail and delegates actual screenshot review without invented claims', async () => {
  const {authorInstruction} = await import('../src/author-prompt.mjs');
  const text = authorInstruction('/mnt/data/gr/app', {hosted: true});
  assert.match(text, /no image-viewing tool/i);
  assert.doesNotMatch(text, /smallest useful|at most two targeted repair|avoid optional geometry|small number of semantic controls/i);
  assert.match(text, /40.80/);
  assert.match(text, /raptor-engine/);
  assert.match(text, /server.*vision/i);
  assert.match(text, /never claim visual inspection/i);
});

test('reserved pause schema repair identifies extra description and requires both copies to match', async () => {
  const bad = candidate();
  const manifest = JSON.parse(bad.manifest_json);
  manifest.controls.find(c => c.name === 'pause').input_schema.properties.paused.description = 'Paused';
  bad.manifest_json = JSON.stringify(manifest);
  const {worker,requests,validated} = setup([bad,candidate()]);
  await worker.author(job);
  assert.equal(validated.length,1);
  assert.match(requests[1].input, /Remove all description/);
  assert.match(requests[1].input, /scene.js/);
});

test('test-case repair supplies the actual executable control names', async () => {
  const bad = candidate();
  const cases = JSON.parse(bad.test_cases_json);
  cases[0].name = 'change_to_four';
  bad.test_cases_json = JSON.stringify(cases);
  const {worker,requests} = setup([bad,candidate()]);
  await worker.author(job);
  const repair = JSON.parse(requests[1].input).repair;
  assert.match(repair.guidance, /exact executable control name/);
  assert.deepEqual(repair.control_names, ['change','reset','pause']);
});

test('string-bound repair identifies every bad field, including enums and nested arrays', async () => {
  const bad = candidate();
  const manifest = JSON.parse(bad.manifest_json);
  manifest.state_schema.properties.result = {type: 'string', enum: ['one', 'two']};
  manifest.state_schema.properties.explanation = {type: 'array', maxItems: 2, items: {type: 'string', maxLength: 4000}};
  manifest.controls[0].input_schema.properties.word = {type: 'string'};
  bad.manifest_json = JSON.stringify(manifest);
  const {worker,requests,validated} = setup([bad,candidate()]);
  await worker.author(job);
  const repair = JSON.parse(requests[1].input).repair;
  assert.match(repair.guidance || '', /enum/);
  assert.match(repair.guidance, /scene.js/);
  assert.deepEqual(repair.string_schema_issues.map(issue => issue.path).sort(), [
    'controls[0].input_schema.properties.word',
    'state_schema.properties.explanation.items',
    'state_schema.properties.result',
  ]);
  assert.equal(validated.length, 1);
  assert.equal(requests.length, 2);
});
