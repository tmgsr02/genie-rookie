import {AgentsWorker} from '../src/agents-worker.mjs';
import {createHostedWorker,hostedAssetManifest} from './hosted-assets.mjs';
import tooling from './agents-manifest.mjs';

export function coordinatedWorker(worker,call) {
  // Cloudflare's free-tier external request limit applies to the entire
  // Workflow invocation, not each checkpoint. Poll/cleanup through the private
  // coordinator binding so every operation has its own outbound request budget.
  return {
    start:(...args)=>worker.start(...args),begin:(...args)=>worker.begin(...args),
    collect:(...args)=>worker.collect(...args),validate:(...args)=>worker.validate(...args),
    poll:()=>call('managed-poll'),
    cleanup:async(id)=>{
      try {return await call('managed-cleanup');}
      catch {return worker.cleanup(id);} // Saved Workflow ID survives session expiry or a failed coordinator save.
    },
  };
}

// Each operation is a short checkpoint. The remote agent keeps working while
// Workflow sleeps, with no token stream or running isolate to maintain.
export async function runManagedGeneration({env,step,call,job_id,managedWorker,validatorFactory=createHostedWorker,fallbackFrom=null}) {
  if(tooling.sha256!==hostedAssetManifest.tooling.sha256)throw Error('agents_tooling_stale');
  const worker=managedWorker || coordinatedWorker(new AgentsWorker({env,assets:{skill:hostedAssetManifest.skill,tooling}}),call);
  const retry={retries:{limit:3,delay:'2 seconds',backoff:'exponential'},timeout:'90 seconds'};
  let remote;
  try {
    remote=await step.do('start-managed-session',retry,async()=>{
      const state=await call('status');
      if(['ready','failed','cancelled'].includes(state.status))return {stopped:true,status:state.status};
      const {request}=await call('request');return worker.start(request,job_id);
    });
    if(remote.stopped)return {status:remote.status};
    await step.do('save-managed-session',retry,()=>call('remote',{remote_session_id:remote.session_id}));
    const submitted=await step.do('submit-managed-task',retry,async()=>{
      const state=await call('status');
      if(['ready','failed','cancelled'].includes(state.status))return {stopped:true,status:state.status};
      const {request}=await call('request');return worker.begin(remote.session_id,job_id,request);
    });
    if(submitted.stopped)return {status:submitted.status};
    for(let i=0;i<150;i++) {
      const status=await step.do('poll-managed-'+i,retry,async()=>{
        const local=await call('status');
        if(['cancelled','failed','ready'].includes(local.status))return {stop:true,status:local.status};
        if(Date.now()-remote.started_at>20*60*1000)throw Error('agents_deadline_exceeded');
        const state=await worker.poll(remote.session_id);
        await call('progress',{phase:state.phase,elapsed_ms:Math.max(0,Date.now()-remote.started_at)});
        return state;
      });
      if(status.stop)return {status:status.status};
      if(status.done) {
        return await step.do('validate-managed-artifact',{retries:{limit:0,delay:'1 second'},timeout:'9 minutes'},async()=>{
          const current=await call('status');
          if(['ready','failed','cancelled'].includes(current.status))return {status:current.status};
          await call('validating');
          const authored=await worker.collect(remote.session_id,status.turn_id);
          const {request}=await call('request');
          const result=await worker.validate(authored,request,validatorFactory(env));
          // A job that reached here after the fast describer failed says why in its metrics.
          if(fallbackFrom)result.metrics={...result.metrics,...fallbackFrom};
          await call('progress',{phase:'publishing',elapsed_ms:Math.max(0,Date.now()-remote.started_at)});
          // Idempotent coordinator completion. Delivery retries never regenerate.
          for(let attempt=0;;attempt++) {
            try {const delivered=await call('result',{result});return {status:delivered.status};}
            catch(error){if(attempt===2)throw error;}
          }
        });
      }
      await step.sleep('wait-managed-'+i,'8 seconds');
    }
    throw Error('agents_deadline_exceeded');
  } finally {
    if(remote?.session_id)await step.do('cleanup-managed-session',{
      retries:{limit:6,delay:'5 seconds',backoff:'exponential'},timeout:'1 minute',
    },()=>worker.cleanup(remote.session_id));
  }
}
