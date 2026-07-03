import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTaskGitCommitIdentity } from "./task-git-identity.js";

const fallback = { name: "Verft Bot", email: "verft@local.dev" };

describe("resolveTaskGitCommitIdentity", () => {
  it("uses the configured system git author identity", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: "Verft", gitAuthorEmail: "verft@example.com" },
      fallback
    );

    assert.deepEqual(identity, { name: "Verft", email: "verft@example.com" });
  });

  it("falls back when the system git author name is missing", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: null, gitAuthorEmail: "verft@example.com" },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });

  it("falls back when the system git author email is missing", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: "Verft", gitAuthorEmail: null },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });

  it("trims configured system git author values", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: " Verft ", gitAuthorEmail: " verft@example.com " },
      fallback
    );

    assert.deepEqual(identity, { name: "Verft", email: "verft@example.com" });
  });
});
