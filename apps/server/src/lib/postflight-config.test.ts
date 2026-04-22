import test from "node:test";
import assert from "node:assert/strict";
import { parsePostflightConfig, postflightAppliesToTask } from "./postflight-config.js";

test("parsePostflightConfig parses the agreed v1 schema and defaults timeout", () => {
  const config = parsePostflightConfig(`
version: 1
enabled: true

when:
  task_types: ["build"]
  providers: ["codex", "claude"]

runner:
  image: "mcr.microsoft.com/playwright:v1.52.0-jammy"

steps:
  - run: "npm ci"
  - run: "npx playwright test tests/mobile-screenshots.spec.ts --project=mobile-web --update-snapshots"

on_failure: "fail_task"
`);

  assert.equal(config.version, 1);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.when.task_types, ["build"]);
  assert.deepEqual(config.when.providers, ["codex", "claude"]);
  assert.equal(config.runner.image, "mcr.microsoft.com/playwright:v1.52.0-jammy");
  assert.equal(config.runner.timeout_seconds, 1800);
  assert.deepEqual(config.steps.map((step) => step.run), [
    "npm ci",
    "npx playwright test tests/mobile-screenshots.spec.ts --project=mobile-web --update-snapshots"
  ]);
  assert.equal(config.on_failure, "fail_task");
});

test("parsePostflightConfig supports comments and step lists", () => {
  const config = parsePostflightConfig(`
# build screenshots after the agent run
version: 1
enabled: true
runner:
  image: "node:20-bookworm" # inline comment
  timeout_seconds: 900
steps:
  - run: "npm ci"
  - run: "npm test"
on_failure: ignore
`);

  assert.equal(config.runner.image, "node:20-bookworm");
  assert.equal(config.runner.timeout_seconds, 900);
  assert.equal(config.on_failure, "ignore");
});

test("postflightAppliesToTask respects filters", () => {
  const config = parsePostflightConfig(`
version: 1
enabled: true
when:
  task_types: ["build"]
  providers: ["codex"]
runner:
  image: "node:20-bookworm"
steps:
  - run: "npm ci"
on_failure: fail_task
`);

  assert.equal(postflightAppliesToTask(config, { taskType: "build", provider: "codex" }), true);
  assert.equal(postflightAppliesToTask(config, { taskType: "ask", provider: "codex" }), false);
  assert.equal(postflightAppliesToTask(config, { taskType: "build", provider: "claude" }), false);
});

test("parsePostflightConfig rejects invalid top-level shape", () => {
  assert.throws(
    () =>
      parsePostflightConfig(`
version: 2
runner:
  image: "node:20-bookworm"
steps:
  - run: "npm ci"
on_failure: fail_task
`),
    /Invalid literal value|Expected/
  );
});
