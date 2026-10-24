import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fixture } from "./fixtures.mjs";
import { validateBrowser } from "../src/browser-check.mjs";
for (const topic of ["mathematics", "science", "language"])
  test(
    "trusted fixture: " + topic + " controls/readout/touch/reduced motion",
    async () => {
      const dir = new URL("../artifacts/" + topic + "/", import.meta.url);
      await mkdir(dir, { recursive: true });
      const result = await validateBrowser(fixture(topic), {
        artifactDir: fileURLToPath(dir),
      });
      assert.equal(result.passed, true);
    },
  );
test("validator rejects mismatch between declared and executable state schema", async () => {
  const pkg = fixture();
  pkg.manifest.state_schema.properties.value.maximum = 5;
  await assert.rejects(validateBrowser(pkg), /runtime_contract_mismatch/);
});
test("validator rejects forged expected model state", async () => {
  const pkg = fixture();
  pkg.test_cases[0].expected_state.result = "invented";
  await assert.rejects(validateBrowser(pkg), /model_case_failed/);
});
test("Anatomy geometry requires its palette scope so unresolved fills cannot render black", async () => {
  const pkg = fixture();
  pkg.manifest.representation = "isometric";
  pkg.files["index.html"] = pkg.files["index.html"].replace("</head>", '<style>.iso{--anatomy-paper:#eeeeee}.iso-fill{fill:var(--anatomy-paper)}</style></head>')
    .replace('<script src="runtime.js">', '<svg class="iso-svg" viewBox="0 0 20 20"><path class="iso-fill" d="M0 0H20V20H0Z"/></svg><script src="runtime.js">');
  await assert.rejects(validateBrowser(pkg, { inlineDocument: true }), /anatomy_theme_missing/);
  pkg.files["index.html"] = pkg.files["index.html"].replace('class="iso-svg"', 'class="iso iso-svg"');
  assert.equal((await validateBrowser(pkg, { inlineDocument: true })).passed, true);
});
test("hosted inline document runs real controls with CSP and rejects wrong model assertions", async () => {
  const inline = fixture();
  inline.files["scene.js"] +=
    '\nif(location.href!=="about:blank") throw Error("navigation_forbidden");';
  assert.equal(
    (await validateBrowser(inline, { inlineDocument: true })).passed,
    true,
  );
  const pkg = fixture();
  pkg.test_cases[0].expected_state.result = "wrong";
  await assert.rejects(
    validateBrowser(pkg, { inlineDocument: true }),
    /model_case_failed/,
  );
});
test("hosted inline document keeps CSP enforcement for unapproved scripts", async () => {
  const pkg = fixture();
  pkg.files["scene.js"] +=
    `\ntry { eval('globalThis.unapproved=true'); } catch {};
    const bad=document.createElement('script');bad.textContent='globalThis.unapproved=true';document.head.append(bad);
    if(globalThis.unapproved) throw Error('CSP_not_enforced');`;
  assert.equal(
    (await validateBrowser(pkg, { inlineDocument: true })).passed,
    true,
  );
});
test("hosted validation preserves parser-time script placement instead of approving a broken head script", async () => {
  const pkg = fixture();
  const scripts =
    '<script src="runtime.js"></script><script src="scene.js"></script>';
  pkg.files["index.html"] = pkg.files["index.html"]
    .replace(scripts, "")
    .replace("</head>", scripts + "</head>");
  await assert.rejects(validateBrowser(pkg));
  await assert.rejects(validateBrowser(pkg, { inlineDocument: true }));
});
test("hosted validation preserves DOMContentLoaded for a correctly deferred head script", async () => {
  const pkg = fixture();
  const scripts =
    '<script src="runtime.js"></script><script src="scene.js"></script>';
  pkg.files["index.html"] = pkg.files["index.html"]
    .replace(scripts, "")
    .replace("</head>", scripts + "</head>");
  pkg.files["scene.js"] =
    'document.addEventListener("DOMContentLoaded",()=>{' +
    pkg.files["scene.js"] +
    "});";
  assert.equal((await validateBrowser(pkg)).passed, true);
  assert.equal(
    (await validateBrowser(pkg, { inlineDocument: true })).passed,
    true,
  );
});

test("renderer captures initial phone and actual 4x detail pixels for independent vision review", async () => {
  const dir = new URL("../artifacts/review-captures/", import.meta.url);
  await mkdir(dir, { recursive: true });
  await validateBrowser(fixture(), {artifactDir:fileURLToPath(dir),inlineDocument:true});
  const initial=await readFile(new URL("phone-initial.png",dir));
  const detail=await readFile(new URL("phone-detail.png",dir));
  assert.equal(initial.readUInt32BE(16),390);
  assert.ok(detail.readUInt32BE(16)>1000);
  assert.equal(detail.readUInt32BE(20),720);
});

test("HTML lessons without SVG still capture a 4x viewport", async () => {
  const dir = new URL("../artifacts/html-review-captures/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const pkg=fixture();
  pkg.files['index.html']=pkg.files['index.html'].replace(/<svg\b[^>]*id="figure"[^>]*><\/svg>/,'<div id="figure"></div>');
  assert.equal((await validateBrowser(pkg,{artifactDir:fileURLToPath(dir)})).passed,true);
  const detail=await readFile(new URL('phone-detail.png',dir));
  assert.equal(detail.readUInt32BE(16),1560);
  assert.equal(detail.readUInt32BE(20),2880);
});
