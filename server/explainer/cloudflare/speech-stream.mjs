import {fail} from './http.mjs';
// Each character's Boson preset, and the emotion its lines are spoken with.
const VOICES = Object.freeze({genius: 'chloe', rookie: 'marcus'});
const EMOTIONS = Object.freeze({genius: 'amusement', rookie: 'enthusiasm'});
const MAX_AUDIO = 24000 * 2 * 180;
export const speechReady = () => ({voices: Object.keys(VOICES), format: 'pcm_s16le', sample_rate: 24000, channels: 1});
export function speechPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'text,voice') fail('invalid_speech_schema');
  if (typeof body.text !== 'string' || !body.text.trim() || [...body.text].length > 2000 || /[\uD800-\uDFFF]/u.test(body.text)) fail('invalid_speech_text');
  if (typeof body.voice !== 'string' || !Object.hasOwn(VOICES, body.voice)) fail('voice_not_permitted', 403);
  return {model: 'higgs-tts-3', input: `<|emotion:${EMOTIONS[body.voice]}|>` + body.text, voice: VOICES[body.voice], stream: true, response_format: 'pcm', normalize: true};
}
// Stream validated, sample-aligned PCM; an interrupted stream never becomes clean EOF.
export async function speechResponse({apiKey, payload, signal, fetchImpl = fetch, release = () => {}}) {
  const abort = new AbortController();
  const active = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), 180000);
  let reader, finished = false, pending = new Uint8Array(), total = 0, expected;
  const cleanup = async () => {
    if (finished) return; finished = true;
    clearTimeout(timer); abort.abort();
    try {await reader?.cancel();} catch {}
    await release();
  };
  try {
    const upstream = await fetchImpl('https://api.boson.ai/v1/audio/speech', {
      method: 'POST', headers: {Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
      // Workers supports manual/follow, not the Node-only redirect:error option.
      // Manual keeps provider credentials on the fixed origin; all3xx fail below.
      body: JSON.stringify(payload), redirect: 'manual', signal: active,
    });
    const reject = async (code, status = 502) => {await upstream.body?.cancel(); fail(code, status);};
    if (upstream.status !== 200) await reject(upstream.status === 429 ? 'speech_provider_rate_limited' : 'speech_provider_unavailable', [401,403].includes(upstream.status) ? 503 : upstream.status === 429 ? 429 : 502);
    if (!['audio/pcm', 'application/octet-stream'].includes((upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase())) await reject('unsupported_speech_format');
    for (const [header, value] of [['x-audio-sample-rate','24000'],['x-audio-channels','1'],['x-audio-format','pcm_s16le']]) {
      if (upstream.headers.has(header) && upstream.headers.get(header) !== value) await reject('invalid_speech_metadata');
    }
    const length = upstream.headers.get('content-length');
    if (length !== null) {
      if (!/^\d+$/.test(length) || Number(length) < 2 || Number(length) > MAX_AUDIO || Number(length) % 2) await reject('invalid_speech_length');
      expected = Number(length);
    }
    if (!upstream.body) fail('empty_speech_audio', 502);
    reader = upstream.body.getReader();
    async function next() {
      while (true) {
        active.throwIfAborted();
        const {done, value} = await reader.read();
        if (done) {
          if (!total || pending.length || (expected !== undefined && total !== expected)) fail('incomplete_speech_audio', 502);
          return null;
        }
        total += value.byteLength;
        if (total > MAX_AUDIO) fail('speech_stream_limit', 502);
        const joined = new Uint8Array(pending.length + value.length);
        joined.set(pending); joined.set(value, pending.length);
        const end = joined.length - joined.length % 2;
        pending = joined.slice(end);
        if (end) return joined.slice(0, end);
      }
    }
    // No HTTP 200 until at least a full sample has been received and validated.
    const first = await next();
    if (!first) fail('empty_speech_audio', 502);
    let initial = first;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (initial) {controller.enqueue(initial); initial = null; return;}
          const chunk = await next();
          if (chunk) controller.enqueue(chunk);
          else {controller.close(); await cleanup();}
        } catch {controller.error(new Error('speech_stream_interrupted')); await cleanup();}
      },
      async cancel() {await cleanup();},
    });
    return new Response(stream, {headers: {'Content-Type':'audio/pcm','X-Audio-Format':'pcm_s16le','X-Audio-Sample-Rate':'24000','X-Audio-Channels':'1','Cache-Control':'no-store'}});
  } catch (error) {
    await cleanup();
    if (error.status) throw error;
    console.error(JSON.stringify({type:'speech_transport_error',name:error.name,message:String(error.message).replaceAll(apiKey,'[redacted]').slice(0,200)}));
    fail('speech_connection_failed', 502);
  }
}
