import test from "node:test";
import assert from "node:assert/strict";
import {
  verifiedShellOutput,
  withHostedContainer,
} from "../src/hosted-worker.mjs";
import { HostedWorker } from "../src/hosted-worker.mjs";
import { CodexWorker } from "../src/worker.mjs";
import { createWorker } from "../src/worker-factory.mjs";
import { DescriberWorker } from "../src/describer-worker.mjs";
import { completeAuthoring } from "../src/hosted-worker.mjs";

const command = "node /mnt/data/check.mjs";
function response() {
  return {
    status: "completed",
    output: [
      {
        type: "shell_call",
        call_id: "call_1",
        status: "completed",
        environment: { type: "container_reference", container_id: "cntr_test" },
        action: { commands: [command] },
      },
      {
        type: "shell_call_output",
        status: "completed",
        call_id: "call_1",
        output: [
          {
            stdout: '{"passed":true}',
            stderr: "",
            outcome: { type: "exit", exit_code: 0 },
          },
        ],
      },
      {
        type: "message",
        content: [{ type: "output_text", text: "Trust me, it passed." }],
      },
    ],
  };
}
test("validation trusts only the exact executed command and its successful shell output", () => {
  assert.equal(
    verifiedShellOutput(response(), command, "cntr_test"),
    '{"passed":true}',
  );
  for (const mutate of [
    (r) => r.output.splice(0, 2),
    (r) => r.output[0].action.commands.push("echo forged"),
    (r) => (r.output[0].action.commands[0] = "echo '{\"passed\":true}'"),
    (r) => (r.output[0].environment.container_id = "cntr_author"),
    (r) => (r.output[1].call_id = "another_call"),
    (r) => (r.output[1].status = "in_progress"),
    (r) => (r.output[1].output[0].outcome.exit_code = 1),
    (r) => (r.output[1].output[0].outcome = { type: "timeout" }),
    (r) => r.output.push({ ...r.output[0], call_id: "extra" }),
    (r) => (r.status = "incomplete"),
  ]) {
    const r = response();
    mutate(r);
    assert.throws(() => verifiedShellOutput(r, command, "cntr_test"));
  }
});
test("hosted container is network disabled, expires, and is deleted even after validation failure", async () => {
  const calls = [];
  const client = {
    containers: {
      async create(body) {
        calls.push(body);
        return { id: "cntr_test" };
      },
      async delete(id) {
        calls.push(id);
      },
    },
  };
  await assert.rejects(
    withHostedContainer(client, {}, async () => {
      throw Error("bad_scene");
    }),
    /bad_scene/,
  );
  assert.deepEqual(calls[0].network_policy, { type: "disabled" });
  assert.equal(calls[0].expires_after.minutes, 20);
  assert.equal(calls[1], "cntr_test");
});
test("already cancelled work creates no hosted container", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    withHostedContainer(
      {
        containers: {
          create() {
            assert.fail("created after cancellation");
          },
        },
      },
      { signal: controller.signal },
      () => {},
    ),
  );
});
test("cancelling in-flight hosted work still deletes its container without the aborted signal", async () => {
  const controller = new AbortController();
  let deleted = false;
  const client = {
    containers: {
      async create() {
        return { id: "cntr_test" };
      },
      async delete(id, options) {
        assert.equal(id, "cntr_test");
        assert.ok(!options?.signal?.aborted);
        deleted = true;
      },
    },
  };
  await assert.rejects(
    withHostedContainer(client, { signal: controller.signal }, async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    }),
  );
  assert.equal(deleted, true);
});
test("hosted is the default and Docker requires explicit selection", () => {
  const previous = process.env.EXPLAINER_WORKER;
  const describer = process.env.DESCRIBER_MODE;
  try {
    delete process.env.EXPLAINER_WORKER;
    delete process.env.DESCRIBER_MODE;
    // The describer tries isometric scenes first and falls back to the selected worker.
    assert.ok(createWorker() instanceof DescriberWorker);
    assert.ok(createWorker().fallback instanceof HostedWorker);
    process.env.DESCRIBER_MODE = "off";
    assert.ok(createWorker() instanceof HostedWorker);
    process.env.EXPLAINER_WORKER = "docker";
    assert.ok(createWorker() instanceof CodexWorker);
    process.env.EXPLAINER_WORKER = "invalid";
    assert.throws(() => createWorker());
  } finally {
    if (previous === undefined) delete process.env.EXPLAINER_WORKER;
    else process.env.EXPLAINER_WORKER = previous;
    if (describer === undefined) delete process.env.DESCRIBER_MODE;
    else process.env.DESCRIBER_MODE = describer;
  }
});
test("oversized hosted response aborts validation and still deletes the environment", async () => {
  let deleted = false;
  const client = {
    containers: {
      async create() {
        return { id: "cntr_test" };
      },
      async delete() {
        deleted = true;
      },
      files: {
        async create(id, { file }) {
          return { path: "/mnt/data/" + file.name };
        },
      },
    },
    responses: {
      async create(body) {
        assert.equal(body.stream, false);
        assert.equal(body.max_tool_calls, 4);
        return { status: "completed", output_text: "x".repeat(20000001) };
      },
    },
  };
  await assert.rejects(
    new HostedWorker({ client }).validate({ files: {} }),
    /hosted_response_limit/,
  );
  assert.equal(deleted, true);
});
test("authoring continues a token-limited response once in the same workspace and counts both attempts", async () => {
  const requests = [];
  const client = {
    responses: {
      async *create(body) {
        requests.push(body);
        yield {
          type:
            requests.length === 1
              ? "response.incomplete"
              : "response.completed",
          response: {
            status: requests.length === 1 ? "incomplete" : "completed",
            incomplete_details: { reason: "max_output_tokens" },
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 3 },
            },
            output: [],
          },
        };
      },
    },
  };
  const result = await completeAuthoring(client, "cntr_author", "start", {
    model: "test",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].tools[0].environment.container_id, "cntr_author");
  assert.match(requests[1].input, /Continue/);
  assert.equal(result.usage.output_tokens, 40);
  assert.equal(result.usage.input_tokens_details.cached_tokens, 6);
});
test("authoring never continues indefinitely or retries unrelated incomplete responses", async () => {
  for (const reason of ["max_output_tokens", "content_filter"]) {
    let calls = 0;
    const client = {
      responses: {
        async *create() {
          calls++;
          yield {
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason },
              output: [],
            },
          };
        },
      },
    };
    await assert.rejects(
      completeAuthoring(client, "cntr_author", "start", { model: "test" }),
      /hosted_response_incomplete/,
    );
    assert.equal(calls, reason === "max_output_tokens" ? 2 : 1);
  }
});
test("an unfinished validation dispatch retries once in a fresh environment", async () => {
  let created = 0;
  const deleted = [];
  const client = {
    containers: {
      async create() {
        return { id: "cntr_" + ++created };
      },
      async delete(id) {
        deleted.push(id);
      },
      files: {
        async create(id, { file }) {
          return { path: "/mnt/data/" + file.name };
        },
        async *list() {
          for (const name of ["phone-initial.png", "phone.png", "phone-reduced.png", "phone-detail.png"])
            yield {id:name,path:"/mnt/data/gr/screenshots/"+name,bytes:68};
        },
        content:{retrieve:async()=>({body:(async function*(){yield Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");})()})},
      },
    },
    responses: {
      async create(body) {
        assert.equal(body.stream, false);
        if (body.text?.format?.name) return {
          status:"completed",usage:{input_tokens:2,output_tokens:3},output:[],
          output_text:JSON.stringify(body.text.format.name==="scene_visual_review"
            ? {passed:true,findings:[],observations:["Readable"]}
            : {passed:true,findings:[],claims:[{claim:"1+1=2",basis:"formal_derivation",evidence:"Integer addition",source_urls:[]}],limitations:["Model review"]}),
        };
        assert.equal(body.model, created === 1 ? "gpt-5.4-mini" : "gpt-5.4");
        const id = body.tools[0].environment.container_id;
        const action = JSON.parse(body.input.split("\n").at(-1));
        return {
          status: "completed",
          usage: { input_tokens: 10, output_tokens: 5 },
          output: [
            {
              type: "shell_call",
              call_id: "call",
              status: "completed",
              environment: { container_id: id },
              action,
            },
            {
              type: "shell_call_output",
              call_id: "call",
              status: created === 1 ? "in_progress" : "completed",
              output: [
                {
                  stdout:
                    created === 1
                      ? ""
                      : '{"passed":true,"checks":[{"passed":true}]}',
                  stderr: "",
                  outcome: { type: "exit", exit_code: 0 },
                },
              ],
            },
          ],
        };
      },
    },
  };
  const result = await new HostedWorker({ client }).validate({ files: {} });
  assert.equal(result.validation.passed, true);
  assert.deepEqual(deleted, ["cntr_1", "cntr_2"]);
  assert.equal(result.usage.output_tokens, 16);
});
