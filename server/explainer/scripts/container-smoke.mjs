// Deterministic fixtures test isolation and browser delivery, never live authorship.
import { runContainer } from "../src/worker.mjs";
import { fixture } from "../test/fixtures.mjs";
for (const topic of ["mathematics", "science", "language"]) {
  const start = Date.now();
  const result = await runContainer(
    "validate-child.mjs",
    { package: fixture(topic) },
    { timeout: 60000 },
  );
  console.log(
    JSON.stringify({
      topic,
      fixture: true,
      passed: result.passed,
      container_validation_ms: Date.now() - start,
      checks: result.checks,
    }),
  );
}
