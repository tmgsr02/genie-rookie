import { ExplainerService } from '../src/service.mjs';
import { Planner } from '../src/planner.mjs';
import { fail } from '../src/contracts.mjs';
import { timingSafeEqual } from 'node:crypto';
import { encodeState, decodeState } from './state-codec.mjs';
import { AgentsWorker } from '../src/agents-worker.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const positive = (value, fallback) => {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1) throw Error('Invalid demo limit');
  return number;
};
const terminal = (job) => ['ready','failed','cancelled'].includes(job.status);
async function body(request, maximum = 65536) {
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maximum) fail('body_limit',413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes) || '{}'); }
    catch { fail('invalid_json',400); }
  } finally { try { await reader.cancel(); } catch {} }
}

// The entry Worker exposes only /v1/sessions routes. /internal is private to
// service bindings and Workflow callbacks; never forward it from the public edge.
export class TutorObject {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.tail = Promise.resolve(); this.failed = false;
    // Each session's stored chunks, as last written; a change rewrites only its session's changed chunks.
    this.saved = new Map();
    // Chunks still held in the earlier single-blob format, deleted by the next save.
    this.legacyChunks = 0;
    this.publicDemo = env.PUBLIC_DEMO_ENABLED === 'true';
    this.limits = {
      generation: positive(env.DEMO_DAILY_GENERATIONS,40),
      planner: positive(env.DEMO_DAILY_PLANNER_TURNS,300),
      speech: positive(env.DEMO_DAILY_SPEECH_CHARACTERS,100000),
    };
    this.service = new ExplainerService({
      planner: new Planner({apiKey:env.OPENAI_API_KEY || '',model:env.PLANNER_MODEL || 'gpt-5.4-mini',preparedReferences:true}),
      maxJobs: this.publicDemo ? 6 : 30,
      maxPending: positive(env.MAX_PENDING_JOBS,12),
      ttl: positive(env.SESSION_TTL_MS,3600000),
      usage: { charge: (kind,amount) => this.charge(kind,amount) },
      persist: () => this.persist(),
      dispatch: (s,job,request) => this.dispatch(s,job,request),
      cancel: async (_s,job) => {
        // The Workflow observes cancellation and cleans up its remote session.
        // Terminating it here would skip that cleanup.
      },
      awaitNarration: true,
    });
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const read = async keys => {
        const values = new Map();
        for(let i=0;i<keys.length;i+=100) for(const [key,value] of await ctx.storage.get(keys.slice(i,i+100)))values.set(key,value);
        return keys.map(key => { const value=values.get(key); if(typeof value !== 'string')throw Error('Missing persisted session chunk'); return value; });
      };
      const index = await ctx.storage.get('session-index');
      if (index) {
        if (index.version !== 2 || !Array.isArray(index.sessions) || index.sessions.some(id => typeof id !== 'string')) throw Error('Invalid persisted sessions');
        const sessions = [];
        for (const id of index.sessions) {
          const metadata = await ctx.storage.get('session:'+id);
          if (metadata?.version !== 2 || !Number.isSafeInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > 4096) throw Error('Invalid persisted sessions');
          const chunks = await read(Array.from({length:metadata.chunks},(_,i)=>'session:'+id+':'+i));
          const saved = decodeState(chunks.join(''));
          if (saved?.version !== 1 || saved.sessions?.length !== 1 || saved.sessions[0].session_id !== id) throw Error('Invalid persisted sessions');
          sessions.push(saved.sessions[0]);
          this.saved.set(id, chunks);
        }
        this.service.restore({version:1, sessions});
        return;
      }
      const metadata = await ctx.storage.get('session-state-meta');
      if (!metadata) return;
      if (metadata.version !== 1 || !Number.isSafeInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > 4096) throw Error('Invalid persisted sessions');
      const chunks = await read(Array.from({length:metadata.chunks},(_,i)=>'session-state-'+i));
      this.service.restore(decodeState(chunks.join('')));
      this.legacyChunks = metadata.chunks;
    });
    this.reconciled = false;
  }
  async charge(kind, amount = 1) {
    if (!Object.hasOwn(this.limits,kind) || !Number.isSafeInteger(amount) || amount < 1) fail('invalid_quota_request',400);
    try {
      await this.ctx.storage.transaction(async storage => {
        const today = new Date().toISOString().slice(0,10);
        let usage = await storage.get('demo-usage');
        if (usage && (usage.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(usage.day) || usage.day > today ||
          !usage.counts || Object.keys(this.limits).some(k=>!Number.isSafeInteger(usage.counts[k]) || usage.counts[k]<0))) fail('demo_usage_unavailable',503);
        if (!usage || usage.day < today) usage = {version:1,day:today,counts:{generation:0,planner:0,speech:0}};
        if (amount > this.limits[kind]-usage.counts[kind]) fail('demo_'+kind+'_limit',429);
        usage.counts[kind] += amount;
        await storage.put('demo-usage',usage);
      });
    } catch (error) { if(error.status)throw error; fail('demo_usage_unavailable',503); }
  }
  persist() {
    const result = (this.persistenceTail || Promise.resolve()).then(() => this.persistState());
    this.persistenceTail = result.catch(() => {});
    return result;
  }
  async persistState() {
    if (this.failed) fail('session_storage_unavailable',503);
    try {
      const next = new Map(); let size = 0;
      for (const session of this.service.snapshot().sessions) {
        const text = encodeState({version:1, sessions:[session]}), chunks = [];
        // 16K UTF-16 code units are at most64KiB UTF-8, below the KV128KiB value limit.
        for (let i=0;i<text.length;i+=16384) chunks.push(text.slice(i,i+16384));
        next.set(session.session_id, chunks); size += text.length;
      }
      if (size > 24 * 1024 * 1024) fail('session_storage_capacity',503);
      const writes = {}, deletes = [];
      for (const [id,chunks] of next) {
        const before = this.saved.get(id) || [];
        if (before.length !== chunks.length) writes['session:'+id] = {version:2,chunks:chunks.length};
        chunks.forEach((chunk,i)=>{ if (before[i] !== chunk) writes['session:'+id+':'+i] = chunk; });
        for (let i=chunks.length;i<before.length;i++) deletes.push('session:'+id+':'+i);
      }
      for (const [id,before] of this.saved) {
        if (!next.has(id)) deletes.push('session:'+id, ...before.map((_,i)=>'session:'+id+':'+i));
      }
      const ids = [...next.keys()], savedIds = [...this.saved.keys()];
      if (this.legacyChunks || ids.length !== savedIds.length || ids.some((id,i)=>id !== savedIds[i])) {
        writes['session-index'] = {version:2,sessions:ids};
      }
      if (this.legacyChunks) deletes.push('session-state-meta', ...Array.from({length:this.legacyChunks},(_,i)=>'session-state-'+i));
      const entries = Object.entries(writes);
      if (!entries.length && !deletes.length) return;
      await this.ctx.storage.transaction(async storage => {
        // Keep each batch below the storage API's128-key batch limit.
        for(let i=0;i<entries.length;i+=100)await storage.put(Object.fromEntries(entries.slice(i,i+100)));
        for(let i=0;i<deletes.length;i+=100)await storage.delete(deletes.slice(i,i+100));
      });
      this.saved = next;
      this.legacyChunks = 0;
    } catch(error) { this.failed=true; if(error.status)throw error; fail('session_storage_unavailable',503); }
  }
  async dispatch(s,job,request) {
    try {
      await this.env.GENERATION.create({id:job.job_id,params:{session_id:s.session_id,job_id:job.job_id}});
    } catch (error) {
      // A crash can happen after create succeeds but before its response is saved.
      // A stable Workflow ID lets recovery find that run rather than pay twice.
      try { const existing=await this.env.GENERATION.get(job.job_id); await existing.status(); }
      catch { throw error; }
    }
  }
  async recover() {
    if(this.reconciled)return; this.reconciled=true;
    for(const {s,job} of [...this.service.queue]) {
      if(!terminal(job) && !job.abort.signal.aborted)await this.service.dispatchJob(s,job);
    }
    await this.persist();
  }
  enqueue(run) {
    const result=this.tail.then(run);
    this.tail=result.catch(()=>{});
    return result;
  }
  async fetch(request) {
    try {
      await this.ready;
      if(this.failed)fail('session_storage_unavailable',503);
      const url=new URL(request.url);
      // Body reads do not hold the coordinator mutation queue.
      const input=request.method==='POST'?await body(request,url.pathname.startsWith('/internal/jobs/')?8*1024*1024:65536):null;
      if(url.pathname==='/internal/quota' && request.method==='POST') {
        await this.charge(input?.kind,input?.amount); return json({});
      }
      if(request.method==='POST' && ['/internal/jobs/managed-poll','/internal/jobs/managed-cleanup'].includes(url.pathname)) {
        const remoteId=await this.enqueue(()=>{
          const job=this.service.sessions.get(input?.session_id)?.jobs.get(input?.job_id);
          if(!job)fail('job_not_found',404);
          if(!job.remote_session_id)fail('remote_session_missing',409);
          return job.remote_session_id;
        });
        // Provider I/O must not block cancellation, progress or public turns.
        // Only the persisted ID is trusted; request-supplied IDs are ignored.
        this.remoteAgent ||= new AgentsWorker({env:this.env,assets:{}});
        if(url.pathname.endsWith('managed-poll'))return json(await this.remoteAgent.poll(remoteId));
        await this.remoteAgent.cleanup(remoteId);return json({cleaned:true});
      }
      const response=await this.enqueue(async()=>{
        const previousSize=this.service.sessions.size;
        this.service.prune();
        const pruned=previousSize!==this.service.sessions.size;
        await this.recover();
        try { return await this.route(request,url,input); }
        finally {
          const mutation=request.method==='POST'&&!['/internal/jobs/status','/internal/jobs/request'].includes(url.pathname);
          if(mutation||pruned)await this.persist();
        }
      });
      // Long-poll outside the mutation queue so Workflow callbacks and turns can
      // still emit events while this request is waiting.
      // Optional character conversation must never hold up a child's next turn,
      // cancellation, or a Workflow's ready/failed event while the model responds.
      if(response?.conversation)return json(await this.service.generationDialogue(response.session,response.input));
      if(response?.poll)return json(await this.service.poll(response.session,response.after));
      return response;
    } catch(error) { return json({error:error.code || 'service_error'},error.status || 500); }
  }
  async route(request,url,input) {
    const token=/^Bearer ([^ ]+)$/.exec(request.headers.get('Authorization') || '')?.[1] || '';
    if(url.pathname==='/internal/quota' && request.method==='POST') {
      await this.charge(input?.kind,input?.amount); return json({});
    }
    if(url.pathname.startsWith('/internal/jobs/') && request.method==='POST') {
      const s=this.service.sessions.get(input?.session_id),job=s?.jobs.get(input?.job_id);
      if(!s || !job)fail('job_not_found',404);
      if(url.pathname==='/internal/jobs/status')return json({status:job.status});
      if(url.pathname==='/internal/jobs/remote') {
        if(typeof input.remote_session_id!=='string'||!/^sess_[a-zA-Z0-9_-]+$/.test(input.remote_session_id))fail('invalid_remote_session',400);
        job.remote_session_id=input.remote_session_id; return json({status:job.status});
      }
      if(url.pathname==='/internal/jobs/progress') {
        this.service.progress(s,job,input); return json({status:job.status});
      }
      if(url.pathname==='/internal/jobs/request')return json({request:{intent:job.intent,previous:job.previous,scene_id:job.scene_id,scene_version:job.scene_version}});
      if(url.pathname==='/internal/jobs/result') {
        const value=this.service.complete(s,job.job_id,input);return json({status:value.status});
      }
      if(url.pathname==='/internal/jobs/validating') {
        if(!terminal(job)&&job.status!=='validating')this.service.transition(s,job,'validating');
        return json({status:job.status});
      }
      fail('not_found',404);
    }
    if(url.pathname==='/v1/sessions' && request.method==='POST') {
      if(!this.publicDemo) {
        const expected=this.env.BOOTSTRAP_TOKEN;
        if(!expected)fail('bootstrap_not_configured',503);
        if(Buffer.byteLength(token)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token),Buffer.from(expected)))fail('unauthorized',401);
      }
      if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)fail('invalid_schema',400);
      return json({...this.service.create(),generation_engine:'openai_agents_v6'},201);
    }
    const match=url.pathname.match(/^\/v1\/sessions\/([a-zA-Z0-9_-]+)\/(turns|tools|events|scene-events|generation-dialogue|jobs\/[a-zA-Z0-9_-]+)$/);
    if(!match)fail('not_found',404);
    const s=this.service.session(match[1],token),route=match[2];
    if(route==='generation-dialogue' && request.method==='POST')return {conversation:true,session:s,input};
    if(route==='turns' && request.method==='POST')return json(await this.service.turn(s,input));
    if(route==='tools' && request.method==='POST')return json(await this.service.tool(s,input));
    if(route==='scene-events' && request.method==='POST')return json(await this.service.sceneEvent(s,input));
    if(route==='events' && request.method==='GET') {
      const after=Number(url.searchParams.get('after') || 0);
      if(!Number.isSafeInteger(after)||after<0||after>s.sequence)fail('invalid_cursor',400);
      return {poll:true,session:s,after};
    }
    if(route.startsWith('jobs/')&&request.method==='GET')return json(this.service.getJob(s,route.slice(5)));
    fail('method_not_allowed',405);
  }
}
