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
  repositoryIds: ["repo-1"],
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
        }
      ]
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
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });
});
