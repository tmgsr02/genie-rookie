import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.mjs';
import { ExplainerService } from '../src/service.mjs';
import { SpeechGateway } from '../src/speech.mjs';
const listen=async(t,s)=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});return `http://127.0.0.1:${s.address().port}`;};
async function setup(t,handler,options={}) {
 const upstream=await listen(t,http.createServer(handler));let request;
 const gateway=new SpeechGateway({apiKey:'mock-key',fetchImpl:(url,init)=>{request={url,...init};return fetch(upstream,init);},...options});
 const base=await listen(t,createServer(new ExplainerService(),{env:{BOOTSTRAP_TOKEN:"private"},speech:gateway}));
 const {token}=await(await fetch(base+'/v1/voice-sessions',{method:'POST',headers:{Authorization:'Bearer private'},body:'{}'})).json();
 return {gateway,request:()=>request,speak:(body={text:'Hello',voice:'genius'})=>fetch(base+'/v1/speech',{method:'POST',headers:{Authorization:'Bearer '+token,'X-App-ID':'genius-rookie','Content-Type':'application/json'},body:JSON.stringify(body)})};
}
test('streams complete PCM and fixes Boson model, origin, format and voices',async t=>{
 const x=await setup(t,(_req,res)=>{res.setHeader('Content-Type','audio/pcm');res.write(Buffer.from([1]));setTimeout(()=>res.end(Buffer.from([2,3,4])),5);});
 const r=await x.speak();assert.equal(r.status,200);assert.equal(r.headers.get('x-audio-sample-rate'),'24000');
 assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3,4]);
 assert.equal(x.request().url,'https://api.boson.ai/v1/audio/speech');assert.equal(x.request().redirect,'error');
 assert.deepEqual(JSON.parse(x.request().body),{model:'higgs-tts-3',input:'<|emotion:amusement|>Hello',voice:'chloe',stream:true,response_format:'pcm',normalize:true});
});
test('empty, invalid format, stereo and upstream credential rejection fail before 200',async t=>{
 for(const mode of ['empty','mime','stereo','credential']) {
  const x=await setup(t,(_req,res)=>{res.statusCode=mode==='credential'?401:200;res.setHeader('Content-Type',mode==='mime'?'application/json':'audio/pcm');if(mode==='stereo')res.setHeader('X-Audio-Channels','2');res.end(mode==='empty'?Buffer.alloc(0):Buffer.from([1,2]));});
  const r=await x.speak();assert.equal(r.status,mode==='credential'?503:502);assert.ok((await r.json()).error);
 }
});
test('odd trailing sample terminates transport instead of reporting clean success',async t=>{
 const x=await setup(t,(_req,res)=>{res.setHeader('Content-Type','audio/pcm');res.write(Buffer.from([1,2]));setTimeout(()=>res.end(Buffer.from([3])),10);});
 const r=await x.speak();assert.equal(r.status,200);await assert.rejects(r.arrayBuffer());
});
test('speech limits and malformed text reject without charging or contacting provider',async t=>{
 let charges=0,calls=0;const x=await setup(t,(_req,res)=>{calls++;res.end();},{usage:{charge:()=>charges++}});
 for(const body of [{text:'x'.repeat(2001),voice:'genius'},{text:'x',voice:'other'},{text:'\ud800',voice:'genius'},{text:' ',voice:'rookie'},{text:'x',voice:'rookie',model:'other'}])assert.ok((await x.speak(body)).status>=400);
 assert.equal(calls,0);assert.equal(charges,0);
});
test('client disconnect cancels the upstream stream and releases slot',async t=>{
 let disconnected=false;const x=await setup(t,(_req,res)=>{res.setHeader('Content-Type','audio/pcm');res.write(Buffer.from([1,2]));res.on('close',()=>{disconnected=true;});});
 const r=await x.speak();await r.body.cancel();
 for(let i=0;i<50&&!disconnected;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(disconnected,true);assert.equal(x.gateway.running,0);
});

test('speech reservations reject before provider work and slot capacity is bounded',async t=>{
 let calls=0;const x=await setup(t,(_req,res)=>{calls++;res.end(Buffer.from([1,2]));},{usage:{charge:()=>{const e=new Error('demo_speech_limit');e.code='demo_speech_limit';e.status=429;throw e;}}});
 assert.equal((await x.speak()).status,429);assert.equal(calls,0);assert.equal(x.gateway.running,0);
 x.gateway.running=8;assert.equal((await x.speak()).status,429);assert.equal(calls,0);x.gateway.running=0;
});
test('oversized declared audio fails before success and lone sample byte is invalid',async t=>{
 const big=await setup(t,(_req,res)=>{res.setHeader('Content-Type','audio/pcm');res.setHeader('Content-Length',8640002);res.end(Buffer.from([1,2]));});
 assert.equal((await big.speak()).status,502);
 const odd=await setup(t,(_req,res)=>{res.setHeader('Content-Type','audio/pcm');res.write(Buffer.from([1]));res.end();});
 assert.equal((await odd.speak()).status,502);
});
