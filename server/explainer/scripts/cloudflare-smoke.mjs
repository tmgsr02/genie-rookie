import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base = process.env.DEMO_URL || 'https://genie-rookie-demo.genie-rookie.workers.dev';
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Expected public HTTPS DEMO_URL without credentials');
const results = {base,checked_at:new Date().toISOString(),speech:[]};
async function call(path,init = {}) {return fetch(base+path,{...init,signal:AbortSignal.timeout(60000)});}
let r = await call('/health'); assert.equal(r.status,200);
results.health=await r.json();assert.equal(results.health.provider_configured,true);assert.equal(results.health.speech_configured,true);
r=await call('/v1/sessions',{method:'POST',body:'{}'});assert.equal(r.status,201);
const session=await r.json();assert.ok(session.session_id && session.session_token);
r=await call('/v1/sessions/'+session.session_id+'/events?after=0',{headers:{Authorization:'Bearer '+session.session_token}});assert.equal(r.status,200);
r=await call('/v1/voice-sessions',{method:'POST',body:'{}'});assert.equal(r.status,201);
const {token}=await r.json();assert.ok(token);
const headers={Authorization:'Bearer '+token,'X-App-ID':'genius-rookie','Content-Type':'application/json'};
r=await call('/v1/ready',{headers});assert.equal(r.status,200);results.ready=await r.json();
assert.equal((await call('/v1/ready')).status,401);
assert.equal((await call('/internal/jobs/result',{method:'POST',body:'{}'})).status,404);
const output=new URL('../artifacts/cloudflare-live/',import.meta.url);
await mkdir(output,{recursive:true});
if(process.argv.includes('--speech')) {
  for(const voice of ['genius','rookie']) {
    const started=Date.now();
    r=await call('/v1/speech',{method:'POST',headers,body:JSON.stringify({voice,text:voice==='genius'?'Hello, I am Genie. Let us explore fractions together.':'And I am Rookie. Can two quarters make one half?'})});
    if(!r.ok)throw Error('Speech failed: '+r.status+' '+(await r.json()).error);
    let first_ms=null; const chunks=[];
    for await(const chunk of r.body){if(first_ms===null)first_ms=Date.now()-started;chunks.push(Buffer.from(chunk));}
    const pcm=Buffer.concat(chunks); let peak=0;
    assert.ok(pcm.length>0 && pcm.length%2===0);
    for(let i=0;i<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
    assert.ok(peak>0);assert.equal(r.headers.get('x-audio-format'),'pcm_s16le');
    const result={voice,status:r.status,first_ms,total_ms:Date.now()-started,bytes:pcm.length,seconds:pcm.length/48000,peak};
    results.speech.push(result); console.log(JSON.stringify(result));
    const wav=Buffer.alloc(44);wav.write('RIFF',0);wav.writeUInt32LE(pcm.length+36,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);
    await writeFile(new URL(voice+'.wav',output),Buffer.concat([wav,pcm]));
  }
}
await writeFile(new URL('checks.json',output),JSON.stringify(results,null,2)+'\n');
console.log('Public HTTPS, anonymous tutor/voice sessions, authorization and private-route isolation passed.');
