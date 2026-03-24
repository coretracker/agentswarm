import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMutationBlockedReason } from "./task-mutation-guards.js";

describe("getMutationBlockedReason", () => {
  it("returns null when no pending proposal and no interactive session", async () => {
    const store = {
      hasPendingChangeProposal: async () => false,
      getActiveInteractiveSession: async () => null
    };
    assert.equal(await getMutationBlockedReason(store as never, "t1"), null);
  });

  it("returns message when pending proposal exists", async () => {
    const store = {
      hasPendingChangeProposal: async () => true,
      getActiveInteractiveSession: async () => null
    };
    const msg = await getMutationBlockedReason(store as never, "t1");
    assert.ok(msg && msg.includes("pending"));
  });

  it("returns message when interactive session is active", async () => {
    const store = {
      hasPendingChangeProposal: async () => false,
      getActiveInteractiveSession: async () => ({
        sessionId: "s",
        checkpointRef: "abc",
        startedAt: "x",
        untrackedPathsAtCheckpoint: []
      })
    };
    const msg = await getMutationBlockedReason(store as never, "t1");
    assert.ok(msg && msg.includes("terminal"));
  });

  it("prefers pending proposal over interactive session", async () => {
    const store = {
      hasPendingChangeProposal: async () => true,
      getActiveInteractiveSession: async () => ({
        sessionId: "s",
        checkpointRef: "abc",
        startedAt: "x",
        untrackedPathsAtCheckpoint: []
      })
    };
    const msg = await getMutationBlockedReason(store as never, "t1");
    assert.ok(msg && msg.includes("checkpoint"));
  });
});
