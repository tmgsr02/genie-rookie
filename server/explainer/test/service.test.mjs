import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ExplainerService } from "../src/service.mjs";
import { fixture, intent } from "./fixtures.mjs";
import { createServer } from "../src/server.mjs";
const planner = {
  async plan() {
    return {
      dialogue: [{ speaker: "genius", text: "What do you notice?" }],
      tools: [],
    };
  },
};
function setup(worker) {
  const service = new ExplainerService({
    planner,
    worker: worker || {
      async author(o) {
        o.onValidating();
        const pkg = fixture("mathematics", {
          scene_id: o.scene_id,
          scene_version: o.scene_version,
        });
        pkg.validation = {
          passed: true,
          checks: [{ name: "test_double_not_browser", passed: true }],
        };
        return { package: pkg, metrics: { generation_ms: 1 } };
      },
    },
  });
  const credentials = service.create();
  return {
    service,
    s: service.session(credentials.session_id, credentials.session_token),
    credentials,
  };
}
const create = (service, s, id = "create1") =>
  service.tool(s, {
    request_id: id,
    name: "create_explainer",
    arguments: { intent },
  });
async function ready(service, s, id = "create1") {
  const job = await create(service, s, id);
  for (
    let n = 0;
    n < 100 && service.getJob(s, job.job_id).status !== "ready";
    n++
  )
    await delay(2);
  return service.getJob(s, job.job_id);
}
const readyEvent = (s, j, id = "ready1") => ({
  session_id: s.session_id,
  scene_id: j.scene_id,
  scene_version: j.scene_version,
  event_id: id,
  kind: "ready",
  state_revision: 0,
  state: { value: 1, result: "1 × 2 = 2", paused: false },
});
test("a generation-only planner turn acknowledges the question without waiting for the scene", async () => {
  const {service, s} = setup();
  service.dispatch = async () => {}; // The real asynchronous job has not finished.
  service.planner = {async plan() { return {dialogue: [], tools: [{name: 'create_explainer', arguments: {intent}}]}; }};
  const response = await service.turn(s, {request_id: 'voice-question', text: 'Why do words rhyme?'});
  assert.ok(response.job_id);
  assert.equal(service.getJob(s, response.job_id).status, 'generating');
  assert.equal(response.dialogue.length, 1);
  assert.equal(response.dialogue[0].speaker, 'genius');
  assert.match(response.dialogue[0].text, /putting.*together/i);
  assert.deepEqual(await service.turn(s, {request_id: 'voice-question', text: 'Why do words rhyme?'}), response);
  assert.equal(s.jobs.size, 1);
});
test("generation acknowledgement preserves the planner's own spoken answer", async () => {
  const {service, s} = setup();
  service.dispatch = async () => {};
  const dialogue = [{speaker: 'rookie', text: 'Which endings sound alike?'}];
  service.planner = {async plan() { return {dialogue, tools: [{name: 'create_explainer', arguments: {intent}}]}; }};
  const response = await service.turn(s, {request_id: 'spoken-answer', text: 'Why do words rhyme?'});
  assert.deepEqual(response.dialogue, dialogue);
});
test("prompt job lifecycle and provenance cache", async () => {
  const { service, s } = setup();
  const j = await ready(service, s);
  assert.equal(j.status, "ready");
  assert.deepEqual(
    s.events.map((e) => e.status),
    ["requested", "generating", "validating", "ready"],
  );
  const cached = await ready(service, s, "create2");
  assert.equal(cached.package.provenance, "cache");
  assert.equal(cached.metrics.cost_usd, 0);
});
test("auth and session isolation", () => {
  const { service, s } = setup();
  assert.throws(() => service.session(s.session_id, "bad"), /unauthorized/);
  const other = service.create();
  assert.throws(
    () =>
      service.getJob(
        service.session(other.session_id, other.session_token),
        "unknown",
      ),
    /job_not_found/,
  );
});
test("idempotent retries and conflicting reuse", async () => {
  const { service, s } = setup();
  const a = await create(service, s),
    b = await create(service, s);
  assert.equal(a.job_id, b.job_id);
  await assert.rejects(
    service.tool(s, {
      request_id: "create1",
      name: "get_explainer_state",
      arguments: {},
    }),
    /idempotency_conflict/,
  );
});
test("stale and bounded actions, exact ack, failed revision keeps active scene", async () => {
  const { service, s } = setup();
  const j = await ready(service, s);
  await service.sceneEvent(s, readyEvent(s, j));
  const original = s.active;
  const args = {
    scene_id: j.scene_id,
    scene_version: 1,
    expected_state_revision: 0,
    name: "change",
    input: { value: 4 },
  };
  const command = await service.tool(s, {
    request_id: "control1",
    name: "control_explainer",
    arguments: args,
  });
  assert.equal(command.commands.length, 1);
  await assert.rejects(
    service.tool(s, {
      request_id: "badbound",
      name: "control_explainer",
      arguments: { ...args, input: { value: 1000 } },
    }),
    /Invalid request/,
  );
  const event = {
    ...readyEvent(s, j, "apply1"),
    kind: "action_applied",
    request_id: "control1",
    state_revision: 1,
    state: { value: 4, result: "4 × 2 = 8", paused: false },
  };
  await service.sceneEvent(s, event);
  await service.sceneEvent(s, {
    ...event,
    event_id: "changed1",
    kind: "state_changed",
  });
  await assert.rejects(
    service.tool(s, {
      request_id: "stale1",
      name: "control_explainer",
      arguments: args,
    }),
    /stale_state/,
  );
  service.worker = {
    async author() {
      throw Error("failed");
    },
  };
  const revision = await service.tool(s, {
    request_id: "revise1",
    name: "revise_explainer",
    arguments: {
      scene_id: j.scene_id,
      scene_version: 1,
      intent: { ...intent, concept: "Different" },
    },
  });
  await delay(10);
  assert.equal(service.getJob(s, revision.job_id).status, "failed");
  assert.equal(s.active, original);
});
test("cancellation suppresses late worker and cache", async () => {
  let release;
  const { service, s } = setup({
    author(o) {
      return new Promise((resolve) => {
        release = () =>
          resolve({
            package: {
              ...fixture("science", {
                scene_id: o.scene_id,
                scene_version: o.scene_version,
              }),
              validation: { passed: true },
            },
            metrics: {},
          });
      });
    },
  });
  const j = await create(service, s);
  await delay(0);
  await service.tool(s, {
    request_id: "cancel",
    name: "cancel_generation",
    arguments: { job_id: j.job_id },
  });
  release();
  await delay(5);
  assert.equal(service.getJob(s, j.job_id).status, "cancelled");
  assert.equal(service.cache.size, 0);
});
test("HTTP contract authentication and request validation", async (t) => {
  const { service } = setup();
  const server = createServer(service);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const session = await (
    await fetch(base + "/v1/sessions", { method: "POST", body: "{}" })
  ).json();
  assert.ok(session.session_token);
  const bad = await fetch(
    base + "/v1/sessions/" + session.session_id + "/turns",
    {
      method: "POST",
      body: JSON.stringify({ request_id: "x", text: "Question" }),
    },
  );
  assert.equal(bad.status, 401);
  const good = await fetch(
    base + "/v1/sessions/" + session.session_id + "/turns",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + session.session_token },
      body: JSON.stringify({
        request_id: "x",
        text: "Question",
        heard: [{ speaker: "rookie", text: "Let us try." }],
      }),
    },
  );
  assert.equal(good.status, 200);
  assert.equal((await good.json()).dialogue[0].speaker, "genius");
});

