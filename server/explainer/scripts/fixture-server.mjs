// Explicit regression harness. Production server never routes to fixtures.
import { createServer } from "../src/server.mjs";
import { ExplainerService } from "../src/service.mjs";
import { fixture, intent } from "../test/fixtures.mjs";
import { validateBrowser } from "../src/browser-check.mjs";
const topic = process.argv[2] || "mathematics";
const worker = {
  async author(o) {
    o.onValidating();
    const pkg = fixture(topic, {
      scene_id: o.scene_id,
      scene_version: o.scene_version,
    });
    pkg.validation = await validateBrowser(pkg);
    return { package: pkg, metrics: { fixture: true } };
  },
};
const planner = {
  async plan(s, text, { event = false } = {}) {
    if (event)
      return {
        dialogue: [
          {
            speaker: "genius",
            text: "The model now shows " + s.acknowledged.state.result + ".",
          },
        ],
        tools: [],
      };
    return {
      dialogue: [
        { speaker: "genius", text: "Opening a clearly labeled test fixture." },
      ],
      tools: [{ name: "create_explainer", arguments: { intent } }],
    };
  },
};
const server = createServer(new ExplainerService({ worker, planner }));
server.listen(Number(process.env.PORT || 8787), "127.0.0.1", () =>
  console.log("TEST FIXTURE SERVER ONLY on " + server.address().port),
);
