import http from "node:http";
import { pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { ExplainerService } from "./service.mjs";
import { createWorker } from "./worker-factory.mjs";
import { Planner } from "./planner.mjs";
import { demoConfiguration, VoiceSessions } from "./demo-access.mjs";
import { SpeechGateway } from "./speech.mjs";
import { fail } from "./contracts.mjs";
async function json(req, maxSize = 65536) {
  let size = 0,
    data = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) fail("body_limit", 413);
    data.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(data)) || "{}");
  } catch {
    fail("invalid_json", 400);
  }
}
export function createServer(
  service = new ExplainerService({
    worker: createWorker(),
    planner: new Planner(),
    maxConcurrent: Number(process.env.MAX_CONCURRENT_JOBS || 2),
    ttl: Number(process.env.SESSION_TTL_MS || 3600000),
  }),
  { env = process.env, speech } = {},
) {
  const demo = demoConfiguration(env);
  service.usage = demo.usage;
  service.maxJobs = demo.maxJobs;
  service.maxPending = demo.maxPending;
  const voices = new VoiceSessions();
  const gateway = speech || new SpeechGateway({ apiKey: env.BOSON_API_KEY, usage: demo.usage });
  const bootstrapAuthorized = (token, required = false) => {
    const expected = env.BOOTSTRAP_TOKEN;
    if (!demo.enabled && required && !expected) fail("bootstrap_not_configured", 503);
    if (!demo.enabled && expected && (Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))) fail("unauthorized", 401);
  };
  const limiter = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    try {
      const address = req.socket.remoteAddress || "unknown";
      const now = Date.now();
      let limit = limiter.get(address);
      if (!limit || limit.until < now) {
        limit = { count: 0, until: now + 60000 };
        limiter.set(address, limit);
      }
      if (++limit.count > 240) fail("rate_limited", 429);
      if (limiter.size > 10000) limiter.clear();
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health" && req.method === "GET") {
        res.end(
          JSON.stringify({
            ok: true,
            provider_configured: !!env.OPENAI_API_KEY,
            speech_configured: gateway.configured,
            access_mode: demo.enabled ? "public_demo" : env.BOOTSTRAP_TOKEN ? "bootstrap" : "local",
            worker: service.worker?.kind || "custom",
          }),
        );
        return;
      }
      const token = /^Bearer ([^ ]+)$/.exec(req.headers.authorization || "")?.[1] || "";
      if (url.pathname === "/v1/sessions" && req.method === "POST") {
        bootstrapAuthorized(token);
        const payload = await json(req);
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) fail("invalid_schema", 400);
        res.writeHead(201);
        res.end(JSON.stringify(service.create()));
        return;
      }
      if (url.pathname === "/v1/voice-sessions" && req.method === "POST") {
        bootstrapAuthorized(token, true);
        const payload = await json(req);
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) fail("invalid_schema", 400);
        res.writeHead(201);
        res.end(JSON.stringify(voices.create()));
        return;
      }
      if (url.pathname === "/v1/ready" && req.method === "GET") {
        voices.authorize(token, req.headers["x-app-id"]);
        res.end(JSON.stringify(gateway.ready()));
        return;
      }
      if (url.pathname === "/v1/speech" && req.method === "POST") {
        voices.authorize(token, req.headers["x-app-id"]);
        if ((req.headers["content-type"] || "").split(";")[0].trim() !== "application/json") fail("unsupported_media_type", 415);
        await gateway.stream(req, res, await json(req, 16384));
        return;
      }
      const match = url.pathname.match(
        /^\/v1\/sessions\/([a-zA-Z0-9_-]+)\/(turns|tools|events|scene-events|generation-dialogue|jobs\/[a-zA-Z0-9_-]+)$/,
      );
      if (!match) fail("not_found", 404);
      const s = service.session(match[1], token),
        route = match[2];
      let value;
      if (route === "turns" && req.method === "POST")
        value = await service.turn(s, await json(req));
      else if (route === "generation-dialogue" && req.method === "POST")
        value = await service.generationDialogue(s, await json(req));
      else if (route === "tools" && req.method === "POST")
        value = await service.tool(s, await json(req));
      else if (route === "scene-events" && req.method === "POST")
        value = await service.sceneEvent(s, await json(req));
      else if (route === "events" && req.method === "GET") {
        const after = Number(url.searchParams.get("after") || 0);
        if (!Number.isSafeInteger(after) || after < 0)
          fail("invalid_cursor", 400);
        value = await service.poll(s, after);
      } else if (route.startsWith("jobs/") && req.method === "GET")
        value = service.getJob(s, route.slice(5));
      else fail("method_not_allowed", 405);
      res.end(JSON.stringify(value));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(error.status || 500);
      res.end(JSON.stringify({ error: error.code || "service_error" }));
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  const timer = setInterval(() => { service.prune(); voices.prune(); }, 60000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || "127.0.0.1";
  if (
    !["127.0.0.1", "::1", "localhost"].includes(host) &&
    !process.env.BOOTSTRAP_TOKEN &&
    !(process.env.PUBLIC_DEMO_ENABLED === "true" && process.env.DEMO_USAGE_PATH)
  )
    throw Error("BOOTSTRAP_TOKEN or PUBLIC_DEMO_ENABLED with DEMO_USAGE_PATH required for non-loopback binding");
  const server = createServer();
  server.listen(Number(process.env.PORT || 8787), host, () =>
    console.log(
      "Explainer service listening on " + host + ":" + server.address().port,
    ),
  );
}
