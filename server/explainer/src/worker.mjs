import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSchema, object } from "./contracts.mjs";
import { normalizePackage } from "./package.mjs";
export function runContainer(
  script,
  input,
  {
    signal,
    timeout = 900000,
    network = false,
    image = process.env.WORKER_IMAGE || "genie-rookie-worker:local",
    credential = false,
    innerSandbox = credential,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("cancelled"));
    const name = "gr-" + randomUUID();
    const args = [
      "run",
      "--rm",
      "--name",
      name,
      "--init",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=2g",
      "--cpus=2",
      "--tmpfs",
      "/tmp:rw,nosuid,size=256m",
      "--tmpfs",
      "/work:rw,nosuid,size=256m,uid=1000,gid=1000",
      "--user",
      "1000:1000",
      "-i",
    ];
    if (!network) args.push("--network=none");
    if (innerSandbox) {
      // Let the non-root worker create its inner filesystem/network sandbox.
      // All other Docker syscall restrictions and resource limits remain.
      args.push(
        "--security-opt",
        `seccomp=${fileURLToPath(new URL("../sandbox/codex-userns.json", import.meta.url))}`,
      );
    }
    if (credential) {
      args.push(
        "-e",
        "OPENAI_API_KEY",
        "-e",
        `CODEX_MODEL=${process.env.CODEX_MODEL || "gpt-5.4"}`,
        "-e",
        `JOB_TIMEOUT_MS=${timeout}`,
      );
    }
    args.push(image, "node", `/app/src/${script}`, "--stdin");
    const child = spawn("docker", args, {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(credential ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    }
    function abort() {
      spawn("docker", ["kill", name], { stdio: "ignore" }).on(
        "error",
        () => {},
      );
      child.kill("SIGKILL");
      finish(Error(signal?.aborted ? "cancelled" : "worker_timeout"));
    }
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) abort();
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on("error", (e) => finish(e));
    child.on("exit", (code) => {
      if (code !== 0)
        return finish(
          Object.assign(Error("worker_failed"), { detail: stderr }),
        );
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(Error("invalid_worker_output"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
export class CodexWorker {
  constructor({ onAuthored } = {}) {
    this.kind = "docker";
    // Optional operator diagnostics for explicit live smoke runs, never enabled
    // by the production server. The result contains generated code, not audio.
    this.onAuthored = onAuthored;
  }
  async author({
    intent,
    previous,
    scene_id,
    scene_version,
    signal,
    onValidating,
  }) {
    if (!process.env.OPENAI_API_KEY)
      throw Object.assign(Error("provider_not_configured"), {
        code: "provider_not_configured",
      });
    const start = Date.now();
    const result = await runContainer(
      "author-child.mjs",
      { intent, previous },
      {
        signal,
        credential: true,
        network: true,
        timeout: Number(process.env.JOB_TIMEOUT_MS || 900000),
      },
    );
    if (signal.aborted) throw Error("cancelled");
    await this.onAuthored?.(result);
    const reportText = { type: "string", maxLength: 4000 };
    const reportList = { type: "array", maxItems: 150, items: reportText };
    assertSchema(
      object({
        concept: reportText,
        representation_rationale: reportText,
        model_sources: reportList,
        assumptions: reportList,
        parts: reportList,
        commands: {
          type: "array",
          maxItems: 40,
          items: object({ command: reportText, outcome: reportText }),
        },
        limitations: reportList,
      }),
      result.authoring_report,
    );
    const pkg = normalizePackage(result.package, { scene_id, scene_version });
    onValidating();
    pkg.validation = await runContainer(
      "validate-child.mjs",
      { package: pkg, audit_sources: result.audit_sources },
      { signal, timeout: 120000 },
    );
    const usage = result.usage || {};
    const rates = [
      "INPUT_USD_PER_MILLION",
      "CACHED_INPUT_USD_PER_MILLION",
      "OUTPUT_USD_PER_MILLION",
    ].map((k) =>
      process.env[k] === undefined || process.env[k] === ""
        ? null
        : Number(process.env[k]),
    );
    const cost = rates.every(Number.isFinite)
      ? ((usage.input_tokens - (usage.cached_input_tokens || 0)) * rates[0] +
          (usage.cached_input_tokens || 0) * rates[1] +
          usage.output_tokens * rates[2]) /
        1e6
      : null;
    pkg.authoring_report = result.authoring_report;
    return {
      package: pkg,
      metrics: {
        generation_ms: Date.now() - start,
        usage,
        cost_usd: cost,
        cost_basis:
          cost === null
            ? "rates_not_configured"
            : "operator_supplied_per_million_token_rates",
      },
    };
  }
}
