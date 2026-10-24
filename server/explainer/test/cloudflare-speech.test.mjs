import test from 'node:test';
import assert from 'node:assert/strict';
import {speechPayload,speechResponse} from '../cloudflare/speech-stream.mjs';
import {VoiceObject} from '../cloudflare/voice-object.mjs';

function store() {
  const data = new Map(); let alarm = null, tail = Promise.resolve();
  const storage = {
    async get(k){return structuredClone(data.get(k));},
    async put(k,v){data.set(k,structuredClone(v));},
    async delete(k){return data.delete(k);},
    async list({prefix}){return new Map([...data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));},
    async getAlarm(){return alarm;}, async setAlarm(value){alarm=value;},
    transaction(fn){const result=tail.then(()=>fn(storage)); tail=result.catch(()=>{}); return result;},
  }; return {storage,data};
}
const req=(path,method='POST',body={},headers={})=>new Request('https://demo.example'+path,{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('Cloudflare voice grants survive object restart and expire without storing raw credentials',async()=>{
  const ctx=store(),env={PUBLIC_DEMO_ENABLED:'true',BOSON_API_KEY:'test'};
  const first=new VoiceObject(ctx,env);
  const response=await first.fetch(req('/v1/voice-sessions'));
  assert.equal(response.status,201); const {token}=await response.json();
  assert.equal(JSON.stringify([...ctx.data]).includes(token),false);
  const next=new VoiceObject(ctx,env),headers={Authorization:'Bearer '+token,'X-App-ID':'genius-rookie'};
  assert.equal((await next.fetch(req('/v1/ready','GET',null,headers))).status,200);
  assert.equal((await next.fetch(req('/v1/ready','GET',null,{Authorization:'Bearer '+token}))).status,401);
  for(const [key,value] of ctx.data)if(key.startsWith('token:')){value.expires=Date.now()-1;ctx.data.set(key,value);}
  assert.equal((await next.fetch(req('/v1/ready','GET',null,headers))).status,401);
});
test('Cloudflare public access is explicit and grant creation/rates are bounded',async()=>{
  const ctx=store(),voice=new VoiceObject(ctx,{BOSON_API_KEY:'test'});
  assert.equal((await voice.fetch(req('/v1/voice-sessions'))).status,503);
  voice.env.PUBLIC_DEMO_ENABLED='true';
  assert.equal((await voice.fetch(req('/v1/voice-sessions','POST',{extra:true}))).status,400);
  for(let n=0;n<12;n++)assert.equal((await voice.fetch(req('/internal/rate','POST',{ip:'test-client',creation:true}))).status,200);
  assert.equal((await voice.fetch(req('/internal/rate','POST',{ip:'test-client',creation:true}))).status,429);
});
test('Cloudflare speech quota rejection does not call provider or leak a slot',async()=>{
  const ctx=store(),voice=new VoiceObject(ctx,{PUBLIC_DEMO_ENABLED:'true',BOSON_API_KEY:'test',TUTOR:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({error:'demo_speech_limit'},{status:429})})}});
  const {token}=await(await voice.fetch(req('/v1/voice-sessions'))).json();
  const response=await voice.fetch(req('/v1/speech','POST',{text:'Hello',voice:'genius'},{Authorization:'Bearer '+token,'X-App-ID':'genius-rookie','Content-Type':'application/json'}));
  assert.equal(response.status,429); assert.equal(voice.running,0);
});
test('Cloudflare speech schema fixes provider origin and voice choices',()=>{
  assert.equal(speechPayload({text:'Hello',voice:'genius'}).voice,'chloe');
  assert.equal(speechPayload({text:'Hello',voice:'rookie'}).voice,'marcus');
  assert.equal(speechPayload({text:'Hello',voice:'genius'}).input,'<|emotion:amusement|>Hello');
  assert.equal(speechPayload({text:'Hello',voice:'rookie'}).input,'<|emotion:enthusiasm|>Hello');
  for(const value of [{text:'',voice:'genius'},{text:'a'.repeat(2001),voice:'genius'},{text:'x',voice:'other'},{text:'x',voice:'genius',url:'https://elsewhere'}])assert.throws(()=>speechPayload(value));
});
test('Cloudflare PCM streaming preserves sample alignment and releases once',async()=>{
  let released=0,seen;
  const response=await speechResponse({apiKey:'test',payload:speechPayload({text:'Hello',voice:'genius'}),release:()=>released++,fetchImpl:async(url,options)=>{
    seen={url,options}; return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.enqueue(new Uint8Array([2,3,4]));c.close();}}),{headers:{'Content-Type':'audio/pcm'}});
  }});
  assert.equal(response.status,200);assert.equal(response.headers.get('x-audio-sample-rate'),'24000');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4]);assert.equal(released,1);
  assert.equal(seen.url,'https://api.boson.ai/v1/audio/speech');assert.equal(seen.options.redirect,'manual');
});
test('Cloudflare provider redirects are rejected without forwarding credentials',async()=>{
  for(const status of [301,302,303,307,308])await assert.rejects(speechResponse({apiKey:'test',payload:{},fetchImpl:async(_url,options)=>{
    assert.equal(options.redirect,'manual');
    return new Response(null,{status,headers:{Location:'https://untrusted.example'}});
  }}),error=>error.code==='speech_provider_unavailable');
});
test('Cloudflare empty or non PCM responses fail before HTTP200',async()=>{
  for(const [bytes,mime] of [[[], 'audio/pcm'],[[1],'audio/pcm'],[[1,2],'application/json']]){
    let released=0;
    await assert.rejects(speechResponse({apiKey:'test',payload:{},release:()=>released++,fetchImpl:async()=>new Response(new Uint8Array(bytes),{headers:{'Content-Type':mime}})}));
    assert.equal(released,1);
  }
});
test('Cloudflare truncated PCM errors downstream and cancels upstream',async()=>{
  let released=0;
  const response=await speechResponse({apiKey:'test',payload:{},release:()=>released++,fetchImpl:async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/pcm'}})});
  await assert.rejects(response.arrayBuffer());assert.equal(released,1);
});
test('Cloudflare downstream cancel aborts Boson',async()=>{
  let signal,released=0;
  const response=await speechResponse({apiKey:'test',payload:{},release:()=>released++,fetchImpl:async(_url,options)=>{
    signal=options.signal;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));}}),{headers:{'Content-Type':'audio/pcm'}});
  }});
  await response.body.cancel();assert.equal(signal.aborted,true);assert.equal(released,1);
});
