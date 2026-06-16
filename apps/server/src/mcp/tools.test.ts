import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSessionUser, Repository, Task } from "@agentswarm/shared-types";
import { createMcpTools } from "./tools.js";

const user: AuthSessionUser = {
      id: "user-1",
      name: "User",
      email: "user@example.com",
  gitAuthorName: null,
  gitAuthorEmail: null,
      active: true,
      agentResponsePreference: {},
      roles: [],
      repositoryIds: ["repo-1", "repo-2"],
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scopes: ["repo:list", "task:list", "task:read", "task:create", "task:edit", "task:build", "task:ask"],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: []
};

const repository: Repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/example/repo.git",
  defaultBranch: "main",
  envVars: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Task",
    deadline: null,
    pinned: false,
    hasPendingCheckpoint: false,
    autoApplyCheckpoints: false,
    activeInteractiveSession: false,
    activeTerminalSessionMode: null,
    ownerUserId: "user-1",
    creatorName: null,
    repoId: "repo-1",
    repoName: "Repo",
    repoUrl: repository.url,
    repoDefaultBranch: "main",
    attachedRepositories: [],
    taskType: "build",
    provider: "codex",
    providerProfile: "high",
    modelOverride: "gpt-5.5",
    codexCredentialSource: "auto",
    baseBranch: "main",
    branchStrategy: "feature_branch",
    complexity: "normal",
    branchName: null,
    workspaceBaseRef: null,
    prompt: "Do work",
    notes: "",
    executionSummary: "Do work",
    resultMarkdown: null,
    branchDiff: null,
    status: "draft",
    workflowStatus: "backlog",
    executionStatus: "idle",
    executionAction: null,
    reviewReason: null,
    logs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    lastAction: "build",
    enqueued: false,
    ...overrides
  }) satisfies Task as Task;

const toolByName = (name: string) => {
  const tool = createMcpTools().find((candidate) => candidate.name === name);
  assert.ok(tool, `Missing tool ${name}`);
  return tool;
};