test("cancel ready candidate rejects delayed adoption", async () => {
  const { service, s } = setup();
  const job = await ready(service, s);
  await service.tool(s, {
    request_id: "cancelready",
    name: "cancel_generation",
    arguments: { job_id: job.job_id },
  });
  assert.equal(service.getJob(s, job.job_id).status, "cancelled");
  await assert.rejects(
    service.sceneEvent(s, readyEvent(s, job)),
    /stale_scene/,
  );
  assert.equal(s.active, null);
});

test("successive revisions use distinct versions before adoption", async () => {
  const { service, s } = setup();
  const initial = await ready(service, s);
  await service.sceneEvent(s, readyEvent(s, initial));
  const args = { scene_id: initial.scene_id, scene_version: 1, intent };
  const a = await service.tool(s, {
    request_id: "rev_a",
    name: "revise_explainer",
    arguments: args,
  });
  await delay(5);
  const b = await service.tool(s, {
    request_id: "rev_b",
    name: "revise_explainer",
    arguments: args,
  });
  await delay(5);
  assert.equal(a.scene_version, 2);
  assert.equal(b.scene_version, 3);
  await assert.rejects(
    service.sceneEvent(s, readyEvent(s, a, "old_ready")),
    /stale_scene/,
  );
  await service.sceneEvent(s, readyEvent(s, b, "new_ready"));
  assert.equal(s.active.scene_version, 3);
});

