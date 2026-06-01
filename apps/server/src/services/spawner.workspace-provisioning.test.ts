import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { SpawnerService } from "./spawner.js";

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
    enqueued: false
  }) satisfies Task as Task;

const createSpawner = (): SpawnerService =>
  new SpawnerService(
    {} as never,
    {
      getSettings: async () => ({ workspaceProvisioningMode: "clone_only", branchPrefix: "agentswarm" })
    } as never,
    {} as never,
    {} as never
  );

describe("SpawnerService workspace provisioning", () => {
  it("releases named locks after completion", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const locks = new Map<string, Promise<void>>();
    const key = "task-1";

    const result = await spawnerAny.withNamedLock(locks, key, async () => "ok");
    assert.equal(result, "ok");
    assert.equal(locks.has(key), false);
  });

  it("prepares build workspace via clone model", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-clone-"));
    const workspacePath = path.join(root, "task");
    const task = createTask();

    let cloned = false;
    let checkedOut = false;
    spawnerAny.resolveWorkspacePath = () => workspacePath;
    spawnerAny.resolveWorkspaceHostPath = () => workspacePath;
    spawnerAny.cloneWorkspaceFromSource = async () => {
      cloned = true;
      await mkdir(workspacePath, { recursive: true });
    };
    spawnerAny.checkoutTaskWorkspaceBranch = async () => {
      checkedOut = true;
    };
    spawnerAny.gitCommandCapture = async () => "abc123";

    const workspace = await spawnerAny.prepareWorkspace(task, "build", "feature/task-1", "/repo-cache/path", "clone_only");
    assert.equal(cloned, true);
    assert.equal(checkedOut, true);
    assert.equal(workspace.workspacePath, workspacePath);
    assert.equal(workspace.kind, "clone");
    assert.equal(workspace.ephemeral, false);
  });

  it("uses hybrid fallback when clone provisioning fails", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const task = createTask();
    const fallbackWorkspace = {
      workspacePath: "/tmp/fallback",
      hostWorkspacePath: "/tmp/fallback",
      startRef: "start",
      workspaceBaseRef: "start",
      kind: "clone",
      ephemeral: false,
      cleanupRepoPath: null
    };

    spawnerAny.resolveWorkspacePath = () => "/tmp/workspace";
    spawnerAny.cloneWorkspaceFromSource = async () => {
      throw new Error("clone failed");
    };
    spawnerAny.classifyWorkspacePrepareFailure = () => "clone_error";
    spawnerAny.prepareWorkspaceLegacyWorktree = async () => fallbackWorkspace;

    const workspace = await spawnerAny.prepareWorkspace(task, "build", "feature/task-1", "/repo-cache/path", "hybrid");
    assert.deepEqual(workspace, fallbackWorkspace);
  });

  it("reuses the existing task workspace for ask runs", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-ask-"));
    const taskWorkspacePath = path.join(root, "task-workspace");
    const task = createTask();
    await mkdir(taskWorkspacePath, { recursive: true });
    await mkdir(path.join(taskWorkspacePath, ".git"), { recursive: true });

    spawnerAny.resolveWorkspacePath = () => taskWorkspacePath;
    spawnerAny.resolveWorkspaceHostPath = () => taskWorkspacePath;
    spawnerAny.gitCommandCapture = async () => "deadbeef";

    const workspace = await spawnerAny.prepareAskRunWorkspace(task, "feature/task-1", "/repo-cache/path", "clone_only");
    assert.equal(workspace.workspacePath, taskWorkspacePath);
    assert.equal(workspace.hostWorkspacePath, taskWorkspacePath);
    assert.equal(workspace.kind, "clone");
  });

  it("prepares the task workspace for ask runs when missing", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const task = createTask();
    const preparedWorkspace = {
      workspacePath: "/tmp/task-workspace",
      hostWorkspacePath: "/tmp/task-workspace",
      startRef: "start",
      workspaceBaseRef: "start",
      kind: "clone",
      ephemeral: false,
      cleanupRepoPath: null
    };

    spawnerAny.resolveWorkspacePath = () => "/tmp/task-workspace";
    spawnerAny.prepareWorkspace = async () => preparedWorkspace;

    const workspace = await spawnerAny.prepareAskRunWorkspace(task, "feature/task-1", "/repo-cache/path", "clone_only");
    assert.deepEqual(workspace, preparedWorkspace);
  });

  it("rebuilds ask workspace when the folder exists but is not a git repo", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-ask-rebuild-"));
    const taskWorkspacePath = path.join(root, "task-workspace");
    const task = createTask();
    await mkdir(taskWorkspacePath, { recursive: true });
    await writeFile(path.join(taskWorkspacePath, "README.txt"), "placeholder", "utf8");

    const preparedWorkspace = {
      workspacePath: taskWorkspacePath,
      hostWorkspacePath: taskWorkspacePath,
      startRef: "rebuilt",
      workspaceBaseRef: "rebuilt",
      kind: "clone",
      ephemeral: false,
      cleanupRepoPath: null
    };

    let prepareWorkspaceCalled = false;
    spawnerAny.resolveWorkspacePath = () => taskWorkspacePath;
    spawnerAny.prepareWorkspace = async () => {
      prepareWorkspaceCalled = true;
      return preparedWorkspace;
    };

    const workspace = await spawnerAny.prepareAskRunWorkspace(task, "feature/task-1", "/repo-cache/path", "clone_only");
    assert.equal(prepareWorkspaceCalled, true);
    assert.deepEqual(workspace, preparedWorkspace);
  });

  it("cleans up ephemeral clone workspace directory", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-cleanup-"));
    const workspacePath = path.join(root, "workspace");
    await mkdir(workspacePath, { recursive: true });
    await writeFile(path.join(workspacePath, "file.txt"), "x", "utf8");

    await spawnerAny.cleanupPreparedWorkspace({
      workspacePath,
      hostWorkspacePath: workspacePath,
      startRef: "start",
      workspaceBaseRef: "start",
      kind: "clone",
      ephemeral: true,
      cleanupRepoPath: null
    });

    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  });

  it("uses clone workspace metadata for manual postflight runs", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-postflight-"));
    const workspacePath = path.join(root, "workspace");
    const task = createTask({ id: "task-postflight" });
    await mkdir(workspacePath, { recursive: true });

    let workspaceKindSeen: string | null = null;
    spawnerAny.validateTaskPostflight = async () => undefined;
    spawnerAny.resolveWorkspacePath = () => workspacePath;
    spawnerAny.resolveWorkspaceHostPath = () => workspacePath;
    spawnerAny.syncTaskStatusForRunningRuns = async () => true;
    spawnerAny.gitCommandCapture = async () => "cafebabe";
    spawnerAny.listUntrackedRelativePaths = async () => [];
    spawnerAny.runConfiguredPostflight = async (_task: Task, workspace: { kind: string }) => {
      workspaceKindSeen = workspace.kind;
    };
    spawnerAny.stripEphemeralWorkspaceFiles = async () => undefined;
    spawnerAny.collectWorkingTreeDiffSinceRef = async () => ({
      diff: "",
      diffStat: "",
      changedFiles: [],
      diffTruncated: false,
      toRef: "cafebabe"
    });

    const runtimeCredentials = {
      githubToken: null,
      gitUsername: "x-access-token",
      openaiApiKey: null,
      anthropicApiKey: null,
      codexAuthJson: null,
      openaiBaseUrl: null,
      defaultProvider: "codex"
    };
    spawnerAny.settingsStore = {
      getSettings: async () => ({ branchPrefix: "agentswarm" }),
      getRuntimeCredentials: async () => runtimeCredentials
    };
    spawnerAny.taskStore = {
      createRun: async () => ({ id: "run-1" }),
      updateRun: async () => null,
      appendLogForRun: async () => undefined,
      hasPendingChangeProposal: async () => false,
      setStatus: async () => null,
      patchTask: async () => null,
      getTask: async () => task,
      appendLog: async () => undefined
    };

    await spawner.runTaskPostflight(task);
    assert.equal(workspaceKindSeen, "clone");
  });
});
