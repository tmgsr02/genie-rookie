import {runContainer} from '../src/worker.mjs';
// Real sandbox checks; no provider key or model call is used.
const result = await runContainer('preflight-child.mjs', {}, {
  network:true, credential:false, innerSandbox:true, timeout:30000,
});
console.log(JSON.stringify(result, null, 2));
