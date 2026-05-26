import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { applyTaskStartMode } from "./task-start-mode.js";

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

describe("applyTaskStartMode", () => {
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
});
