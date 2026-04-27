import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SchedulerService } from "./scheduler.js";

describe("SchedulerService.triggerAction", () => {
  it("allows open tasks to queue a new action with execution input", async () => {
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
      content: "next step"
    });

    assert.equal(accepted, true);
    assert.equal(markedQueued, true);
    assert.deepEqual(queuedEntry, {
      taskId: "task-1",
      reason: "manual",
      action: "build",
      input: {
        content: "next step"
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

  it("marks stale running runs as failed on bootstrap", async () => {
    const updatedRuns: Array<{ runId: string; patch: unknown }> = [];
    const updatedStatuses: Array<{ taskId: string; status: string; extra: unknown }> = [];
    const appendedLogs: Array<{ taskId: string; line: string }> = [];

    const taskStore = {
      listTasks: async () => [
        {
          id: "task-3",
          status: "building",
          lastAction: "build"
        }
      ],
      listRuns: async () => [
        {
          id: "run-1",
          taskId: "task-3",
          action: "build",
          status: "running"
        }
      ],
      updateRun: async (runId: string, patch: unknown) => {
        updatedRuns.push({ runId, patch });
        return null;
      },
      setStatus: async (taskId: string, status: string, extra: unknown) => {
        updatedStatuses.push({ taskId, status, extra });
        return null;
      },
      appendLog: async (taskId: string, line: string) => {
        appendedLogs.push({ taskId, line });
      }
    };
    const taskQueueStore = {
      dequeueTask: async () => null,
      removeTask: async () => undefined
    };
    const settingsStore = {
      getSettings: async () => ({
        maxAgents: 0
      })
    };

    const scheduler = new SchedulerService(taskStore as never, taskQueueStore as never, settingsStore as never, {} as never);
    await scheduler.bootstrap();
    scheduler.stop();

    assert.equal(updatedRuns.length, 1);
    assert.equal(updatedRuns[0]?.runId, "run-1");
    assert.equal(updatedStatuses.length, 1);
    assert.deepEqual(updatedStatuses[0]?.taskId, "task-3");
    assert.equal(updatedStatuses[0]?.status, "failed");
    assert.equal(appendedLogs.length, 1);
    assert.match(appendedLogs[0]?.line ?? "", /recovered interrupted task after restart/i);
  });
});
