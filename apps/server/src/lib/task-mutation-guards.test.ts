import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMutationBlocked, getMutationBlockedReason } from "./task-mutation-guards.js";

const createStore = (input: { hasPending: boolean; hasSession: boolean }) =>
  ({
    hasPendingChangeProposal: async () => input.hasPending,
    getActiveInteractiveSession: async () =>
      input.hasSession
        ? {
            sessionId: "s",
            checkpointRef: "abc",
            startedAt: "x",
            untrackedPathsAtCheckpoint: []
          }
        : null
  }) as const;

describe("getMutationBlocked", () => {
  it("returns null when no pending proposal and no interactive session", async () => {
    assert.equal(await getMutationBlocked(createStore({ hasPending: false, hasSession: false }) as never, "t1"), null);
  });

  it("returns pending checkpoint code when pending proposal exists", async () => {
    assert.deepEqual(await getMutationBlocked(createStore({ hasPending: true, hasSession: false }) as never, "t1"), {
      code: "pending_checkpoint",
      message: "Apply or reject the pending checkpoint before continuing."
    });
  });

  it("returns active terminal code when interactive session is active", async () => {
    assert.deepEqual(await getMutationBlocked(createStore({ hasPending: false, hasSession: true }) as never, "t1"), {
      code: "active_terminal_session",
      message: "Close the terminal session before continuing."
    });
  });

  it("prefers pending checkpoint when both blockers exist", async () => {
    assert.deepEqual(await getMutationBlocked(createStore({ hasPending: true, hasSession: true }) as never, "t1"), {
      code: "pending_checkpoint",
      message: "Apply or reject the pending checkpoint before continuing."
    });
  });
});

describe("getMutationBlockedReason", () => {
  it("returns null when no pending proposal and no interactive session", async () => {
    assert.equal(await getMutationBlockedReason(createStore({ hasPending: false, hasSession: false }) as never, "t1"), null);
  });

  it("returns message when pending proposal exists", async () => {
    const msg = await getMutationBlockedReason(createStore({ hasPending: true, hasSession: false }) as never, "t1");
    assert.ok(msg && msg.includes("pending"));
  });

  it("returns message when interactive session is active", async () => {
    const msg = await getMutationBlockedReason(createStore({ hasPending: false, hasSession: true }) as never, "t1");
    assert.ok(msg && msg.includes("terminal"));
  });

  it("prefers pending proposal over interactive session", async () => {
    const msg = await getMutationBlockedReason(createStore({ hasPending: true, hasSession: true }) as never, "t1");
    assert.ok(msg && msg.includes("checkpoint"));
  });
});
