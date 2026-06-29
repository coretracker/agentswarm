import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTaskGitCommitIdentity } from "./task-git-identity.js";

const fallback = { name: "AgentSwarm Bot", email: "agentswarm@local.dev" };

describe("resolveTaskGitCommitIdentity", () => {
  it("uses the configured system git author identity", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: "AgentSwarm", gitAuthorEmail: "agentswarm@example.com" },
      fallback
    );

    assert.deepEqual(identity, { name: "AgentSwarm", email: "agentswarm@example.com" });
  });

  it("falls back when the system git author name is missing", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: null, gitAuthorEmail: "agentswarm@example.com" },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });

  it("falls back when the system git author email is missing", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: "AgentSwarm", gitAuthorEmail: null },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });

  it("trims configured system git author values", () => {
    const identity = resolveTaskGitCommitIdentity(
      { gitAuthorName: " AgentSwarm ", gitAuthorEmail: " agentswarm@example.com " },
      fallback
    );

    assert.deepEqual(identity, { name: "AgentSwarm", email: "agentswarm@example.com" });
  });
});