test("ack returns before narration and discards narration after state changes", async () => {
  const { service, s } = setup();
  const job = await ready(service, s);
  let finish;
  service.planner = {
    plan() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const ack = await Promise.race([
    service.sceneEvent(s, readyEvent(s, job)),
    delay(100).then(() => {
      throw Error("ack blocked");
    }),
  ]);
  assert.deepEqual(ack.dialogue, []);
  const touch = {
    ...readyEvent(s, job, "touch_event"),
    kind: "action_applied",
    request_id: "touch_1",
    state_revision: 1,
    state: { value: 2, result: "2 × 2 = 4", paused: false },
  };
  await service.sceneEvent(s, touch);
  await service.sceneEvent(s, {
    ...touch,
    event_id: "observed",
    kind: "state_changed",
    state: { paused: false, result: "2 × 2 = 4", value: 2 },
  });
  finish({ dialogue: [{ speaker: "genius", text: "Outdated" }] });
  await delay(1);
  assert.equal(
    s.events.some((event) => event.type === "dialogue"),
    false,
  );
  await assert.rejects(
    service.sceneEvent(s, { ...touch, state_revision: 2 }),
    /event_id_conflict/,
  );
});

test("planner result based on no scene is stale after a ready scene arrives", async () => {
  const { service, s } = setup();
  const job = await ready(service, s);
  let finish;
  service.planner = {
    plan() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const pending = service.turn(s, {
    request_id: "old_plan",
    text: "A new question",
  });
  await delay(0);
  service.planner = planner;
  await service.sceneEvent(s, readyEvent(s, job));
  finish({ dialogue: [], tools: [] });
  await assert.rejects(pending, /stale_plan/);
});

const flushNarration = () => new Promise(resolve => setImmediate(resolve));
function delayedNarrator(service) {
  const calls=[];
  service.planner={plan(session,event){return new Promise((resolve,reject)=>calls.push({event,ack:structuredClone(session.acknowledged),resolve,reject}));}};
  return calls;
}
async function touchAndComplete(service,s,job,revision) {
  const changed={...readyEvent(s,job,'touch_'+revision),kind:'action_applied',request_id:'touch_'+revision,state_revision:revision,state:{value:revision+1,result:`${revision+1} × 2 = ${(revision+1)*2}`,paused:false}};
  await service.sceneEvent(s,changed);
  return service.sceneEvent(s,{...changed,event_id:'completed_'+revision,kind:'interaction_completed'});
}
test('rapid eligible state changes coalesce to the latest acknowledged revision exactly once',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();
  await touchAndComplete(service,s,job,1);await touchAndComplete(service,s,job,2);await touchAndComplete(service,s,job,3);
  assert.equal(calls.length,1);
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Obsolete initial state'}]});await flushNarration();
  assert.equal(calls.length,2);assert.equal(calls[1].ack.state_revision,3);assert.equal(calls[1].event.state.value,4);
  calls[1].resolve({dialogue:[{speaker:'genius',text:'Four doubled is eight'}]});await flushNarration();
  const dialogue=s.events.filter(e=>e.type==='dialogue');assert.equal(dialogue.length,1);assert.equal(dialogue[0].basis.state_revision,3);
  await service.sceneEvent(s,{...readyEvent(s,job,'another_completion'),kind:'interaction_completed',state_revision:3,state:{value:4,result:'4 × 2 = 8',paused:false}});
  await flushNarration();assert.equal(calls.length,2);assert.equal(s.narrating,false);
});
test('planner rejection releases the active slot and still narrates a queued latest state',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await touchAndComplete(service,s,job,1);
  calls[0].reject(Error('provider_failure'));await flushNarration();assert.equal(calls.length,2);
  calls[1].resolve({dialogue:[{speaker:'rookie',text:'Now there are four'}]});await flushNarration();
  assert.equal(s.events.filter(e=>e.type==='dialogue').length,1);assert.equal(s.narrating,false);
  await flushNarration();assert.equal(calls.length,2);
});
test('replacing the scene discards queued old work and narrates only the newly acknowledged scene',async()=>{
  const {service,s}=setup(),first=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,first));await flushNarration();await touchAndComplete(service,s,first,1);
  const next=await ready(service,s,'next_scene');await service.sceneEvent(s,readyEvent(s,next,'next_ready'));
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Old scene'}]});await flushNarration();
  assert.equal(calls.length,2);assert.equal(calls[1].ack.state_revision,0);
  calls[1].resolve({dialogue:[{speaker:'genius',text:'New scene'}]});await flushNarration();
  const dialogue=s.events.filter(e=>e.type==='dialogue');assert.equal(dialogue.length,1);assert.equal(dialogue[0].basis.scene_id,next.scene_id);
});
test('expired sessions cannot restart queued narration or emit in-flight dialogue',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await touchAndComplete(service,s,job,1);
  s.expires=Date.now()-1;service.prune();calls[0].resolve({dialogue:[{speaker:'genius',text:'Expired'}]});await flushNarration();
  assert.equal(calls.length,1);assert.equal(s.narrating,false);assert.equal(s.events.filter(e=>e.type==='dialogue').length,0);
});
test('awaitNarration waits for the coalesced result and snapshots exclude transient queued work',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);service.awaitNarration=true;
  let readyReturned=false,completionReturned=false;
  const initial=service.sceneEvent(s,readyEvent(s,job)).then(()=>{readyReturned=true;});await flushNarration();
  const completion=touchAndComplete(service,s,job,1).then(()=>{completionReturned=true;});await flushNarration();
  assert.equal(readyReturned,false);assert.equal(completionReturned,false);
  const snapshot=JSON.parse(JSON.stringify(service.snapshot())).sessions[0];
  for(const key of ['pendingNarration','narrationPromise','narrationBasis','narrating'])assert.equal(Object.hasOwn(snapshot,key),false);
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Stale'}]});await flushNarration();assert.equal(calls.length,2);
  calls[1].resolve({dialogue:[{speaker:'genius',text:'Latest'}]});await Promise.all([initial,completion]);
  assert.equal(readyReturned,true);assert.equal(completionReturned,true);assert.equal(s.narrating,false);
});

