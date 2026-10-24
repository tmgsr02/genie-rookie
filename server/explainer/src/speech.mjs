import { once } from 'node:events';
import { fail } from './contracts.mjs';

// Each character's Boson preset, and the emotion its lines are spoken with.
const VOICES = Object.freeze({ genius: 'chloe', rookie: 'marcus' });
const EMOTIONS = Object.freeze({ genius: 'amusement', rookie: 'enthusiasm' });
const MAX_AUDIO = 24000 * 2 * 180;
function payload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'text,voice') fail('invalid_speech_schema', 400);
  if (typeof body.text !== 'string' || !body.text.trim() || [...body.text].length > 2000 ||
      /[\uD800-\uDFFF]/u.test(body.text)) fail('invalid_speech_text', 400);
  if (typeof body.voice !== 'string' || !Object.hasOwn(VOICES, body.voice)) fail('voice_not_permitted', 403);
  return { model: 'higgs-tts-3', input: `<|emotion:${EMOTIONS[body.voice]}|>` + body.text, voice: VOICES[body.voice], stream: true, response_format: 'pcm', normalize: true };
}
export class SpeechGateway {
  constructor({ apiKey, usage = null, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey; this.usage = usage; this.fetch = fetchImpl; this.running = 0;
  }
  get configured() { return !!this.apiKey; }
  ready() {
    if (!this.configured) fail('speech_provider_not_configured', 503);
    return { voices: Object.keys(VOICES), format: 'pcm_s16le', sample_rate: 24000, channels: 1 };
  }
  async stream(req, res, body) {
    this.ready();
    const request = payload(body);
    if (this.running >= 8) fail('speech_capacity', 429);
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    const timeout = setTimeout(() => controller.abort(), 180000); timeout.unref();
    this.running++;
    let reader;
    try {
      if (req.aborted || res.destroyed) fail('speech_connection_failed', 502);
      this.usage?.charge('speech', [...body.text].length);
      const upstream = await this.fetch('https://api.boson.ai/v1/audio/speech', {
        method: 'POST', headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), redirect: 'error', signal: controller.signal,
      });
      if (upstream.status !== 200) {
        await upstream.body?.cancel();
        fail(upstream.status === 429 ? 'speech_provider_rate_limited' : 'speech_provider_unavailable',
          [401, 403].includes(upstream.status) ? 503 : upstream.status === 429 ? 429 : 502);
      }
      const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['audio/pcm', 'application/octet-stream'].includes(mime)) {
        await upstream.body?.cancel(); fail('unsupported_speech_format', 502);
      }
      for (const [header, expected] of [['x-audio-sample-rate', '24000'], ['x-audio-channels', '1'], ['x-audio-format', 'pcm_s16le']]) {
        if (upstream.headers.has(header) && upstream.headers.get(header) !== expected) {
          await upstream.body?.cancel(); fail('invalid_speech_metadata', 502);
        }
      }
      const length = upstream.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) < 2 || Number(length) > MAX_AUDIO || Number(length) % 2)) {
        await upstream.body?.cancel(); fail('invalid_speech_length', 502);
      }
      if (!upstream.body) fail('empty_speech_audio', 502);
      reader = upstream.body.getReader();
      let pending = Buffer.alloc(0), total = 0, started = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_AUDIO) fail('speech_stream_limit', 502);
        const joined = Buffer.concat([pending, Buffer.from(value)]);
        const end = joined.length - joined.length % 2;
        pending = joined.subarray(end);
        if (!end) continue;
        if (!started) {
          // Validate at least one complete PCM sample before committing HTTP 200.
          res.writeHead(200, { 'Content-Type': 'audio/pcm', 'X-Audio-Format': 'pcm_s16le',
            'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'Cache-Control': 'no-store' });
          started = true;
        }
        if (!res.write(joined.subarray(0, end))) await once(res, 'drain', { signal: controller.signal });
      }
      if (!started) fail('empty_speech_audio', 502);
      if (pending.length || (length !== null && total !== Number(length))) fail('incomplete_speech_audio', 502);
      res.end();
    } catch (error) {
      // Once audio has started, destroy the connection without a terminating HTTP
      // chunk. Native clients must see a truncated transport rather than a clean EOF.
      if (res.headersSent) res.destroy();
      else if (error.status) throw error;
      else fail('speech_connection_failed', 502);
    } finally {
      controller.abort();
      try { await reader?.cancel(); } catch {}
      clearTimeout(timeout);
      req.off('aborted', disconnect); res.off('close', disconnect);
      this.running--;
    }
  }
}
