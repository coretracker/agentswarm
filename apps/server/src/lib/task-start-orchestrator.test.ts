import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@verft/shared-types";
import { beginTaskStart, getTriggerActionForNewTask, orchestrateTaskActionStart, orchestrateTaskStart } from "./task-start-orchestrator.js";

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Test task",
    pinned: false,
    hasPendingCheckpoint: false,
    autoApplyCheckpoints: false,
    shareWithTeam: false,
    activeInteractiveSession: false,
    activeTerminalSessionMode: null,
    ownerUserId: null,
    creatorName: null,
    repoId: "repo-1",
    repoName: "repo",
    repoUrl: "https://github.com/example/repo.git",
    repoDefaultBranch: "main",
    taskType: "build",
    provider: "codex",
    providerProfile: "high",
    modelOverride: null,
    baseBranch: "main",
    branchStrategy: "feature_branch",
    complexity: "normal",
    branchName: "feature/task-1",
    workspaceBaseRef: null,
    prompt: "Do the work",
    executionSummary: "",
    resultMarkdown: null,
    branchDiff: null,
    status: "open",
    workflowStatus: "ready",
    executionStatus: "idle",
    executionAction: "build",
    reviewReason: null,
    logs: [],
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    lastAction: "build",
    enqueued: false,
    ...overrides
  }) satisfies Task as Task;

describe("orchestrateTaskStart", () => {
  it("prepares workspace and returns started task when start succeeds", async () => {
    const task = createTask();
    const prepared: string[] = [];
    const triggered: Array<{ taskId: string; action: string }> = [];
    const executionStates: string[] = [];
    const result = await orchestrateTaskStart(
      {
        taskStore: {
          getTask: async () => task,
          setExecutionState: async (_taskId: string, status: string) => {
            executionStates.push(status);
            return task;
          }
        } as never,
        scheduler: {
          triggerAction: async (taskId: string, action: string) => {
            triggered.push({ taskId, action });
            return true;
          }
        } as never,
        spawner: {
          prepareTaskWorkspaceOnly: async (input: Task) => {
            prepared.push(input.id);
            return task;
          }
        } as never
      },
      {
        task,
        fallbackMessage: "Task follow-up failed"
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.task.id, task.id);
    }
    assert.deepEqual(executionStates, ["preparing", "idle"]);
    assert.deepEqual(prepared, [task.id]);
    assert.deepEqual(triggered, [{ taskId: task.id, action: "build" }]);
  });

  it("returns 409 for start failures", async () => {
    const task = createTask();
    const result = await orchestrateTaskStart(
      {
        taskStore: {
          getTask: async () => task,
          setExecutionState: async () => task
        } as never,
        scheduler: { triggerAction: async () => false } as never,
        spawner: { prepareTaskWorkspaceOnly: async () => task } as never
      },
      {
        task,
        fallbackMessage: "Task follow-up failed"
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.statusCode, 409);
      assert.match(result.message, /could not be started/i);
    }
  });

  it("maps new task action from task type", () => {
    assert.equal(getTriggerActionForNewTask(createTask({ taskType: "build" })), "build");
    assert.equal(getTriggerActionForNewTask(createTask({ taskType: "ask" })), "ask");
  });
});

describe("beginTaskStart", () => {
  it("returns preparing task before workspace preparation completes", async () => {
    const task = createTask();
    let resolvePrepare!: () => void;
    const prepareStarted = new Promise<void>((resolve) => {
      resolvePrepare = resolve;
    });
    const states: string[] = [];
    const triggered: Array<{ taskId: string; action: string }> = [];

    const result = await beginTaskStart(
      {
        taskStore: {
          setExecutionState: async (_taskId: string, status: string) => {
            states.push(status);
            return { ...task, executionStatus: status as Task["executionStatus"] };
          },
          appendLog: async () => undefined
        } as never,
        scheduler: {
          triggerAction: async (taskId: string, action: string) => {
            triggered.push({ taskId, action });
            return true;
          }
        } as never,
        spawner: {
          prepareTaskWorkspaceOnly: async () => {
            await prepareStarted;
            return task;
          }
        } as never
      },
      {
        task,
        fallbackMessage: "Task start failed"
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.task.executionStatus, "preparing");
    }
    assert.deepEqual(states, ["preparing"]);
    assert.deepEqual(triggered, []);

    resolvePrepare();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(states, ["preparing", "idle"]);
    assert.deepEqual(triggered, [{ taskId: task.id, action: "build" }]);
  });

  it("uses an explicit action override when provided", async () => {
    const task = createTask({ taskType: "build" });
    let resolvePrepare!: () => void;
    const prepareStarted = new Promise<void>((resolve) => {
      resolvePrepare = resolve;
    });
    const triggered: Array<{ taskId: string; action: string }> = [];

    const result = await beginTaskStart(
      {
        taskStore: {
          setExecutionState: async (_taskId: string, status: string) => ({ ...task, executionStatus: status as Task["executionStatus"] }),
          appendLog: async () => undefined
        } as never,
        scheduler: {
          triggerAction: async (taskId: string, action: string) => {
            triggered.push({ taskId, action });
            return true;
          }
        } as never,
        spawner: {
          prepareTaskWorkspaceOnly: async () => {
            await prepareStarted;
            return task;
          }
        } as never
      },
      {
        task,
        action: "ask",
        fallbackMessage: "Task start failed"
      }
    );

    assert.equal(result.ok, true);
    resolvePrepare();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(triggered, [{ taskId: task.id, action: "ask" }]);
  });
});

describe("orchestrateTaskActionStart", () => {
  it("returns reason code when a pending checkpoint blocks mutation", async () => {
    const task = createTask();
    const result = await orchestrateTaskActionStart(
      {
        taskStore: {
          hasPendingChangeProposal: async () => true,
          getActiveInteractiveSession: async () => null
        } as never,
        scheduler: {} as never
      },
      {
        task,
        action: "build"
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.statusCode, 409);
      assert.equal(result.reasonCode, "pending_checkpoint");
    }
  });

  it("returns busy message when task is already active", async () => {
    const task = createTask({ status: "building" });
    const result = await orchestrateTaskActionStart(
      {
        taskStore: {
          hasPendingChangeProposal: async () => false,
          getActiveInteractiveSession: async () => null
        } as never,
        scheduler: {} as never
      },
      {
        task,
        action: "build"
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Task is already running");
    }
  });

  it("returns trigger-rejected message when scheduler refuses to start", async () => {
    const task = createTask({ status: "open" });
    const result = await orchestrateTaskActionStart(
      {
        taskStore: {
          hasPendingChangeProposal: async () => false,
          getActiveInteractiveSession: async () => null
        } as never,
        scheduler: {
          triggerAction: async () => false
        } as never
      },
      {
        task,
        action: "build",
        triggerRejectedMessage: "Task execution could not be started"
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Task execution could not be started");
    }
  });

  it("returns ok when scheduler accepts the action", async () => {
    const task = createTask({ status: "open" });
    const result = await orchestrateTaskActionStart(
      {
        taskStore: {
          hasPendingChangeProposal: async () => false,
          getActiveInteractiveSession: async () => null
        } as never,
        scheduler: {
          triggerAction: async () => true
        } as never
      },
      {
        task,
        action: "build"
      }
    );

    assert.deepEqual(result, { ok: true });
  });
});
