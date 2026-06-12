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
        status: "open",
        executionStatus: "idle"
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
      promptMessageId: null,
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
        status: "awaiting_review",
        executionStatus: "idle"
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
          status: "open",
          executionStatus: "running",
          executionAction: "build",
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
      setExecutionState: async (taskId: string, status: string, extra: unknown) => {
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

  it("queues the oldest pending follow-up with its prompt message id", async () => {
    let markedQueued = false;
    let queuedEntry: unknown = null;

    const taskStore = {
      getTask: async () => ({
        id: "task-4",
        status: "open",
        executionStatus: "idle"
      }),
      getNextPendingActionMessage: async () => ({
        id: "message-1",
        taskId: "task-4",
        role: "user",
        action: "ask",
        content: "Explain the diff",
        createdAt: "2026-06-12T08:00:00.000Z",
        attachments: []
      }),
      hasPendingChangeProposal: async () => false,
      getActiveInteractiveSession: async () => null,
      markQueuedForAction: async () => {
        markedQueued = true;
      },
      patchTask: async () => null
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
    const accepted = await scheduler.triggerNextPendingAction("task-4");

    assert.equal(accepted, true);
    assert.equal(markedQueued, true);
    assert.deepEqual(queuedEntry, {
      taskId: "task-4",
      promptMessageId: "message-1",
      reason: "auto",
      action: "ask",
      input: {
        content: "Explain the diff",
        attachments: []
      }
    });
  });

  it("consumes queued follow-up prompts before execution and auto-triggers the next item on success", async () => {
    const consumedPromptIds: string[] = [];
    const runCalls: Array<{ taskId: string; action: string; promptMessageId: string | null }> = [];
    const autoTriggers: Array<{ taskId: string; reason: string }> = [];

    const taskStore = {
      getTask: async () => ({
        id: "task-5",
        status: "open",
        executionStatus: "queued"
      }),
      consumePendingActionMessage: async (taskId: string, messageId: string) => {
        consumedPromptIds.push(`${taskId}:${messageId}`);
        return {
          id: messageId,
          taskId,
          role: "user",
          action: "build",
          content: "Apply the next fix",
          createdAt: "2026-06-12T09:00:00.000Z"
        };
      }
    };
    const scheduler = new SchedulerService(
      taskStore as never,
      {} as never,
      {} as never,
      {
        runTask: async (_task: unknown, action: string, _input: unknown, promptMessageId: string | null) => {
          runCalls.push({ taskId: "task-5", action, promptMessageId });
        }
      } as never
    );
    (scheduler as any).triggerNextPendingAction = async (taskId: string, reason: string) => {
      autoTriggers.push({ taskId, reason });
      return true;
    };
    (scheduler as any).drainQueue = async () => undefined;

    await (scheduler as any).executeTask(
      {
        taskId: "task-5",
        action: "build",
        reason: "manual",
        promptMessageId: "message-2",
        input: { content: "Apply the next fix" }
      },
      true
    );

    assert.deepEqual(consumedPromptIds, ["task-5:message-2"]);
    assert.deepEqual(runCalls, [{ taskId: "task-5", action: "build", promptMessageId: "message-2" }]);
    assert.deepEqual(autoTriggers, [{ taskId: "task-5", reason: "auto" }]);
  });

  it("skips unavailable queued prompts and advances to the next pending follow-up", async () => {
    const idleTransitions: Array<{ taskId: string; status: string; patch: unknown }> = [];
    const logs: string[] = [];
    const autoTriggers: Array<{ taskId: string; reason: string }> = [];

    const taskStore = {
      getTask: async () => ({
        id: "task-6",
        status: "open",
        executionStatus: "queued"
      }),
      consumePendingActionMessage: async () => null,
      appendLog: async (_taskId: string, line: string) => {
        logs.push(line);
      },
      setExecutionState: async (taskId: string, status: string, patch: unknown) => {
        idleTransitions.push({ taskId, status, patch });
        return null;
      }
    };
    const scheduler = new SchedulerService(taskStore as never, {} as never, {} as never, {} as never);
    (scheduler as any).triggerNextPendingAction = async (taskId: string, reason: string) => {
      autoTriggers.push({ taskId, reason });
      return true;
    };
    (scheduler as any).drainQueue = async () => undefined;

    await (scheduler as any).executeTask(
      {
        taskId: "task-6",
        action: "ask",
        reason: "manual",
        promptMessageId: "message-3",
        input: { content: "What happened?" }
      },
      true
    );

    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? "", /queued follow-up message-3 was unavailable/i);
    assert.deepEqual(idleTransitions, [
      {
        taskId: "task-6",
        status: "idle",
        patch: {
          enqueued: false,
          executionAction: null,
          errorMessage: null
        }
      }
    ]);
    assert.deepEqual(autoTriggers, [{ taskId: "task-6", reason: "auto" }]);
  });
});
