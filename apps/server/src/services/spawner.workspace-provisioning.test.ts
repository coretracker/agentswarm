import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Task } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { SpawnerService } from "./spawner.js";

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Test task",
    deadline: null,
    pinned: false,
    hasPendingCheckpoint: false,
    autoApplyCheckpoints: false,
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

  it("resolves raw event mount paths for provider runtimes", () => {
    const spawner = createSpawner();

    const mount = spawner.resolveTaskRunRawEventsMount("task-123", "run-with-spaces");

    assert.equal(mount.hostDir, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/raw-runs"));
    assert.equal(mount.containerDir, "/task-workspaces/.task-state/task-123/raw-runs");
  });

  it("mounts Claude provider state from a task-scoped home path", () => {
    const spawner = createSpawner() as any;
    const paths = {
      hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/Task-AbC/claude-home/.claude"),
      homeHostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/Task-AbC/claude-home")
    };

    assert.equal(
      spawner.resolveProviderStateMountSourceRelativePath("Task AbC", "claude", paths),
      ".task-state/Task-AbC/claude-home"
    );
    assert.equal(spawner.resolveProviderStateContainerPath("claude"), "/home/agent/.claude");
    assert.equal(spawner.resolveProviderHomeContainerPath("claude"), "/home/agent");
  });

  it("rejects provider state mounts that resolve to repository .claude", () => {
    const spawner = createSpawner() as any;
    const paths = {
      hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, "task-1/.claude"),
      homeHostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, "task-1/.claude")
    };

    assert.throws(
      () => spawner.resolveProviderStateMountSourceRelativePath("task-1", "claude", paths),
      /Refusing to mount unsafe provider state path/
    );
  });

  it("injects AgentSwarm MCP into task runtime config", async () => {
    const createdTokens: unknown[] = [];
    const spawner = new SpawnerService(
      {} as never,
      {} as never,
      {
        getAuthSessionUser: async (userId: string) => ({ id: userId }),
        listUsers: async () => []
      } as never,
      {} as never,
      undefined,
      {
        createToken: async (input: unknown) => {
          createdTokens.push(input);
          return { token: "runtime-token" };
        }
      } as never
    );

    const runtimeMcp = await (spawner as any).buildRuntimeMcpConfig(
      createTask({ ownerUserId: "user-1" }),
      [
        {
          name: "agentswarm",
          transport: "http",
          url: "https://manual.example.com/mcp",
          bearerTokenEnvVar: "MANUAL_TOKEN",
          enabled: true
        },
        {
          name: "github",
          transport: "http",
          url: "https://api.githubcopilot.com/mcp",
          enabled: true
        }
      ],
      "run-1"
    );

    assert.equal(runtimeMcp.injectedAgentSwarmMcp, true);
    assert.equal(runtimeMcp.env.AGENTSWARM_MCP_TOKEN, "runtime-token");
    assert.equal(createdTokens.length, 1);
    assert.equal(runtimeMcp.servers.length, 2);
    assert.deepEqual(
      runtimeMcp.servers.map((server: { name: string }) => server.name),
      ["github", "agentswarm"]
    );
    assert.equal(runtimeMcp.servers[1].transport, "stdio");
    assert.equal(runtimeMcp.servers[1].command, "node");
    assert.deepEqual(runtimeMcp.servers[1].args, ["/usr/local/bin/agentswarm-mcp-bridge.mjs"]);
    const expectedEndpoints = existsSync("/.dockerenv")
      ? [
          `http://127.0.0.1:${env.PORT}/mcp`,
          `http://host.docker.internal:${env.PORT}/mcp`,
          `http://172.17.0.1:${env.PORT}/mcp`
        ]
      : [`http://host.docker.internal:${env.PORT}/mcp`, `http://172.17.0.1:${env.PORT}/mcp`];
    const expectedEndpoint = expectedEndpoints[0] ?? "";
    assert.equal(runtimeMcp.env.AGENTSWARM_MCP_ENDPOINT, expectedEndpoint);
    assert.equal(runtimeMcp.env.AGENTSWARM_MCP_ENDPOINTS, expectedEndpoints.join(","));
    assert.deepEqual(runtimeMcp.servers[1].env, {
      AGENTSWARM_MCP_ENDPOINT: expectedEndpoint,
      AGENTSWARM_MCP_ENDPOINTS: expectedEndpoints.join(","),
      AGENTSWARM_MCP_TOKEN: "runtime-token"
    });
  });

  it("resolves task runtime MCP servers from the task repository", async () => {
    const spawner = new SpawnerService(
      {} as never,
      {} as never,
      {
        getAuthSessionUser: async () => null,
        listUsers: async () => []
      } as never,
      {
        getRepositoryRuntimeEnvEntries: async () => [],
        getRepositoryMcpServers: async (repositoryId: string) => [
          {
            name: `${repositoryId}-github`,
            transport: "http",
            url: "https://api.githubcopilot.com/mcp",
            bearerTokenEnvVar: "REPO_MCP_TOKEN",
            enabled: true
          }
        ]
      } as never
    );

    const runtimeMcp = await spawner.buildRuntimeMcpConfigForTask(createTask({ repoId: "repo-7" }), "run-1");

    assert.equal(runtimeMcp.injectedAgentSwarmMcp, false);
    assert.deepEqual(
      runtimeMcp.servers.map((server) => server.name),
      ["repo-7-github"]
    );
  });

  it("builds repository harness markdown only when fields are populated", () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;

    const empty = spawnerAny.buildRepositoryHarnessMarkdown({
      harnessWhatExists: null,
      harnessAllowedActions: "",
      harnessHowToWork: "   ",
      harnessDefinitionOfDone: null,
      harnessEvidenceExpectations: undefined
    });
    assert.equal(empty, null);

    const populated = spawnerAny.buildRepositoryHarnessMarkdown({
      harnessWhatExists: "Monorepo with apps/web and apps/server.",
      harnessAllowedActions: null,
      harnessHowToWork: "Prefer harness scripts in scripts/harness.",
      harnessDefinitionOfDone: "check.sh and test.sh pass.",
      harnessEvidenceExpectations: ""
    });
    assert.match(populated, /# Repository Harness/);
    assert.match(populated, /## What exists\?/);
    assert.match(populated, /## How should you work\?/);
    assert.match(populated, /## How do you know you are done\?/);
    assert.doesNotMatch(populated, /## What is allowed\?/);
    assert.doesNotMatch(populated, /## How do you prove it\?/);
  });

  it("writes and removes runtime harness files based on repository harness content", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-runtime-harness-"));
    const workspacePath = path.join(root, "workspace");
    await mkdir(workspacePath, { recursive: true });

    const markdown = spawnerAny.buildRepositoryHarnessMarkdown({
      harnessWhatExists: "apps/web, apps/server",
      harnessAllowedActions: "You can edit TypeScript and docs.",
      harnessHowToWork: "Use existing patterns.",
      harnessDefinitionOfDone: "All required checks pass.",
      harnessEvidenceExpectations: "Share test command output."
    });
    const harnessPath = await spawnerAny.syncWorkspaceRuntimeHarnessFile(workspacePath, markdown);
    assert.equal(harnessPath, path.join(workspacePath, ".agentswarm-runtime", "harness.md"));
    const written = await readFile(harnessPath, "utf8");
    assert.match(written, /## What exists\?/);
    assert.match(written, /## What is allowed\?/);
    assert.match(written, /## How do you prove it\?/);

    const removedPath = await spawnerAny.syncWorkspaceRuntimeHarnessFile(workspacePath, null);
    assert.equal(removedPath, null);
    const exists = await access(harnessPath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  });

  it("allows internal checkpoint apply flow to bypass the running-task guard", async () => {
    const spawner = new SpawnerService(
      {
        getChangeProposal: async () => ({
          id: "proposal-1",
          taskId: "task-1",
          sourceType: "build_run",
          sourceId: "run-1",
          status: "applied",
          fromRef: "abc123",
          toRef: "def456",
          diff: "diff --git a/src/example.ts b/src/example.ts",
          diffStat: "1 file changed",
          changedFiles: ["src/example.ts"],
          diffTruncated: false,
          untrackedPathsAtCheckpoint: [],
          createdAt: "2026-06-12T08:00:00.000Z",
          resolvedAt: null,
          revertedAt: null
        })
      } as never,
      {} as never,
      {} as never,
      {} as never
    );

    const runningTask = createTask({ executionStatus: "running" });
    const bypassed = await spawner.applyChangeProposal(runningTask, "proposal-1", { allowDuringExecution: true });
    assert.deepEqual(bypassed, {
      ok: false,
      message: "Checkpoint must be pending, applying, or reverted to apply."
    });
  });

  it("marks provider-created local commit checkpoints as already applied", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-provider-commit-"));
    let createdStatus: string | null = null;
    const logs: string[] = [];
    const spawner = new SpawnerService(
      {
        getRun: async () => ({
          id: "run-1",
          taskId: "task-1",
          changeProposalCheckpointRef: "abc123",
          changeProposalUntrackedPaths: []
        }),
        createChangeProposal: async (input: any) => {
          createdStatus = input.status;
          return {
            ...input,
            resolvedAt: input.status === "applied" ? "2026-06-12T08:00:00.000Z" : null,
            revertedAt: null
          };
        },
        appendLog: async (_taskId: string, line: string) => {
          logs.push(line);
        }
      } as never,
      {
        getRuntimeCredentials: async () => ({
          githubToken: null,
          gitUsername: "x-access-token"
        })
      } as never,
      {} as never,
      {} as never
    );

    const proposal = await spawner.createBuildRunChangeProposal(createTask(), "run-1", root, {
      fromRef: "abc123",
      diff: "diff --git a/src/example.ts b/src/example.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/example.ts"],
      diffTruncated: false,
      toRef: "def456789",
      alreadyApplied: true
    });

    assert.equal(createdStatus, "applied");
    assert.equal(proposal?.status, "applied");
    assert.equal(logs.some((line) => line.includes("marked applied because the agent already created local commit def4567")), true);
  });

  it("ignores incomplete trailing raw JSON events during live timeline parsing", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-raw-events-"));
    const rawEventsPath = path.join(root, "events.jsonl");
    await writeFile(
      rawEventsPath,
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        "{\"type\":\"turn.started\""
      ].join("\n"),
      "utf8"
    );

    const liveEvents = await spawnerAny.readRunTimelineEvents(createTask(), rawEventsPath, {
      includeTrailingPartialLine: false
    });
    assert.equal(liveEvents.length, 1);
    assert.equal(liveEvents[0]?.kind, "run.started");

    const finalEvents = await spawnerAny.readRunTimelineEvents(createTask(), rawEventsPath, {
      includeTrailingPartialLine: true
    });
    assert.equal(finalEvents.length, 2);
    assert.equal(finalEvents[1]?.title, "Invalid JSON event");
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

  it("formats workspace preparation failures with git error details", async () => {
    const spawner = createSpawner();
    const spawnerAny = spawner as any;
    const task = createTask();

    spawnerAny.resolveWorkspacePath = () => "/tmp/workspace";
    spawnerAny.cloneWorkspaceFromSource = async () => {
      throw new Error("fatal: repository 'https://secret-token@github.com/example/missing.git/' not found");
    };
    spawnerAny.classifyWorkspacePrepareFailure = () => "auth";

    await assert.rejects(
      async () => {
        await spawnerAny.prepareWorkspace(task, "build", "feature/task-1", "/repo-cache/path", "clone_only");
      },
      (error: unknown) => {
        const message = spawnerAny.formatWorkspacePrepareErrorMessage(error);
        assert.match(message, /Workspace setup failed: repository access was denied/);
        assert.match(message, /Git error:/);
        assert.match(message, /fatal: repository 'https:\/\/<redacted>@github\.com\/example\/missing\.git\/' not found/);
        assert.doesNotMatch(message, /secret-token/);
        return true;
      }
    );
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
    const originalRuntimePayloadRoot = env.RUNTIME_PAYLOAD_ROOT;
    env.RUNTIME_PAYLOAD_ROOT = path.join(root, "runtime-payloads");
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
      anthropicBaseUrl: null,
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

    try {
      await spawner.runTaskPostflight(task);
      assert.equal(workspaceKindSeen, "clone");
    } finally {
      env.RUNTIME_PAYLOAD_ROOT = originalRuntimePayloadRoot;
    }
  });
});
