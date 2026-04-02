import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTaskCommitSubject, formatCommitSubject } from "./task-commit-subject.js";

describe("formatCommitSubject", () => {
  it("normalizes whitespace and truncates long subjects", () => {
    assert.equal(
      formatCommitSubject("  fix(server):   this is a very long commit subject that keeps going past the seventy two character limit  "),
      "fix(server): this is a very long commit subject that keeps going past..."
    );
  });
});

describe("buildTaskCommitSubject", () => {
  it("uses the task title as the primary commit subject", () => {
    assert.equal(
      buildTaskCommitSubject("Fix commit messages for push previews", [
        "apps/server/src/services/spawner.ts",
        "apps/server/src/lib/task-commit-subject.ts"
      ]),
      "fix(server): fix commit messages for push previews"
    );
  });

  it("reorders conversational titles when possible", () => {
    assert.equal(
      buildTaskCommitSubject("For git commits use users email and users name", [
        "apps/server/src/services/spawner.ts",
        "apps/server/src/index.ts"
      ]),
      "chore(server): use user email and user name for git commits"
    );
  });

  it("falls back to a scope-aware file summary for generic titles", () => {
    assert.equal(
      buildTaskCommitSubject("Do it", [
        "apps/server/src/services/spawner.ts",
        "apps/server/src/index.ts",
        "apps/server/src/lib/task-provider-state.ts"
      ]),
      "chore(server): update server files"
    );
  });

  it("uses repo scope when files span unrelated areas", () => {
    assert.equal(
      buildTaskCommitSubject("Improve release docs and deploy config", [
        "README.md",
        "deploy/nginx.conf"
      ]),
      "chore(repo): improve release docs and deploy config"
    );
  });
});