test('a later ineligible state makes queued narration stale without creating replacement narration',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await touchAndComplete(service,s,job,1);
  await service.sceneEvent(s,{...readyEvent(s,job,'non_teaching_change'),kind:'action_applied',request_id:'touch_2',state_revision:2,state:{value:3,result:'3 × 2 = 6',paused:false}});
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Outdated'}]});await flushNarration();
  assert.equal(calls.length,1);assert.equal(s.narrating,false);assert.equal(s.pendingNarration,null);assert.equal(s.events.filter(e=>e.type==='dialogue').length,0);
});
test('restoring a session drops transient narration and old in-flight work cannot publish into it',async()=>{
  const {service,s,credentials}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await touchAndComplete(service,s,job,1);
  service.restore(JSON.parse(JSON.stringify(service.snapshot())));
  const restored=service.session(credentials.session_id,credentials.session_token);
  assert.equal(restored.narrating,false);assert.equal(restored.pendingNarration,null);assert.equal(restored.narrationPromise,null);
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Old process'}]});await flushNarration();
  assert.equal(calls.length,1);assert.equal(restored.events.filter(e=>e.type==='dialogue').length,0);
});
test('planner quota failures clear narration without an automatic retry loop',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);let charges=0;
  service.usage={charge:async()=>{charges++;throw Error('quota');}};
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await flushNarration();
  assert.equal(charges,1);assert.equal(calls.length,0);assert.equal(s.narrating,false);assert.equal(s.pendingNarration,null);
});
test('cancelling an unadopted replacement preserves narration for the still-active acknowledged scene',async()=>{
  const {service,s}=setup(),job=await ready(service,s),calls=delayedNarrator(service);
  await service.sceneEvent(s,readyEvent(s,job));await flushNarration();await touchAndComplete(service,s,job,1);
  const replacement=await ready(service,s,'replacement_to_cancel');
  await service.tool(s,{request_id:'cancel_replacement',name:'cancel_generation',arguments:{job_id:replacement.job_id}});
  calls[0].resolve({dialogue:[{speaker:'genius',text:'Old state'}]});await flushNarration();assert.equal(calls.length,2);
  calls[1].resolve({dialogue:[{speaker:'genius',text:'Current scene is still here'}]});await flushNarration();
  const dialogue=s.events.filter(e=>e.type==='dialogue');assert.equal(dialogue.length,1);assert.equal(dialogue[0].basis.scene_id,job.scene_id);assert.equal(dialogue[0].basis.state_revision,1);
});
