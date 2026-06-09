import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { buildTaskLifecycleViewModel } from "./task-lifecycle-view-model";

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Task",
    deadline: null,
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

describe("buildTaskLifecycleViewModel", () => {
  it("maps preparing workspace state", () => {
    const vm = buildTaskLifecycleViewModel(createTask({ status: "preparing_workspace" }));
    assert.equal(vm.isPreparingWorkspace, true);
    assert.equal(vm.resultStatusText, "Preparing workspace");
  });

  it("maps queued build state", () => {
    const vm = buildTaskLifecycleViewModel(createTask({ status: "build_queued", taskType: "build" }));
    assert.equal(vm.isQueued, true);
    assert.equal(vm.resultStatusText, "Build queued");
  });

  it("maps queued ask state", () => {
    const vm = buildTaskLifecycleViewModel(createTask({ status: "ask_queued", taskType: "ask" }));
    assert.equal(vm.isQueued, true);
    assert.equal(vm.resultStatusText, "Question queued");
  });

  it("marks archived tasks", () => {
    const vm = buildTaskLifecycleViewModel(createTask({ status: "archived" }));
    assert.equal(vm.isArchived, true);
  });

  it("marks checkpoint mutations as blocked while the task is running", () => {
    const vm = buildTaskLifecycleViewModel(createTask({ status: "building" }));
    assert.equal(vm.checkpointDiffActionsBlocked, true);
    assert.ok(vm.checkpointDiffActionsBlockedReason);
  });
});
