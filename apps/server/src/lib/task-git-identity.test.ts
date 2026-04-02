import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTaskGitCommitIdentity } from "./task-git-identity.js";

const fallback = { name: "AgentSwarm Bot", email: "agentswarm@local.dev" };

describe("resolveTaskGitCommitIdentity", () => {
  it("uses the task owner's name and email when available", async () => {
    const identity = await resolveTaskGitCommitIdentity(
      { ownerUserId: "user-1" },
      {
        getUser: async (userId) =>
          userId === "user-1"
            ? { name: "Ada Lovelace", email: "ada@example.com" }
            : null
      },
      fallback
    );

    assert.deepEqual(identity, { name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("falls back when the task has no owner", async () => {
    const identity = await resolveTaskGitCommitIdentity(
      { ownerUserId: null },
      { getUser: async () => ({ name: "Ignored", email: "ignored@example.com" }) },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });

  it("falls back when the owner record no longer exists", async () => {
    const identity = await resolveTaskGitCommitIdentity(
      { ownerUserId: "missing-user" },
      { getUser: async () => null },
      fallback
    );

    assert.deepEqual(identity, fallback);
  });
});
