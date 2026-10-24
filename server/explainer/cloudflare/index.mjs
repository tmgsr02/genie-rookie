import {isPreparedRaptor} from '../src/prepared-raptor.mjs';
import {loadPreparedRaptor} from './prepared-raptor.mjs';
import {runManagedGeneration} from './managed-generation.mjs';
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {createHostedWorker} from './hosted-assets.mjs';
import {validationDiagnostics} from '../src/hosted-worker-core.mjs';
import {DescriberWorker} from '../src/describer-worker.mjs';
import {json, errorResponse} from './http.mjs';
export {TutorObject} from './tutor-object.mjs';
export {VoiceObject} from './voice-object.mjs';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return json({
        ok:true, provider_configured:!!env.OPENAI_API_KEY, speech_configured:!!env.BOSON_API_KEY,
        access_mode:env.PUBLIC_DEMO_ENABLED === 'true' ? 'public_demo' : 'disabled', worker:'openai_agents', hosting:'cloudflare',
      });
      if (env.PUBLIC_DEMO_ENABLED !== 'true') return json({error:'demo_disabled'},503);
      // Internal callbacks are binding-only: public URLs can never reach them.
      const tutorRoute = /^\/v1\/sessions(?:\/|$)/.test(url.pathname);
      const voiceRoute = ['/v1/voice-sessions','/v1/ready','/v1/speech'].includes(url.pathname);
      if (!tutorRoute && !voiceRoute) return json({error:'not_found'},404);
      const voice = env.VOICE.get(env.VOICE.idFromName('voice'));
      const rate = await voice.fetch('https://internal/internal/rate', {method:'POST',body:JSON.stringify({
        ip:request.headers.get('CF-Connecting-IP') || 'local',
        creation:request.method === 'POST' && ['/v1/sessions','/v1/voice-sessions'].includes(url.pathname),
      })});
      if (!rate.ok) return rate;
      const destination = tutorRoute ? env.TUTOR.get(env.TUTOR.idFromName('coordinator')) : voice;
      return await destination.fetch(request);
    } catch (error) {return errorResponse(error);}
  },
};

export class GenerationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const {session_id,job_id} = event.payload;
    const tutor = this.env.TUTOR.get(this.env.TUTOR.idFromName('coordinator'));
    const call = async (path,extra = {}) => {
      const response = await tutor.fetch('https://internal/internal/jobs/'+path, {
        method:'POST',body:JSON.stringify({session_id,job_id,...extra}),
      });
      if (!response.ok) {
        const detail=await response.json().catch(()=>({}));
        const code=/^[a-z_]{1,60}$/.test(detail.error || '')?detail.error:'unknown';
        throw Error('job_callback_'+path+'_'+response.status+'_'+code);
      }
      return response.json();
    };
    try {
      const initial=await step.do('load-generation-route',async()=>{
        const state=await call('status');
        if(['ready','failed','cancelled'].includes(state.status))return {status:state.status};
        const {request}=await call('request');return {representation:request.intent.representation,prepared:isPreparedRaptor(request)};
      });
      if(initial.status)return {status:initial.status};
      if(initial.prepared)return await step.do('deliver-reviewed-reference',{retries:{limit:2,delay:'1 second'},timeout:'1 minute'},async()=>{
        const state=await call('status');
        if(['ready','failed','cancelled'].includes(state.status))return {status:state.status};
        const {request}=await call('request');
        if(!isPreparedRaptor(request))throw Error('reference_request_changed');
        const result=await loadPreparedRaptor(this.env.HOSTED_ASSETS,request);
        return {status:(await call('result',{result})).status};
      });
      if(initial.representation==='isometric') {
        // Fast path first: the scene engine packages a streamed description in seconds. Any
        // failure falls through to the managed Anatomy author below; paid work is never repeated.
        let described=null;
        if((this.env.DESCRIBER_MODE ?? 'isometric')!=='off') {
          described=await step.do('describe-scene',{retries:{limit:0,delay:'1 second'},timeout:'4 minutes'},async()=>{
            const state=await call('status');
            if(['ready','failed','cancelled'].includes(state.status))return {status:state.status};
            const {request}=await call('request');
            let result;
            try {
              await call('progress',{phase:'authoring',elapsed_ms:0});
              result=await new DescriberWorker({env:this.env}).author({...request,onValidating:()=>call('validating')});
            } catch(error) {
              // Codes and check names only: never model output or child text.
              const code=/^[a-z_:.,0-9-]{1,120}$/i.test(error.message)?error.message:'describer_error';
              const detail=/^[a-z_:.,0-9-]{1,300}$/i.test(String(error.detail??''))?String(error.detail):'';
              console.error(JSON.stringify({type:'describer_fallback',job_id,code,detail}));
              return {fallback:true,describer_fallback:code,describer_detail:detail};
            }
            for(let attempt=0;;attempt++) {
              try {return {status:(await call('result',{result})).status};}
              catch(error){if(attempt===2)throw error; await new Promise(resolve=>setTimeout(resolve,500));}
            }
          });
          if(described.status)return {status:described.status};
        }
        return await runManagedGeneration({env:this.env,step,call,job_id,fallbackFrom:described?.fallback?{describer_fallback:described.describer_fallback,describer_detail:described.describer_detail}:null});
      }
      return await step.do('author-and-validate', {retries:{limit:0,delay:'1 second'}, timeout:'20 minutes'}, async () => {
        const state = await call('status');
        if (['cancelled','failed','ready'].includes(state.status)) return {status:state.status};
        const {request} = await call('request');
        const abort = new AbortController();
        let done = false;
        // The generation belongs to a durable job, independently of the phone connection.
        const watcher = (async () => {
          while (!done) {
            await new Promise(resolve => {
              const finish = () => {clearTimeout(t); abort.signal.removeEventListener('abort',finish); resolve();};
              const t = setTimeout(finish,5000);
              abort.signal.addEventListener('abort',finish,{once:true});
            });
            if (done) break;
            try {if ((await call('status')).status === 'cancelled') {abort.abort(); break;}}
            catch {abort.abort(); break;}
          }
        })();
        try {
          let validationAttempt = 0;
          const worker = createHostedWorker(this.env, {onExecution: ({phase,response}) => {
            if (phase === 'validation') console.log(JSON.stringify({
              type:'generation_validation', job_id, attempt:++validationAttempt,
              ...validationDiagnostics(response),
            }));
          }});
          await call('progress',{phase:'authoring',elapsed_ms:0});
          const result = await worker.author({...request,signal:abort.signal,onValidating:()=>call('validating')});
          // Save large packages in the coordinator, keeping Workflow checkpoint data small.
          // Retrying delivery must never repeat the paid authoring step.
          for (let attempt = 0; ; attempt++) {
            try {await call('result',{result}); break;}
            catch (error) {if (attempt === 2) throw error; await new Promise(resolve=>setTimeout(resolve,500));}
          }
          return {status:'ready'};
        } finally {done = true; abort.abort(); await watcher;}
      });
    } catch (error) {
      console.error(JSON.stringify({type:'generation_failed',job_id,code:/^[a-z_]{1,80}$/.test(error.message) ? error.message : 'provider_or_runtime_error'}));
      await step.do('report-failure',{retries:{limit:3,delay:'2 seconds',backoff:'exponential'}},()=>call('result',{error:'generation_failed'}));
      return {status:'failed'};
    }
  }
}
