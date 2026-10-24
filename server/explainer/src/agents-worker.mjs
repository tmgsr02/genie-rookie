import OpenAI from 'openai';
import {Buffer} from 'node:buffer';
import {authorInstruction} from './author-prompt.mjs';
import {normalizePackage} from './package.mjs';
import {checkReport} from './hosted-worker-core.mjs';

const outputPath='/workspace/outputs/gr-result.json';
const maximumOutput=6_500_000;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function managedRequest(request,assets,env,jobId) {
  if(!assets.tooling?.file_id || !assets.skill?.skill_id)throw Error('agents_assets_missing');
  return {
    stream:false,
    agent:{model:env.AGENTS_AUTHOR_MODEL || env.HOSTED_AUTHOR_MODEL || 'gpt-5.4',
      reasoning:{effort:env.HOSTED_AUTHOR_REASONING || 'medium'},
      instructions:authorInstruction('/mnt/data/gr/app',{hosted:true})},
    environment:{type:'openai_hosted',container_size:'medium',packages:{system:['chromium']},network:{access:'disabled'},
      skills:[{type:'skill_reference',skill_id:assets.skill.skill_id,version:assets.skill.version}],
      files:[{type:'file_id',file_id:assets.tooling.file_id,path:'/workspace/tooling.tar.gz'},
        {type:'inline',path:'/workspace/request.json',data:Buffer.from(JSON.stringify({intent:request.intent,previous:request.previous})).toString('base64')}],
      setup_commands:[{command:'mkdir -p /mnt/data/gr/job /workspace/outputs && tar -xzf /workspace/tooling.tar.gz -C /mnt/data/gr && node -e '+quote("const fs=require('fs');const r=JSON.parse(fs.readFileSync('/workspace/request.json','utf8'));fs.writeFileSync('/mnt/data/gr/job/intent.json',JSON.stringify(r.intent));if(r.previous)fs.writeFileSync('/mnt/data/gr/job/previous.json',JSON.stringify(r.previous));")}],
      env:{CHROME_PATH:'/usr/bin/chromium'}},
    input:'Use the anatomy skill to author the interactive lesson specified by /mnt/data/gr/job/intent.json. Work in /mnt/data/gr/job. Read previous.json if present. The pinned skill mirror is /mnt/data/gr/app/vendor/anatomy. Read the actual skill and the closest complete examples, then build the requested lesson using its geometry kit. For rocket engines and dense pipework study examples/raptor-engine; for other subjects select the examples that actually match the mechanism. Preserve Anatomy detail, small physical parts, rounded solids, pipework, shading, depth order and motion. A Figure typically has 40–80 meaningful parts and a Hero 80–150; do not reduce a rich requested subject to generic blocks. Wrap every Anatomy figure in an .iso ancestor (or give its SVG both iso and iso-svg classes) and include the kit palette CSS: its --anatomy-* custom properties must resolve on every generated solid and line. Missing palette scope renders the drawing black and fails validation. Plan a complete physical assembly with a grouped parts list and run the real geometry audit as you develop it and its interactive page. Read the kit audit metadata contract before recording solids: name parts, model their actual support relationships, and render them in correct depth order. Never mark unsupported parts as grounded merely to silence the audit. Preserve subject-specific mechanisms and the fine construction details that make the object legible at phone scale and rewarding at 4x. Shell utilities rg and apply_patch may be absent; use standard shell, Node or Python immediately rather than searching for those utilities. For model tests use visible HTML readouts without CSS text-transform; expected text is compared to rendered innerText, including casing. Then run CHROME_PATH=/usr/bin/chromium node /mnt/data/gr/app/src/hosted-preview.mjs to perform the real geometry/line checks, schema and browser tests. Repair concrete failures and refine craft within the job budget; do not trade away required detail to pass a check. The server independently reviews the rendered screenshots with a vision model and performs a separate factual grounding review before publication. Finally run node /mnt/data/gr/app/src/hosted-collect.mjs and copy /mnt/data/gr-result.json to /workspace/outputs/gr-result.json. Publish that file only when checks pass. Do not replace it with a prose answer. Do not modify tooling under /mnt/data/gr/app. Report limitations honestly.',
    metadata:{application:'genie-rookie',job_id:jobId},
  };
}

