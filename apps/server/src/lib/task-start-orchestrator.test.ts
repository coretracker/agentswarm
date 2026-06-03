import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { getTriggerActionForNewTask, orchestrateTaskActionStart, orchestrateTaskStart } from "./task-start-orchestrator.js";

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Test task",
    pinned: false,
    hasPendingCheckpoint: false,
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
    codexCredentialSource: "auto",
    baseBranch: "main",
    branchStrategy: "feature_branch",
    complexity: "normal",
    branchName: "feature/task-1",
    workspaceBaseRef: null,
    prompt: "Do the work",
    notes: "",
    executionSummary: "",
    resultMarkdown: null,
    branchDiff: null,
    status: "open",
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
    const result = await orchestrateTaskStart(
      {
        taskStore: { getTask: async () => task } as never,
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
    assert.deepEqual(prepared, [task.id]);
    assert.deepEqual(triggered, [{ taskId: task.id, action: "build" }]);
  });

  it("returns 409 for start failures", async () => {
    const task = createTask();
    const result = await orchestrateTaskStart(
      {
        taskStore: { getTask: async () => task } as never,
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

  it("returns capacity message for parallel ask when no capacity is available", async () => {
    const task = createTask({ status: "building", taskType: "ask" });
    const result = await orchestrateTaskActionStart(
      {
        taskStore: {
          hasPendingChangeProposal: async () => false,
          getActiveInteractiveSession: async () => null
        } as never,
        scheduler: {
          hasExecutionCapacity: async () => false
        } as never
      },
      {
        task,
        action: "ask",
        allowParallelAsk: true
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /capacity/i);
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
