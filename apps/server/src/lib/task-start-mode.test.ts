import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { applyTaskStartMode, getTriggerActionForNewTask } from "./task-start-mode.js";

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

describe("applyTaskStartMode", () => {
  it("defaults to run_now when start mode is undefined", async () => {
    const task = createTask();
    const calls: string[] = [];
    const deps = {
      taskStore: {
        getTask: async () => task
      } as never,
      scheduler: {
        triggerAction: async () => {
          calls.push("trigger");
          return true;
        }
      } as never,
      spawner: {
        prepareTaskWorkspaceOnly: async () => {
          calls.push("prepare");
          return task;
        }
      } as never
    };

    await applyTaskStartMode(task, undefined, deps);
    assert.deepEqual(calls, ["prepare", "trigger"]);
  });

  it("prepares workspace before triggering run_now", async () => {
    const task = createTask();
    const calls: string[] = [];
    const deps = {
      taskStore: {
        getTask: async () => task
      } as never,
      scheduler: {
        triggerAction: async () => {
          calls.push("trigger");
          return true;
        }
      } as never,
      spawner: {
        prepareTaskWorkspaceOnly: async () => {
          calls.push("prepare");
          return task;
        }
      } as never
    };

    await applyTaskStartMode(task, "run_now", deps);
    assert.deepEqual(calls, ["prepare", "trigger"]);
  });

  it("throws when run_now cannot be accepted by scheduler", async () => {
    const task = createTask();
    const deps = {
      taskStore: {
        getTask: async () => task
      } as never,
      scheduler: {
        triggerAction: async () => false
      } as never,
      spawner: {
        prepareTaskWorkspaceOnly: async () => task
      } as never
    };

    await assert.rejects(
      async () => applyTaskStartMode(task, "run_now", deps),
      /Task execution could not be started/
    );
  });

  it("returns immediately for idle mode", async () => {
    const task = createTask();
    let prepared = false;
    let triggered = false;
    const deps = {
      taskStore: {
        getTask: async () => task
      } as never,
      scheduler: {
        triggerAction: async () => {
          triggered = true;
          return true;
        }
      } as never,
      spawner: {
        prepareTaskWorkspaceOnly: async () => {
          prepared = true;
          return task;
        }
      } as never
    };

    const result = await applyTaskStartMode(task, "idle", deps);
    assert.equal(result.id, task.id);
    assert.equal(prepared, false);
    assert.equal(triggered, false);
  });

  it("starts workspace prepare in background for prepare_workspace mode", async () => {
    const task = createTask();
    let prepared = false;
    let triggered = false;
    const deps = {
      taskStore: {
        getTask: async () => task,
        patchTask: async () => task,
        appendLog: async () => {}
      } as never,
      scheduler: {
        triggerAction: async () => {
          triggered = true;
          return true;
        }
      } as never,
      spawner: {
        prepareTaskWorkspaceOnly: async () => {
          prepared = true;
          return task;
        }
      } as never
    };

    const result = await applyTaskStartMode(task, "prepare_workspace", deps);
    assert.equal(result.id, task.id);
    assert.equal(prepared, true);
    assert.equal(triggered, false);
  });
});

describe("getTriggerActionForNewTask", () => {
  it("maps ask tasks to ask action", () => {
    assert.equal(getTriggerActionForNewTask({ taskType: "ask" }), "ask");
  });

  it("maps build tasks to build action", () => {
    assert.equal(getTriggerActionForNewTask({ taskType: "build" }), "build");
  });
});
