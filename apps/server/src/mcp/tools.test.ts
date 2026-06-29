import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSessionUser, Repository, Task } from "@agentswarm/shared-types";
import { createMcpTools } from "./tools.js";

const user: AuthSessionUser = {
  id: "user-1",
  name: "User",
  email: "user@example.com",
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
      branchStrategy: "feature_branch",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("rejects notes when creating tasks through MCP", async () => {
    const tool = toolByName("agentswarm_create_task");

    await assert.rejects(
      () =>
        tool.handler(
          {
            title: "Task",
            repoId: "repo-1",
            prompt: "Do work",
            notes: "Legacy notes"
          },
          {
            user,
            deps: {} as never
          }
        ),
      /Unrecognized key\(s\) in object: 'notes'/
    );
  });

  it("rejects notes when updating drafts through MCP", async () => {
    const tool = toolByName("agentswarm_update_draft");

    await assert.rejects(
      () =>
        tool.handler(
          {
            taskId: "task-1",
            notes: "Legacy notes"
          },
          {
            user,
            deps: {} as never
          }
        ),
      /Unrecognized key\(s\) in object: 'notes'/
    );
  });

  it("starts a task with the requested action mode", async () => {
    const tool = toolByName("agentswarm_start_task");
    const task = createTask({
      status: "open",
      workflowStatus: "ready",
      executionStatus: "idle",
      taskType: "build"
    });
    const triggered: Array<{ taskId: string; action: string; content?: string }> = [];

    await tool.handler(
      {
        taskId: task.id,
        action: "ask"
      },
      {
        user,
        deps: {
          repositoryStore: {} as never,
          settingsStore: {} as never,
          taskStore: {
            getTask: async () => task,
            listMessages: async () => [
              {
                id: "message-1",
                taskId: task.id,
                role: "user",
                action: "build",
                content: "Do work",
                attachments: [],
                queueState: null,
                queueSource: null,
                createdAt: "2026-01-01T00:00:00.000Z"
              }
            ],
            setExecutionState: async (_taskId: string, status: string) => ({
              ...task,
              executionStatus: status as Task["executionStatus"]
            }),
            appendLog: async () => undefined
          },
          taskQueueStore: {} as never,
          scheduler: {
            triggerAction: async (taskId: string, action: string, input: { content?: string }) => {
              triggered.push({ taskId, action, content: input.content });
              return true;
            }
          },
          spawner: {
            prepareTaskWorkspaceOnly: async () => task
          }
        } as never
      }
    );

    assert.deepEqual(triggered, [{ taskId: "task-1", action: "ask", content: "Do work" }]);
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
