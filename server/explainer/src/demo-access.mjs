import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fail } from './contracts.mjs';

const kinds = ['generation', 'planner', 'speech'];
const day = (now) => new Date(now).toISOString().slice(0, 10);
const empty = (now) => ({ version: 1, day: day(now), counts: { generation: 0, planner: 0, speech: 0 } });
function cap(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1) throw Error('Invalid demo limit configuration');
  return n;
}

// One Node process / one replica owns this ledger. It stores counts only, never
// credentials, transcripts or request bodies. Every reservation is flushed before
// work begins; failed/cancelled requests consume budget to bound provider spend.
export class DemoUsage {
  constructor(path, limits, { now = Date.now } = {}) {
    if (!path || !isAbsolute(path)) throw Error('Public demo requires an absolute DEMO_USAGE_PATH on persistent storage');
    this.path = path; this.limits = limits; this.now = now; this.failed = false;
    try {
      let value;
      try { value = this.read(); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        value = empty(this.now());
      }
      this.save(value);
    } catch { fail('demo_usage_unavailable', 503); }
  }
  read() {
    const value = JSON.parse(readFileSync(this.path, 'utf8'));
    if (value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !value.counts ||
        kinds.some(k => !Number.isSafeInteger(value.counts[k]) || value.counts[k] < 0)) throw Error('Invalid usage ledger');
    // A future ledger is not silently reset after a system clock correction.
    if (value.day > day(this.now())) throw Error('Usage ledger date is in the future');
    return value.day === day(this.now()) ? value : empty(this.now());
  }
  save(value) {
    const temporary = this.path + '.' + randomBytes(8).toString('hex') + '.tmp';
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch {}
    }
  }
  charge(kind, amount = 1) {
    if (this.failed) fail('demo_usage_unavailable', 503);
    let value;
    try { value = this.read(); } catch { this.failed = true; fail('demo_usage_unavailable', 503); }
    if (!kinds.includes(kind) || !Number.isSafeInteger(amount) || amount < 1) throw Error('Invalid quota reservation');
    if (amount > this.limits[kind] - value.counts[kind]) fail(`demo_${kind}_limit`, 429);
    value.counts[kind] += amount;
    try { this.save(value); } catch { this.failed = true; fail('demo_usage_unavailable', 503); }
  }
}
export function demoConfiguration(env = process.env) {
  const enabled = env.PUBLIC_DEMO_ENABLED === 'true';
  return {
    enabled,
    usage: enabled ? new DemoUsage(env.DEMO_USAGE_PATH, {
      generation: cap(env.DEMO_DAILY_GENERATIONS, 40),
      planner: cap(env.DEMO_DAILY_PLANNER_TURNS, 300),
      speech: cap(env.DEMO_DAILY_SPEECH_CHARACTERS, 100000),
    }) : null,
    maxJobs: enabled ? 6 : 30,
    maxPending: cap(env.MAX_PENDING_JOBS, 12),
  };
}
export class VoiceSessions {
  constructor({ ttl = 20 * 60 * 1000, max = 100, now = Date.now } = {}) {
    this.ttl = ttl; this.max = max; this.now = now; this.sessions = new Map();
  }
  prune() { for (const [token, s] of this.sessions) if (s.expires <= this.now()) this.sessions.delete(token); }
  create() {
    this.prune();
    if (this.sessions.size >= this.max) fail('voice_session_capacity', 429);
    const token = randomBytes(32).toString('hex'), expires = this.now() + this.ttl;
    this.sessions.set(token, { expires, requests: [] });
    return { token, expires_at: new Date(expires).toISOString() };
  }
  authorize(token, app) {
    this.prune();
    const s = this.sessions.get(token);
    if (!s || app !== 'genius-rookie') fail('unauthorized', 401);
    s.requests = s.requests.filter(at => at > this.now() - 60000);
    if (s.requests.length >= 30) fail('speech_rate_limited', 429);
    s.requests.push(this.now());
    return s;
  }
}
