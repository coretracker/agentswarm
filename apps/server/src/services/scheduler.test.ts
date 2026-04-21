import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchedulerService } from "./scheduler.js";

describe("SchedulerService.triggerAction", () => {
  it("allows open tasks to queue a new action with structured context", async () => {
    let markedQueued = false;
    let queuedEntry: unknown = null;
    let patchedTask: unknown = null;
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
      patchTask: async (_taskId: string, patch: unknown) => {
        patchedTask = patch;
        return null;
      }
    };
    const taskQueueStore = {
      replaceTask: async (entry: unknown) => {
        queuedEntry = entry;
      },
      dequeueTask: async () => null,
      removeTask: async () => undefined
    };
    const settingsStore = {
      getSettings: async () => ({
        maxAgents: 0
      })
    };

    const scheduler = new SchedulerService(taskStore as never, taskQueueStore as never, settingsStore as never, {} as never);
    const accepted = await scheduler.triggerAction("task-1", "build", {
      content: "next step",
      contextEntries: [
        {
          kind: "run",
          label: "Build run · Succeeded · 2026-04-01 10:00:00 UTC",
          content: "Summary:\nImplemented the previous step."
        }
      ]
    });

    assert.equal(accepted, true);
    assert.equal(markedQueued, true);
    assert.deepEqual(queuedEntry, {
      taskId: "task-1",
      reason: "manual",
      action: "build",
      input: {
        content: "next step",
        contextEntries: [
          {
            kind: "run",
            label: "Build run · Succeeded · 2026-04-01 10:00:00 UTC",
            content: "Summary:\nImplemented the previous step."
          }
        ]
      }
    });
    assert.deepEqual(patchedTask, { enqueued: true });
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
    const taskQueueStore = {
      replaceTask: async () => undefined,
      dequeueTask: async () => null,
      removeTask: async () => undefined
    };

    const scheduler = new SchedulerService(taskStore as never, taskQueueStore as never, settingsStore as never, {} as never);
    const accepted = await scheduler.triggerAction("task-2", "build", "continue");

    assert.equal(accepted, false);
  });
});