export class AgentsWorker {
  constructor({client,assets,env={}}) {
    this.client=client || new OpenAI({apiKey:env.OPENAI_API_KEY,maxRetries:0,timeout:30000});
    this.assets=assets; this.env=env;
  }
  get sessions(){return this.client.beta.agents.sessions;}
  async start(request,jobId) {
    // Session creation does not deduplicate Idempotency-Key (verified live).
    // Recover by job metadata before creating; submit paid input only after the
    // chosen session ID has been checkpointed by the Workflow.
    let after;
    for(let page=0;page<10;page++) {
      const sessions=await this.sessions.list({limit:100,order:'desc',...(after?{after}:{})});
      const existing=sessions.data.find(s=>s.metadata.application==='genie-rookie' && s.metadata.job_id===jobId);
      if(existing)return {session_id:existing.id,started_at:existing.created_at*1000};
      if(!sessions.has_more)break;
      after=sessions.data.at(-1)?.id;
      if(!after||page===9)throw Error('agents_recovery_history_limit');
    }
    const {input,...configuration}=managedRequest(request,this.assets,this.env,jobId);
    const session=await this.sessions.create(configuration,{
      headers:{'Idempotency-Key':'genie-rookie-'+jobId},timeout:60000,
    });
    return {session_id:session.id,started_at:session.created_at*1000};
  }
  async begin(id,jobId,request) {
    const {input}=managedRequest(request,this.assets,this.env,jobId);
    await this.sessions.events.create(id,{events:[{type:'agent.session.input.message',input:[{role:'user',content:[{type:'input_text',text:input}]}]}]},
      {headers:{'Idempotency-Key':'genie-rookie-input-'+jobId}});
    return {submitted:true};
  }
  async poll(id) {
    const session=await this.sessions.retrieve(id);
    if(session.status==='failed' || session.environment?.status==='failed')throw Error('agents_session_failed');
    if(session.status==='requires_action')throw Error('agents_unexpected_action');
    let turn,after;
    for(let page=0;page<10;page++) {
      const turns=await this.sessions.turns.list(id,{limit:100,order:'desc',...(after?{after}:{})});
      turn=turns.data.find(t=>t.subagent_id===null);
      if(turn||!turns.has_more)break;
      after=turns.data.at(-1)?.id;
      if(!after)break;
      if(page===9)throw Error('agents_turn_history_limit');
    }
    if(turn?.status==='failed')throw Error('agents_turn_failed');
    if(turn?.status==='cancelled')throw Error('agents_turn_cancelled');
    if(turn?.status==='completed')return {done:true,turn_id:turn.id,phase:'checking'};
    // A submitted turn can be in_progress while the hosted environment is
    // provisioning; report authoring only after it is actually connected.
    const environment=session.environment?.id
      ? await this.client.beta.agents.environments.retrieve(session.environment.id) : null;
    if(environment && ['failed','expired'].includes(environment.status))throw Error('agents_environment_failed');
    return {done:false,phase:turn?.status==='in_progress' && (!environment || environment.status==='connected') ? 'authoring' : 'preparing'};
  }
  async collect(id,turnId) {
    let artifact,after;
    // Bounded pagination: this application expects only one final artifact.
    for(let page=0;page<10;page++) {
      const result=await this.sessions.artifacts.list(id,{limit:100,order:'desc',...(after?{after}:{})});
      artifact=result.data.find(a=>a.path===outputPath && a.turn_id===turnId && a.session_id===id);
      if(artifact || !result.has_more)break;
      after=result.data.at(-1)?.id;
      if(!after)break;
    }
    if(!artifact)throw Error('agents_artifact_missing');
    if(!Number.isSafeInteger(artifact.size_bytes)||artifact.size_bytes<1||artifact.size_bytes>maximumOutput)throw Error('agents_artifact_limit');
    const response=await this.sessions.artifacts.content(artifact.id,{session_id:id});
    const reader=response.body.getReader(),chunks=[]; let bytes=0;
    try {
      for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximumOutput)throw Error('agents_artifact_limit');chunks.push(value);}
    } finally {await reader.cancel();}
    if(bytes!==artifact.size_bytes)throw Error('agents_artifact_size_mismatch');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async validate(authored,request,validator) {
    if(authored.package?.manifest?.representation!=='isometric')throw Error('agents_representation_mismatch');
    checkReport(authored.authoring_report);
    const pkg=normalizePackage(authored.package,{scene_id:request.scene_id,scene_version:request.scene_version});
    const checked=await validator.validate(pkg,authored.audit_sources,{signal:AbortSignal.timeout(480000),authoringReport:authored.authoring_report});
    pkg.validation=checked.validation; pkg.authoring_report=authored.authoring_report;
    return {package:pkg,metrics:{worker:'openai_agents',skill:this.assets.skill,validation_usage:checked.usage}};
  }
  async cleanup(id) {
    try {await this.sessions.events.create(id,{events:[{type:'agent.session.input.cancel'}]});}
    catch {} // Deleting the session must still be attempted if cancellation fails.
    try {await this.sessions.delete(id);}catch(error){if(error.status!==404)throw error;}
  }
}
