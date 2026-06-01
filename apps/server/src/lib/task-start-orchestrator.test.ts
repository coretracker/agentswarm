import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { orchestrateTaskActionStart, orchestrateTaskStart, taskStartFailureStatusCode } from "./task-start-orchestrator.js";

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
    startMode: "run_now",
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

describe("taskStartFailureStatusCode", () => {
  it("maps run_now failures to 409", () => {
    assert.equal(taskStartFailureStatusCode("run_now"), 409);
  });

  it("maps non run_now failures to 500", () => {
    assert.equal(taskStartFailureStatusCode("prepare_workspace"), 500);
    assert.equal(taskStartFailureStatusCode("idle"), 500);
  });
});

describe("orchestrateTaskStart", () => {
  it("returns started task when start succeeds", async () => {
    const task = createTask();
    const result = await orchestrateTaskStart(
      {
        taskStore: { getTask: async () => task } as never,
        scheduler: { triggerAction: async () => true } as never,
        spawner: { prepareTaskWorkspaceOnly: async () => task } as never
      },
      {
        task,
        startMode: "run_now",
        fallbackMessage: "Task follow-up failed"
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.task.id, task.id);
    }
  });

  it("returns 409 for run_now start failures", async () => {
    const task = createTask();
    const result = await orchestrateTaskStart(
      {
        taskStore: { getTask: async () => task } as never,
        scheduler: { triggerAction: async () => false } as never,
        spawner: { prepareTaskWorkspaceOnly: async () => task } as never
      },
      {
        task,
        startMode: "run_now",
        fallbackMessage: "Task follow-up failed"
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.statusCode, 409);
      assert.match(result.message, /could not be started/i);
    }
  });

  it("records prepare workspace failure state for non-run_now failures", async () => {
    const task = createTask();
    const patched: Array<{ taskId: string; status: string | undefined }> = [];
    const logs: Array<{ taskId: string; line: string }> = [];
    const result = await orchestrateTaskStart(
      {
        taskStore: {
          getTask: async () => {
            throw new Error("task reload failed");
          },
          patchTask: async (taskId: string, patch: { status?: string }) => {
            patched.push({ taskId, status: patch.status });
            return task;
          },
          appendLog: async (taskId: string, line: string) => {
            logs.push({ taskId, line });
          }
        } as never,
        scheduler: { triggerAction: async () => true } as never,
        spawner: { prepareTaskWorkspaceOnly: async () => task } as never
      },
      {
        task,
        startMode: "prepare_workspace",
        fallbackMessage: "Task follow-up failed",
        setPrepareWorkspaceFailureState: true
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.statusCode, 500);
      assert.equal(result.message, "task reload failed");
    }
    assert.equal(patched.length, 1);
    assert.equal(logs.length, 1);
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
