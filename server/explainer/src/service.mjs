import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  assertSchema,
  toolSchemas,
  toolEnvelope,
  turnSchema,
  eventSchema,
  fail,
  object,
  id,
} from "./contracts.mjs";
import { fingerprint } from "./package.mjs";
const generationDialogueSchema = object({
  request_id: id, job_id: id, phase: {enum: ["waiting", "failed"]},
  heard: turnSchema.properties.heard,
}, ["request_id", "job_id", "phase"]);
const pendingStatuses = ["requested", "generating", "validating", "revising"];
const recoveryDialogue = [
  {speaker: "rookie", text: "Our picture didn’t quite come together. I’m still curious, though!"},
  {speaker: "genius", text: "Me too. We can talk it through in words, or try making the picture again. What would you like?"},
];
const clone = (v) => structuredClone(v);
const publicJob = (j) => ({
  job_id: j.job_id,
  status: j.status,
  scene_id: j.scene_id,
  scene_version: j.scene_version,
  ...(j.status === "ready" ? { package: j.package } : {}),
  ...(j.error ? { error: j.error } : {}),
  ...(j.progress ? {progress:j.progress} : {}),
  metrics: j.metrics || {},
});
export class ExplainerService {
  constructor({ worker, planner, maxConcurrent = 2, ttl = 3600000, usage = null, maxJobs = 30, maxPending = 12, persist = null, dispatch = null, cancel = null, awaitNarration = false } = {}) {
    this.persist = persist;
    this.dispatch = dispatch;
    this.cancel = cancel;
    this.awaitNarration = awaitNarration;
    this.usage = usage;
    this.maxJobs = maxJobs;
    this.maxPending = maxPending;
    this.worker = worker;
    this.planner = planner;
    this.sessions = new Map();
    this.cache = new Map();
    this.queue = [];
    this.running = 0;
    this.maxConcurrent = maxConcurrent;
    this.ttl = ttl;
    this.events = new EventEmitter();
  }
  create() {
    this.prune();
    if (this.sessions.size >= 100) fail("session_capacity", 429);
    const session = {
      session_id: randomUUID(),
      session_token: randomBytes(32).toString("hex"),
      expires: Date.now() + this.ttl,
      events: [],
      sequence: 0,
      requests: new Map(),
      jobs: new Map(),
      sceneVersions: new Map(),
      eventIds: new Map(),
      pendingCommands: new Map(),
      active: null,
      acknowledged: null,
      pendingJob: null,
      summary: "",
    };
    this.sessions.set(session.session_id, session);
    return {
      session_id: session.session_id,
      session_token: session.session_token,
      expires_at: new Date(session.expires).toISOString(),
    };
  }
  prune() {
    for (const [id, s] of this.sessions)
      if (s.expires < Date.now()) {
        for (const j of s.jobs.values()) j.abort.abort();
        this.sessions.delete(id);
      }
    for (const [key, item] of this.cache)
      if (item.expires < Date.now()) this.cache.delete(key);
  }
  session(id, token) {
    this.prune();
    const s = this.sessions.get(id);
    if (
      !s ||
      typeof token !== "string" ||
      token.length !== s.session_token.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(s.session_token))
    )
      fail("unauthorized", 401);
    return s;
  }
  emit(s, event) {
    s.events.push({ sequence: ++s.sequence, ...event });
    if (s.events.length > 256) s.events.shift();
    this.events.emit(s.session_id);
  }
  async poll(s, after) {
    if (after > s.sequence) fail("invalid_cursor", 400);
    if (!s.events.some((e) => e.sequence > after)) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.events.off(s.session_id, done);
          resolve();
        };
        const timer = setTimeout(done, 20000);
        this.events.once(s.session_id, done);
      });
    }
    return {
      events: s.events.filter((e) => e.sequence > after),
      cursor: s.sequence,
    };
  }
  async once(s, id, payload, run) {
    const hash = fingerprint(payload),
      old = s.requests.get(id);
    if (old) {
      if (old.hash !== hash) fail("idempotency_conflict");
      return old.promise;
    }
    if (s.requests.size >= 1000) fail("request_limit", 429);
    const record = { hash, status: "pending" };
    record.promise = Promise.resolve().then(async () => {
      await this.persist?.();
      try {
        const value = await run();
        record.status = "complete";
        record.value = value;
        await this.persist?.();
        return value;
      } catch (error) {
        record.status = "failed";
        record.error = { code: error.code || "service_error", status: error.status || 500 };
        await this.persist?.();
        throw error;
      }
    });
    s.requests.set(id, record);
    return record.promise;
  }
  getJob(s, id) {
    const job = s.jobs.get(id);
    if (!job) fail("job_not_found", 404);
    return publicJob(job);
  }
  async tool(s, envelope) {
    assertSchema(toolEnvelope, envelope);
    assertSchema(toolSchemas[envelope.name], envelope.arguments);
    return this.once(s, envelope.request_id, envelope, () =>
      this.execute(s, envelope),
    );
  }
  async execute(s, { request_id, name, arguments: a }) {
    if (name === "get_generation_status") return this.getJob(s, a.job_id);
    if (name === "get_explainer_state")
      return {
        scene_id: s.active?.scene_id || null,
        scene_version: s.active?.scene_version || null,
        ...(s.acknowledged || {}),
        manifest: s.active?.manifest || null,
      };
    if (name === "cancel_generation") {
      const job = s.jobs.get(a.job_id);
      if (!job) fail("job_not_found", 404);
      const adopted =
        s.active?.scene_id === job.scene_id &&
        s.active?.scene_version === job.scene_version;
      if (!["failed", "cancelled"].includes(job.status) && !adopted) {
        job.abort.abort();
        this.transition(s, job, "cancelled");
        if (this.cancel) await this.cancel(s, job);
      }
      return publicJob(job);
    }
    if (name === "control_explainer") {
      this.current(s, a);
      if (
        !s.acknowledged ||
        a.expected_state_revision !== s.acknowledged.state_revision
      )
        fail("stale_state");
      const c = s.active.manifest.controls.find((c) => c.name === a.name);
      if (!c) fail("unknown_control", 400);
      assertSchema(c.input_schema, a.input);
      const command = { session_id: s.session_id, request_id, ...a };
      s.pendingCommands.set(request_id, command);
      return { commands: [command] };
    }
    if (name === "revise_explainer") this.current(s, a);
    if (s.jobs.size >= this.maxJobs) fail("job_limit", 429);
    this.queue = this.queue.filter(({ job }) => !job.abort.signal.aborted);
    if (this.queue.length >= this.maxPending) fail("queue_capacity", 429);
    const charge = this.usage?.charge("generation");
    if (charge && typeof charge.then === "function") await charge;
    if (
      s.pendingJob &&
      !["ready", "failed", "cancelled"].includes(s.pendingJob.status)
    ) {
      s.pendingJob.abort.abort();
      this.transition(s, s.pendingJob, "cancelled");
      if (this.cancel) await this.cancel(s, s.pendingJob);
    }
    const intent = clone(a.intent);
    for (const k of ["learning_goal", "concept", "interaction"])
      intent[k] = intent[k]
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[private]")
        .replace(/https?:\/\/\S+/g, "[link omitted]")
        .replace(/\b\+?[0-9][0-9 ()-]{7,}[0-9]\b/g, "[private]");
    const job = {
      job_id: randomUUID(),
      scene_id: name === "revise_explainer" ? a.scene_id : randomUUID(),
      scene_version:
        name === "revise_explainer"
          ? Math.max(a.scene_version, s.sceneVersions.get(a.scene_id) || 0) + 1
          : 1,
      status: "requested",
      intent,
      previous: name === "revise_explainer" ? s.active : null,
      abort: new AbortController(),
      requested_at: Date.now(),
    };
    s.sceneVersions.set(job.scene_id, job.scene_version);
    s.jobs.set(job.job_id, job);
    s.pendingJob = job;
    this.transition(
      s,
      job,
      name === "revise_explainer" ? "revising" : "requested",
    );
    this.queue.push({ s, job });
    if (this.dispatch) {
      await this.persist?.();
      await this.dispatchJob(s, job);
    } else queueMicrotask(() => this.drain());
    return publicJob(job);
  }
  async dispatchJob(s, job) {
    if (job.abort.signal.aborted || ["ready", "failed", "cancelled"].includes(job.status)) return;
    const request = {
      intent: job.intent,
      previous: job.previous,
      scene_id: job.scene_id,
      scene_version: job.scene_version,
    };
    try {
      await this.dispatch(s, job, request);
      if (["requested", "revising"].includes(job.status)) this.transition(s, job, "generating");
      await this.persist?.();
    } catch {
      this.complete(s, job.job_id, { error: "generation_failed" });
      await this.persist?.();
    }
  }
  complete(s, id, { result, error } = {}) {
    const job = s.jobs.get(id);
    if (!job) fail("job_not_found", 404);
    if (["ready", "failed", "cancelled"].includes(job.status)) return publicJob(job);
    if (job.abort.signal.aborted || s.pendingJob !== job) {
      this.transition(s, job, "cancelled");
    } else if (error || !result?.package?.validation?.passed ||
      result.package.scene_id !== job.scene_id || result.package.scene_version !== job.scene_version) {
      job.error = "generation_failed";
      this.transition(s, job, "failed");
    } else {
      job.package = result.package;
      job.metrics = { ...result.metrics, total_ms: Date.now() - job.requested_at };
      this.transition(s, job, "ready");
    }
    this.queue = this.queue.filter(({ job: pending }) => pending !== job);
    return publicJob(job);
  }
  snapshot() {
    return {
      version: 1,
      sessions: [...this.sessions.values()].map((s) => {
        const { requests, jobs, sceneVersions, eventIds, pendingCommands, pendingJob, planning, narrating, pendingNarration, narrationBasis, narrationPromise, ...rest } = s;
        return {
          ...rest,
          pendingJob_id: pendingJob?.job_id || null,
          jobs: [...jobs.values()].map(({ abort, ...job }) => ({ ...job, aborted: abort.signal.aborted })),
          requests: [...requests].map(([id, { hash, status, value, error }]) => [id, { hash, status: status || "pending", value, error }]),
          sceneVersions: [...sceneVersions], eventIds: [...eventIds], pendingCommands: [...pendingCommands],
        };
      }),
    };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.sessions)) throw Error("invalid_session_snapshot");
    this.sessions.clear(); this.queue = []; this.cache.clear(); this.running = 0;
    for (const saved of snapshot.sessions) {
      const { pendingJob_id, jobs, requests, sceneVersions, eventIds, pendingCommands, ...rest } = saved;
      const s = { ...rest, planning: false, narrating: false, pendingNarration: null, narrationBasis: null, narrationPromise: null,
        jobs: new Map(), requests: new Map(), sceneVersions: new Map(sceneVersions),
        eventIds: new Map(eventIds), pendingCommands: new Map(pendingCommands), pendingJob: null };
      for (const { aborted, ...job } of jobs) {
        job.abort = new AbortController(); if (aborted) job.abort.abort();
        s.jobs.set(job.job_id, job);
        if (!aborted && !["ready", "failed", "cancelled"].includes(job.status)) this.queue.push({ s, job });
      }
      s.pendingJob = s.jobs.get(pendingJob_id) || null;
      for (const [id, savedRequest] of requests) {
        const record = { ...savedRequest };
        if (record.status === "complete") record.promise = Promise.resolve(record.value);
        else {
          if (record.status !== "failed") record.error = { code: "interrupted_request", status: 409 };
          record.status = "failed";
          record.promise = Promise.reject(Object.assign(Error(record.error.code), record.error));
          record.promise.catch(() => {});
        }
        s.requests.set(id, record);
      }
      this.sessions.set(s.session_id, s);
    }
    this.prune();
  }
  current(s, a) {
    if (
      !s.active ||
      a.scene_id !== s.active.scene_id ||
      a.scene_version !== s.active.scene_version
    )
      fail("stale_scene");
  }
  progress(s,j,{phase,elapsed_ms}) {
    if(!['preparing','authoring','checking','publishing'].includes(phase)||!Number.isSafeInteger(elapsed_ms)||elapsed_ms<0)fail('invalid_progress',400);
    if(['ready','failed','cancelled'].includes(j.status)||s.pendingJob!==j)return;
    j.progress={phase,elapsed_ms};
    this.emit(s,{type:'generation',job_id:j.job_id,status:j.status,scene_id:j.scene_id,scene_version:j.scene_version,progress:j.progress});
  }
  transition(s, j, status) {
    j.status = status;
    if(['ready','failed','cancelled'].includes(status))delete j.progress;
    this.emit(s, {
      type: "generation",
      job_id: j.job_id,
      status,
      scene_id: j.scene_id,
      scene_version: j.scene_version,
      ...(j.error ? { error: j.error } : {}),
    });
  }
  drain() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const task = this.queue.shift();
      if (task.job.abort.signal.aborted) continue;
      this.running++;
      this.run(task.s, task.job).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }
  async run(s, j) {
    try {
      this.transition(s, j, "generating");
      const key = fingerprint({
        intent: j.intent,
        previous: j.previous?.manifest || null,
        previous_files: j.previous?.files || null,
      });
      const hit = this.cache.get(key);
      let result;
      if (hit && hit.expires > Date.now()) {
        result = clone(hit.result);
        result.package.scene_id = j.scene_id;
        result.package.scene_version = j.scene_version;
        result.package.provenance = "cache";
        result.metrics = {
          retrieval_ms: Date.now() - j.requested_at,
          cost_usd: 0,
        };
      } else {
        result = await this.worker.author({
          intent: j.intent,
          previous: j.previous,
          scene_id: j.scene_id,
          scene_version: j.scene_version,
          signal: j.abort.signal,
          onValidating: () => {
            if (!j.abort.signal.aborted) this.transition(s, j, "validating");
          },
        });
        if (!result.package.validation?.passed)
          throw Error("validation_failed");
        if (!j.abort.signal.aborted) {
          if (this.cache.size >= 32)
            this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, {
            result: clone(result),
            expires: Date.now() + 3600000,
          });
        }
      }
      if (
        j.abort.signal.aborted ||
        s.pendingJob !== j ||
        !this.sessions.has(s.session_id)
      )
        return;
      j.package = result.package;
      j.metrics = { ...result.metrics, total_ms: Date.now() - j.requested_at };
      this.transition(s, j, "ready");
    } catch (error) {
      if (j.abort.signal.aborted) return;
      j.error =
        error.code === "provider_not_configured"
          ? "provider_not_configured"
          : "generation_failed";
      j.metrics = { total_ms: Date.now() - j.requested_at };
      this.transition(s, j, "failed");
    }
  }
  async generationDialogue(s, input) {
    assertSchema(generationDialogueSchema, input);
    return this.once(s, input.request_id, input, async () => {
      const job = s.pendingJob;
      const turn = s.conversationTurn || 0;
      const failed = input.phase === "failed";
      const eligible = () => s.pendingJob === job && job?.job_id === input.job_id &&
        (failed ? job.status === "failed" : pendingStatuses.includes(job.status)) &&
        (s.conversationTurn || 0) === turn && !s.planning;
      if (!eligible()) return {dialogue: []};
      if (failed ? job.failureSpoken : (job.conversationRounds || 0) >= 8 ||
          Date.now() - (job.conversationAt || 0) < 12000) return {dialogue: []};
      // Persist the reservation before provider I/O; a restart must not repeat a round.
      if (failed) job.failureSpoken = true;
      else {
        job.conversationRounds = (job.conversationRounds || 0) + 1;
        job.conversationAt = Date.now();
      }
      await this.persist?.();
      const basis = s.active && s.acknowledged ? {
        scene_id: s.active.scene_id, scene_version: s.active.scene_version,
        state_revision: s.acknowledged.state_revision,
      } : null;
      let dialogue;
      try {
        await this.usage?.charge("planner");
        const result = await this.planner.plan(s, "", {generation: input.phase, heard: input.heard || []});
        dialogue = result.dialogue;
        if (!dialogue?.length) dialogue = failed ? clone(recoveryDialogue) : [];
      } catch {
        // Optional banter must never break a visual or retry indefinitely.
        dialogue = failed ? clone(recoveryDialogue) : [];
      }
      const currentBasis = s.active && s.acknowledged ? {
        scene_id: s.active.scene_id, scene_version: s.active.scene_version,
        state_revision: s.acknowledged.state_revision,
      } : null;
      if (!eligible() || fingerprint(basis) !== fingerprint(currentBasis)) return {dialogue: []};
      return {job_id: job.job_id, dialogue, ...(basis ? {basis} : {})};
    });
  }
  async turn(s, input) {
    assertSchema(turnSchema, input);
    return this.once(s, input.request_id, input, async () => {
      if (s.planning) fail("turn_in_progress");
      s.conversationTurn = (s.conversationTurn || 0) + 1;
      s.planning = true;
      try {
        await this.usage?.charge("planner");
        const basis = s.acknowledged
          ? {
              scene_id: s.active.scene_id,
              scene_version: s.active.scene_version,
              state_revision: s.acknowledged.state_revision,
            }
          : null;
        const result = await this.planner.plan(s, input.text, {
          heard: input.heard || [],
        });
        if (!basis && s.active) fail("stale_plan");
        if (
          basis &&
          (!s.active ||
            basis.scene_id !== s.active.scene_id ||
            basis.scene_version !== s.active.scene_version ||
            basis.state_revision !== s.acknowledged?.state_revision)
        )
          fail("stale_plan");
        const response = {
          session_id: s.session_id,
          request_id: input.request_id,
          dialogue: result.dialogue,
          commands: [],
          metrics: {
            planner_usage: result.usage || null,
            planner_cost_usd: null,
            planner_cost_basis: "provider_usage_without_price_configuration",
          },
          ...(basis ? { basis } : {}),
        };
        for (const [i, call] of result.tools.entries()) {
          const value = await this.tool(s, {
            request_id: fingerprint(input.request_id).slice(0, 64) + "_" + i,
            ...call,
          });
          if (value.job_id) response.job_id = value.job_id;
          // Function-call-only planner responses contain no dialogue. Acknowledge
          // accepted work immediately instead of leaving voice users in silence.
          if (["create_explainer", "revise_explainer"].includes(call.name) &&
              ["requested", "generating", "validating", "revising"].includes(value.status) &&
              !response.dialogue.length) {
            response.dialogue = [{speaker: "genius", text: "Let’s explore that. I’m putting an explanation together for you."}];
          }
          if (value.commands) response.commands.push(...value.commands);
        }
        if (response.commands.length) response.dialogue = [];
        if (result.context_summary) s.summary = result.context_summary;
        return response;
      } finally {
        s.planning = false;
      }
    });
  }
  async sceneEvent(s, event) {
    assertSchema(eventSchema, event);
    if (event.session_id !== s.session_id) fail("wrong_session");
    if (s.eventIds.has(event.event_id)) {
      if (s.eventIds.get(event.event_id) !== fingerprint(event))
        fail("event_id_conflict");
      return { dialogue: [] };
    }
    if (Buffer.byteLength(JSON.stringify(event.state)) > 32768)
      fail("state_too_large", 400);
    if (event.kind === "ready") {
      const j = s.pendingJob;
      if (
        !j ||
        j.status !== "ready" ||
        j.scene_id !== event.scene_id ||
        j.scene_version !== event.scene_version
      )
        fail("stale_scene");
      if (
        s.active?.scene_id === event.scene_id &&
        s.active?.scene_version === event.scene_version
      )
        fail("already_ready");
      if (event.state_revision !== 0) fail("invalid_initial_revision");
      assertSchema(j.package.manifest.state_schema, event.state);
      s.active = j.package;
      s.acknowledged = { state_revision: 0, state: event.state };
      s.pendingCommands.clear();
      s.summary = j.package.manifest.learning_goal;
    } else {
      this.current(s, event);
      assertSchema(s.active.manifest.state_schema, event.state);
      const previous = s.acknowledged;
      if (!previous) fail("not_ready");
      if (event.kind === "action_applied" || event.kind === "state_changed") {
        if (
          event.state_revision === previous.state_revision &&
          fingerprint(event.state) === fingerprint(previous.state)
        ) {
          s.eventIds.set(event.event_id, fingerprint(event));
          return { dialogue: [] };
        }
        if (event.state_revision !== previous.state_revision + 1)
          fail("stale_state");
        if (
          event.request_id &&
          !event.request_id.startsWith("touch_") &&
          !s.pendingCommands.has(event.request_id)
        )
          fail("unknown_action");
        s.acknowledged = {
          state_revision: event.state_revision,
          state: event.state,
        };
        if (event.request_id) s.pendingCommands.delete(event.request_id);
      } else if (
        event.state_revision !== previous.state_revision ||
        fingerprint(event.state) !== fingerprint(previous.state)
      )
        fail("stale_state");
    }
    s.eventIds.set(event.event_id, fingerprint(event));
    if (s.eventIds.size > 2000)
      s.eventIds.delete(s.eventIds.keys().next().value);
    const basis = {
      scene_id: event.scene_id,
      scene_version: event.scene_version,
      state_revision: event.state_revision,
    };
    this.emit(s, { type: "scene_state", ...basis });
    const voiceAck =
      event.kind === "action_applied" &&
      event.request_id &&
      !event.request_id.startsWith("touch_");
    if (!voiceAck && !["ready", "interaction_completed"].includes(event.kind))
      return { dialogue: [], basis };
    // One pending snapshot, replaced by the most recent eligible acknowledged
    // event. Repeated completion/ack events for the same revision are one lesson.
    if (!this.sameNarrationBasis(s.narrationBasis, basis) &&
        !this.sameNarrationBasis(s.pendingNarration?.basis, basis) &&
        !this.sameNarrationBasis(s.lastNarratedBasis, basis)) {
      s.pendingNarration = {
        basis, kind: event.kind, state: clone(event.state), request_id: event.request_id,
      };
    }
    if (!s.narrating && s.pendingNarration) {
      s.narrating = true;
      s.narrationPromise = Promise.resolve().then(() => this.drainNarration(s));
    }
    if (this.awaitNarration && s.narrationPromise) await s.narrationPromise;
    return { dialogue: [], basis };
  }
  sameNarrationBasis(a, b) {
    return !!a && !!b && a.scene_id === b.scene_id &&
      a.scene_version === b.scene_version && a.state_revision === b.state_revision;
  }
  narrationCurrent(s, basis) {
    return this.sessions.get(s.session_id) === s && s.expires > Date.now() &&
      s.active?.scene_id === basis.scene_id &&
      s.active?.scene_version === basis.scene_version &&
      s.acknowledged?.state_revision === basis.state_revision;
  }
  async drainNarration(s) {
    try {
      while (s.pendingNarration) {
        const pending = s.pendingNarration;
        s.pendingNarration = null;
        const {basis, kind, state, request_id} = pending;
        if (!this.narrationCurrent(s, basis) || this.sameNarrationBasis(s.lastNarratedBasis, basis)) continue;
        s.narrationBasis = basis;
        try {
          await this.usage?.charge("planner");
          // Charging can yield while another acknowledgement supersedes this one.
          if (!this.narrationCurrent(s, basis)) continue;
          const result = await this.planner.plan(s, {kind, state}, {event: true});
          if (!this.narrationCurrent(s, basis)) continue;
          s.lastNarratedBasis = basis;
          this.emit(s, {
            type: "dialogue", dialogue: result.dialogue, basis,
            metrics: {planner_usage: result.usage || null, planner_cost_usd: null},
            ...(request_id ? {request_id} : {}),
          });
        } catch {
          // A failed request is consumed, never automatically retried. A newer
          // eligible event already in the single pending slot may still proceed.
        } finally {
          s.narrationBasis = null;
        }
      }
    } finally {
      // Clear synchronously with finishing the drain, so an event arriving in a
      // later microtask starts a new drain rather than falling between promises.
      s.narrating = false;
      s.narrationPromise = null;
      s.pendingNarration = null;
    }
  }
}
