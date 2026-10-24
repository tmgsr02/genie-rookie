import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/hosted-worker-core.mjs';

function output(stdout='',stderr='',exit=0) {
  return {status:'completed',output:[{type:'shell_call',status:'completed'},{type:'shell_call_output',status:'completed',output:[{stdout,stderr,outcome:{type:'exit',exit_code:exit}}]}]};
}
test('safe validation diagnostics retain check codes but never generated text or identifiers',()=>{
  const result=core.validationDiagnostics(output('', 'readout_mismatch:CHILD_NAME_SECRET',1));
  assert.equal(result.failure_code,'readout_mismatch');
  assert.equal(result.exit_code,1);
  assert.ok(!JSON.stringify(result).includes('CHILD_NAME_SECRET'));
  assert.equal(core.validationDiagnostics(output('', 'private arbitrary script failure',1)).failure_code,'validator_execution_failed');
  assert.equal(core.validationDiagnostics(output('{"passed":true,"checks":[{"name":"phone_reduced_motion","passed":true}]}')).check_codes[0],'phone_reduced_motion');
});
test('rejected structured validation preserves bounded check detail and usage for repair',async()=>{
  const client={containers:{create:async()=>({id:'cntr_test'}),delete:async()=>{},files:{create:async(id,{file})=>({path:'/mnt/data/'+file.name})}},responses:{create:async body=>{
    const action=JSON.parse(body.input.split('\n').at(-1));
    const response=output(JSON.stringify({passed:false,checks:[{name:'phone_reduced_motion',passed:false},{name:'PRIVATE_VALUE',passed:false}]}));
    response.output[0]={...response.output[0],call_id:'call',environment:{container_id:'cntr_test'},action};
    response.output[1].call_id='call';response.usage={input_tokens:7,output_tokens:3};return response;
  }}};
  const worker=new core.HostedWorker({client,assets:{tooling:new Uint8Array([1])}});
  await assert.rejects(worker.validateOnce({}),error=>{
    assert.equal(error.message,'hosted_validation_failed');
    assert.match(error.detail,/phone_reduced_motion/);
    assert.ok(!error.detail.includes('PRIVATE_VALUE'));
    assert.equal(error.usage.output_tokens,3);
    return true;
  });
});
