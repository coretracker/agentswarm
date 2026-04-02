import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchedulerService } from "./scheduler.js";

describe("SchedulerService.triggerAction", () => {
  it("allows open tasks to queue a new action", async () => {
    let markedQueued = false;
    let enqueued = false;
    const taskStore = {
      getTask: async () => ({
        id: "task-1",
        status: "open"
      }),
      hasPendingChangeProposal: async () => false,
      getActiveInteractiveSession: async () => null,
      markQueuedForAction: async () => {
        markedQueued = true;
      },
      enqueueTask: async () => {
        enqueued = true;
      },
      dequeueTask: async () => null,
      patchTask: async () => null
    };
    const settingsStore = {
      getSettings: async () => ({
        maxAgents: 0
      })
    };

    const scheduler = new SchedulerService(taskStore as never, settingsStore as never, {} as never);
    const accepted = await scheduler.triggerAction("task-1", "build", "next step");

    assert.equal(accepted, true);
    assert.equal(markedQueued, true);
    assert.equal(enqueued, true);
  });

  it("keeps pending checkpoints blocking new runs in the status-only phase", async () => {
    const taskStore = {
      getTask: async () => ({
        id: "task-2",
        status: "awaiting_review"
      }),
      hasPendingChangeProposal: async () => true,
      getActiveInteractiveSession: async () => null
    };
    const settingsStore = {
      getSettings: async () => ({
        maxAgents: 0
      })
    };

    const scheduler = new SchedulerService(taskStore as never, settingsStore as never, {} as never);
    const accepted = await scheduler.triggerAction("task-2", "build", "continue");

    assert.equal(accepted, false);
  });
});
