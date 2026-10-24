import {json, fail, errorResponse, readJSON, bearer, emptyBody} from './http.mjs';
import {speechReady, speechPayload, speechResponse} from './speech-stream.mjs';
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
// All voice grants and rate counters live in this one durable coordinator.
// Only hashed grants are retained; provider credentials stay in Worker secrets.
export class VoiceObject {
  constructor(ctx, env) {this.ctx = ctx; this.env = env; this.running = 0;}
  async fetch(request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/internal/rate' && request.method === 'POST') {
        const {ip, creation} = await readJSON(request);
        if (typeof ip !== 'string' || ip.length > 100) fail('invalid_rate_key');
        const key = 'rate:' + await hash(ip), now = Date.now();
        await this.ctx.storage.transaction(async tx => {
          const previous = await tx.get(key);
          const record = previous?.expires > now ? previous : {count:0, creations:0, expires:now+60000};
          if (++record.count > 240 || (creation && ++record.creations > 12)) fail('rate_limited',429);
          await tx.put(key,record);
          if (!(await tx.getAlarm())) await tx.setAlarm(now+60000);
        });
        return json({ok:true});
      }
      if (path === '/v1/voice-sessions' && request.method === 'POST') {
        if (this.env.PUBLIC_DEMO_ENABLED !== 'true') fail('demo_disabled',503);
        emptyBody(await readJSON(request));
        if (!this.env.BOSON_API_KEY) fail('speech_provider_not_configured',503);
        const token = randomToken(), key = 'token:' + await hash(token), expires = Date.now()+1200000;
        await this.ctx.storage.transaction(async tx => {
          const entries = await tx.list({prefix:'token:'}); let count = 0;
          for (const [k,v] of entries) {if (v.expires <= Date.now()) await tx.delete(k); else count++;}
          if (count >= 100) fail('voice_session_capacity',429);
          await tx.put(key,{expires,count:0,until:0});
          if (!(await tx.getAlarm())) await tx.setAlarm(Date.now()+60000);
        });
        return json({token, expires_at:new Date(expires).toISOString()},201);
      }
      if (!((path === '/v1/ready' && request.method === 'GET') || (path === '/v1/speech' && request.method === 'POST'))) fail('not_found',404);
      const token = bearer(request);
      if (!/^[a-f0-9]{64}$/.test(token) || request.headers.get('x-app-id') !== 'genius-rookie') fail('unauthorized',401);
      const key = 'token:' + await hash(token);
      await this.ctx.storage.transaction(async tx => {
        const record = await tx.get(key), now = Date.now();
        if (!record || record.expires <= now) fail('unauthorized',401);
        if (record.until <= now) {record.until = now+60000; record.count = 0;}
        if (++record.count > 30) fail('speech_rate_limited',429);
        await tx.put(key,record);
      });
      if (!this.env.BOSON_API_KEY) fail('speech_provider_not_configured',503);
      if (path === '/v1/ready') return json(speechReady());
      if ((request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') fail('unsupported_media_type',415);
      const body = await readJSON(request), payload = speechPayload(body);
      if (this.running >= 8) fail('speech_capacity',429);
      this.running++;
      let handedOff = false;
      try {
        const tutor = this.env.TUTOR.get(this.env.TUTOR.idFromName('coordinator'));
        const charge = await tutor.fetch('https://internal/internal/quota',{method:'POST',body:JSON.stringify({kind:'speech',amount:[...body.text].length})});
        if (!charge.ok) return charge;
        // speechResponse owns the slot from here, including failures before 200.
        handedOff = true;
        return await speechResponse({apiKey:this.env.BOSON_API_KEY,payload,signal:request.signal,release:()=>{this.running--;}});
      } finally {if (!handedOff) this.running--;}
    } catch (error) {return errorResponse(error);}
  }
  async alarm() {
    const now = Date.now(); let live = false;
    for (const prefix of ['token:','rate:']) {
      for (const [key,value] of await this.ctx.storage.list({prefix})) {
        if (value.expires <= now) await this.ctx.storage.delete(key); else live = true;
      }
    }
    if (live) await this.ctx.storage.setAlarm(now+60000);
  }
}