describe("MCP Phase 1 tools", () => {
  it("lists only repositories accessible to the user", async () => {
    const tool = toolByName("agentswarm_list_repositories");
    const result = await tool.handler(
      {},
      {
        user,
        deps: {
          repositoryStore: {
            listRepositories: async () => [
              repository,
              {
                ...repository,
                id: "repo-2",
                name: "Private"
              }
            ]
          },
          githubImportService: {} as never,
          settingsStore: {} as never,
          taskStore: {} as never,
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.deepEqual(result, {
      repositories: [
        {
          id: "repo-1",
          name: "Repo",
          url: "https://github.com/example/repo.git",
          defaultBranch: "main",
          webhookEnabled: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "repo-2",
          name: "Private",
          url: "https://github.com/example/repo.git",
          defaultBranch: "main",
          webhookEnabled: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    });
  });

  it("lists repository branches with branch strategy guidance", async () => {
    const tool = toolByName("agentswarm_list_repository_branches");
    const result = await tool.handler(
      {
        repoId: "repo-1",
        query: "dev"
      },
      {
        user,
        deps: {
          repositoryStore: {
            getRepository: async () => repository
          },
          githubImportService: {
            listBranches: async () => [
              { name: "main", isDefault: true },
              { name: "develop", isDefault: false }
            ]
          },
          settingsStore: {} as never,
          taskStore: {} as never,
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.deepEqual(result, {
      repository: {
        id: "repo-1",
        name: "Repo",
        url: "https://github.com/example/repo.git",
        defaultBranch: "main",
        webhookEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      branches: [{ name: "develop", isDefault: false }],
      branchStrategies: [
        {
          value: "feature_branch",
          description: "Create a new task branch from baseBranch."
        },
        {
          value: "work_on_branch",
          description: "Check out and work directly on baseBranch."
        }
      ],
      createTaskDefaults: {
        baseBranch: "main",
        branchStrategy: "feature_branch"
      }
    });
  });

  it("creates draft tasks by default and stores an initial user message", async () => {
    const tool = toolByName("agentswarm_create_task");
    const messages: unknown[] = [];
    let createdInput: unknown = null;
    const task = createTask();

    const result = await tool.handler(
      {
        title: "Task",
        repoId: "repo-1",
        prompt: "Do work"
      },
      {
        user,
        deps: {
          repositoryStore: {
            getRepository: async () => repository
          },
          githubImportService: {} as never,
          settingsStore: {
            getSettings: async () => ({
              defaultProvider: "codex",
              codexDefaultEffort: "high",
              claudeDefaultEffort: "high",
              codexDefaultModel: "gpt-5.5",
              claudeDefaultModel: "claude-opus-4-8"
            })
          },
          taskStore: {
            createTask: async (input: unknown) => {
              createdInput = input;
              return task;
            },
            appendMessage: async (_taskId: string, input: unknown) => {
              messages.push(input);
              return null;
            },
            getTask: async () => task
          },
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.equal((createdInput as { draft?: boolean }).draft, true);
    assert.equal(messages.length, 1);
    assert.deepEqual((result as { task: { id: string; status: string } }).task, {
      id: "task-1",
      title: "Task",
      repoId: "repo-1",
      repoName: "Repo",
      attachedRepositories: [],
      taskType: "build",
      status: "draft",
      workflowStatus: "backlog",
      executionStatus: "idle",
      executionAction: null,
      reviewReason: null,
      pinned: false,
      hasPendingCheckpoint: false,
      autoApplyCheckpoints: false,
      branchName: null,
      baseBranch: "main",
      branchStrategy: "feature_branch",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("persists attached repositories when creating a task", async () => {
    const tool = toolByName("agentswarm_create_task");
    let createdInput: unknown = null;
    const task = createTask();

    await tool.handler(
      {
        title: "Task",
        repoId: "repo-1",
        prompt: "Do work",
        attachedRepositories: [
          {
            repositoryId: "repo-2",
            mountName: "shared-utils",
            accessMode: "read-only",
            purpose: "Shared code"
          }
        ]
      },
      {
        user,
        deps: {
          repositoryStore: {
            getRepository: async (repositoryId: string) =>
              repositoryId === "repo-1"
                ? repository
                : {
                    ...repository,
                    id: "repo-2",
                    name: "Shared utils",
                    url: "https://github.com/example/shared-utils.git"
                  }
          },
          githubImportService: {} as never,
          settingsStore: {
            getSettings: async () => ({
              defaultProvider: "codex",
              codexDefaultEffort: "high",
              claudeDefaultEffort: "high",
              codexDefaultModel: "gpt-5.5",
              claudeDefaultModel: "claude-opus-4-8"
            })
          },
          taskStore: {
            createTask: async (input: unknown) => {
              createdInput = input;
              return task;
            },
            appendMessage: async () => null,
            getTask: async () => task
          },
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.deepEqual((createdInput as { attachedRepositories?: unknown[] }).attachedRepositories, [
      {
        repositoryId: "repo-2",
        mountName: "shared-utils",
        accessMode: "read-only",
        purpose: "Shared code"
      }
    ]);
  });

  it("resumes the next pending follow-up when a message is added to a failed task", async () => {
    const tool = toolByName("agentswarm_add_task_message");
    const task = createTask({
      status: "open",
      executionStatus: "failed",
      errorMessage: "Runtime container exited with code 1"
    });
    const messages: unknown[] = [];
    const runNextCalls: Array<{ taskId: string; reason: string }> = [];

    const result = await tool.handler(
      {
        taskId: task.id,
        action: "build",
        content: "Try the next fix"
      },
      {
        user,
        deps: {
          repositoryStore: {} as never,
          githubImportService: {} as never,
          settingsStore: {} as never,
          taskStore: {
            getTask: async () => task,
            hasPendingActionMessage: async () => false,
            hasPendingChangeProposal: async () => false,
            getActiveInteractiveSession: async () => null,
            appendMessage: async (_taskId: string, input: unknown) => {
              messages.push(input);
              return {
                id: "message-1",
                taskId: task.id,
                role: "user",
                action: "build",
                content: "Try the next fix",
                queueState: "pending",
                createdAt: "2026-01-01T00:00:00.000Z"
              };
            }
          },
          taskQueueStore: {} as never,
          scheduler: {
            triggerNextPendingAction: async (taskId: string, reason: string) => {
              runNextCalls.push({ taskId, reason });
              return true;
            }
          },
          spawner: {} as never
        } as never
      }
    );

    assert.deepEqual(messages, [
      {
        role: "user",
        action: "build",
        content: "Try the next fix",
        queueState: "pending",
        queueSource: "user"
      }
    ]);
    assert.deepEqual(runNextCalls, [{ taskId: "task-1", reason: "manual" }]);
    assert.equal((result as { messageId: string }).messageId, "message-1");
  });
});
