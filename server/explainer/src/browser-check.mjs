import { chromium } from "playwright";
import {writeFile} from "node:fs/promises";
import { CSP } from "./package.mjs";
import { ajv } from "./contracts.mjs";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { LINE_ENDS } from "../vendor/anatomy/scripts/line-ends.mjs";

// Hosted Chromium disallows URL navigation. Render the same document and exact
// script bytes on about:blank; hashes authorize only these two scripts. Data
// URLs preserve parser position, blocking order and lifecycle without fetching.
// shipped package remains unchanged and its local-resource contract is checked
// by normalizePackage. No browser policy or CSP bypass is used.
function inlinePage(pkg) {
  const scripts = ["runtime.js", "scene.js"].map((name) => pkg.files[name]);
  const digests = scripts.map(
    (code) => "sha256-" + createHash("sha256").update(code).digest("base64"),
  );
  const hashes = digests.map((digest) => `'${digest}'`).join(" ");
  let index = 0;
  let html = pkg.files[pkg.entry]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, () => {
      const i = index++;
      return `<script src="data:text/javascript;base64,${Buffer.from(scripts[i]).toString("base64")}" integrity="${digests[i]}" crossorigin="anonymous"></script>`;
    })
    .replaceAll(CSP, CSP.replace("script-src 'self'", `script-src ${hashes}`));
  for (const [path, source] of Object.entries(pkg.files)) {
    if (!path.endsWith(".svg")) continue;
    const data =
      "data:image/svg+xml;base64," + Buffer.from(source).toString("base64");
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html
      .replace(new RegExp(`(src=["'])${escaped}(["'])`, "g"), `$1${data}$2`)
      .replace(
        new RegExp(`url\\(["']?${escaped}["']?\\)`, "g"),
        `url("${data}")`,
      );
  }
  return html;
}
export async function validateBrowser(
  pkg,
  { artifactDir, inlineDocument = false } = {},
) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: ["--disable-dev-shm-usage"],
  });
  const checks = [];
  const errors = [];
  try {
    for (const reduced of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 720 },
        reducedMotion: reduced ? "reduce" : "no-preference",
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.slice(1) || "index.html";
        if (
          url.origin !== "http://127.0.0.1" ||
          !Object.hasOwn(pkg.files, path)
        ) {
          errors.push("network_request");
          return route.abort();
        }
        return route.fulfill({
          body: pkg.files[path],
          contentType: path.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : path.endsWith(".css")
              ? "text/css; charset=utf-8"
              : path.endsWith(".svg")
                ? "image/svg+xml; charset=utf-8"
                : "text/html; charset=utf-8",
          headers: { "Content-Security-Policy": CSP },
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("popup", (popup) => {
        errors.push("popup");
        popup.close();
      });
      const bridge = () => {
        window.__events = [];
        window.webkit = {
          messageHandlers: {
            explainer: { postMessage: (event) => window.__events.push(event) },
          },
        };
      };
      if (inlineDocument) {
        // Any attempted request in inline mode is outside the packaged document.
        await context.unrouteAll();
        await context.route("**/*", (route) => {
          errors.push("network_request");
          return route.abort();
        });
        await page.evaluate(bridge);
        await page.setContent(inlinePage(pkg), {
          waitUntil: "load",
          timeout: 8000,
        });
      } else {
        await page.addInitScript(bridge);
        await page.goto("http://127.0.0.1/index.html", {
          waitUntil: "load",
          timeout: 8000,
        });
      }
      const identity = {
        session_id: "validation",
        scene_id: pkg.scene_id,
        scene_version: pkg.scene_version,
      };
      await page.evaluate((id) => window.explainerBootstrap(id), identity);
      const ready = await page.evaluate(() =>
        window.__events.find((e) => e.kind === "ready"),
      );
      if (!ready) throw Error("missing_ready");
      if (pkg.manifest.representation === "isometric") {
        const themeReady = await page.evaluate(() => {
          // Anatomy palettes live on an .iso ancestor. Without that scope,
          // unresolved CSS variables silently fall back to black SVG fills.
          const palette = [
            [".iso-fill", "--anatomy-paper"], [".iso-top", "--anatomy-top"],
            [".iso-shade", "--anatomy-shade-0"], [".iso-line", "--anatomy-lo"],
            [".tb-body", "--anatomy-shade-2"],
          ];
          return palette.every(([selector, variable]) =>
            [...document.querySelectorAll(selector)].every(element =>
              getComputedStyle(element).getPropertyValue(variable).trim()));
        });
        if (!themeReady) throw Error("anatomy_theme_missing");
        checks.push({ name: "anatomy_palette_scope", passed: true });
        const lines = await page.evaluate(`(${LINE_ENDS})({})`);
        if (!lines || lines.problems.length)
          throw Error("anatomy_line_check_not_passed");
        checks.push({
          name: reduced
            ? "anatomy_lines_reduced"
            : "anatomy_delivered_line_check",
          passed: true,
          output: `line ends: 0 of ${lines.ends} ends on ${lines.lines} lines float`,
        });
      }
      const contract = await page.evaluate(() =>
        window.ExplainerScene.contract(),
      );
      if (
        !isDeepStrictEqual(contract.controls, pkg.manifest.controls) ||
        !isDeepStrictEqual(contract.state_schema, pkg.manifest.state_schema)
      )
        throw Error("runtime_contract_mismatch");
      if (!ajv.compile(pkg.manifest.state_schema)(ready.state))
        throw Error("initial_state_schema");
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error("phone_overflow");
      if (artifactDir && !reduced) {
        if (await page.evaluate(() => document.documentElement.scrollHeight > 6000))
          throw Error("review_screenshot_height_limit");
        await page.screenshot({path: `${artifactDir}/phone-initial.png`, fullPage: true});
      }
      let i = 0;
      for (const test of pkg.test_cases) {
        const before = await page.evaluate(() =>
          window.ExplainerScene.snapshot(),
        );
        const command = {
          ...identity,
          request_id: `test_${i++}`,
          expected_state_revision: before.state_revision,
          name: test.name,
          input: test.input,
        };
        await page.evaluate((c) => window.explainerCommand(c), command);
        const after = await page.evaluate(() =>
          window.ExplainerScene.snapshot(),
        );
        const applied = await page.evaluate(
          (rid) =>
            window.__events.find(
              (e) => e.kind === "action_applied" && e.request_id === rid,
            ),
          command.request_id,
        );
        if (
          !applied ||
          !isDeepStrictEqual(applied.state, after.state) ||
          applied.state_revision !== after.state_revision
        )
          throw Error("bridge_state_mismatch");
        if (
          test.name === "pause" &&
          (await page.evaluate(() => window.ExplainerScene.isPaused())) !==
            (reduced || test.input.paused)
        )
          throw Error("pause_failed");
        if (
          after.state_revision !== before.state_revision + 1 ||
          !isDeepStrictEqual(after.state, test.expected_state)
        )
          throw Error(`model_case_failed:${test.name}`);
        const text = await page.locator(test.selector).innerText();
        if (!text.includes(test.readout))
          throw Error(`readout_mismatch:${test.name}`);
        await page.evaluate((c) => window.explainerCommand(c), command);
        if (
          (await page.evaluate(() => window.ExplainerScene.snapshot()))
            .state_revision !== after.state_revision
        )
          throw Error("duplicate_applied");
      }
      // Real pointer input: author must provide one visible data-action control wired to same reducer.
      const control = page.locator("[data-action]").first();
      if ((await control.count()) !== 1) throw Error("touch_control_missing");
      const beforeTouch = await page.evaluate(
        () => window.ExplainerScene.snapshot().state_revision,
      );
      await control.click();
      if (
        (await page.evaluate(
          () => window.ExplainerScene.snapshot().state_revision,
        )) <= beforeTouch
      )
        throw Error("touch_did_not_apply");
      if (artifactDir) {
        // Capture after the short interaction cue, rather than its first frame.
        await page.waitForTimeout(1000);
        if (await page.evaluate(() => document.documentElement.scrollHeight > 6000))
          throw Error("review_screenshot_height_limit");
        await page.screenshot({
          path: `${artifactDir}/phone${reduced ? "-reduced" : ""}.png`,
          fullPage: true,
        });
        if (!reduced) {
          // Render new pixels at 4x device scale, not a resized PNG. Bound the
          // subject crop so large documents cannot allocate unlimited images.
          const session = await context.newCDPSession(page);
          try {
            const subjectNode = page.locator("svg").first();
            const subject = await subjectNode.count() ? await subjectNode.boundingBox() : null;
            await session.send("Emulation.setDeviceMetricsOverride", {
              width:390, height:720, deviceScaleFactor:4, mobile:false,
            });
            const clip = subject && subject.width > 0 && subject.height > 0 ? {
              x:Math.max(0,subject.x), y:Math.max(0,subject.y),
              width:Math.min(390,subject.width), height:Math.min(720,subject.height), scale:1,
            } : {x:0,y:0,width:390,height:720,scale:1};
            const detail = await session.send("Page.captureScreenshot", {
              format:"png", captureBeyondViewport:true, clip,
            });
            await writeFile(`${artifactDir}/phone-detail.png`, Buffer.from(detail.data,"base64"));
          } finally {
            await session.send("Emulation.clearDeviceMetricsOverride");
            await session.detach();
          }
        }
      }
      if (
        (await page.evaluate(() => window.__events)).some(
          (e) => e.kind === "runtime_error",
        )
      )
        throw Error("runtime_error");
      checks.push({
        name: reduced
          ? "phone_reduced_motion"
          : "phone_controls_model_readouts_touch",
        passed: true,
        cases: pkg.test_cases.length,
      });
      await context.close();
    }
    if (errors.length)
      throw Error("browser_errors:" + errors.slice(0, 3).join(","));
    return {
      passed: true,
      checks: [
        { name: "package_schema_and_resource_bounds", passed: true },
        ...checks,
      ],
      limitations: [
        "Automated model assertions are authored with the scene; they do not establish independent educational correctness.",
        "Browser checks alone do not review visual quality; reduced-motion mode was loaded and exercised, not pixel-proven motionless.",
      ],
    };
  } finally {
    await browser.close();
  }
}
