import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSessionUser, Repository, Task } from "@verft/shared-types";
import { createMcpTools } from "./tools.js";

const user: AuthSessionUser = {
  id: "user-1",
  name: "User",
  email: "user@example.com",
  githubUsername: null,
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
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
  mcpServers: [],
  hostCommands: [],
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
    pinned: false,
    hasPendingCheckpoint: false,
    autoApplyCheckpoints: false,
    shareWithTeam: false,
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
    const tool = toolByName("verft_list_repositories");
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
    const tool = toolByName("verft_create_task");
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
      parentTaskId: null,
      rootTaskId: null,
      taskType: "build",
      status: "draft",
      workflowStatus: "backlog",
      executionStatus: "idle",
      executionAction: null,
      reviewReason: null,
      pinned: false,
      hasPendingCheckpoint: false,
      autoApplyCheckpoints: false,
      shareWithTeam: false,
      branchName: null,
      baseBranch: "main",
      branchStrategy: "feature_branch",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("resolves repository defaults before system defaults when creating tasks through MCP", async () => {
    const tool = toolByName("verft_create_task");
    let createdInput: unknown = null;

    await tool.handler(
      {
        title: "Task",
        repoId: "repo-1",
        prompt: "Do work"
      },
      {
        user,
        deps: {
          repositoryStore: {
            getRepository: async () => ({
              ...repository,
              defaultProvider: "claude",
              defaultModel: "claude-sonnet-4-6",
              defaultProviderProfile: "max"
            })
          },
          settingsStore: {
            getSettings: async () => ({
              defaultProvider: "codex",
              codexDefaultEffort: "medium",
              claudeDefaultEffort: "high",
              codexDefaultModel: "gpt-5.5",
              claudeDefaultModel: "claude-opus-4-8"
            })
          },
          taskStore: {
            createTask: async (input: unknown) => {
              createdInput = input;
              return createTask();
            },
            appendMessage: async () => null,
            getTask: async () => createTask()
          },
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.equal((createdInput as { provider: string }).provider, "claude");
    assert.equal((createdInput as { providerProfile: string }).providerProfile, "max");
    assert.equal((createdInput as { modelOverride: string }).modelOverride, "claude-sonnet-4-6");
  });

  it("lets an owner change task sharing through MCP", async () => {
    const tool = toolByName("verft_update_task_sharing");
    const task = createTask({ shareWithTeam: false });
    let patch: unknown = null;

    const result = await tool.handler(
      { taskId: task.id, shareWithTeam: true },
      {
        user: { ...user, teamId: "team-1", scopes: ["task:edit"] },
        deps: {
          taskStore: {
            getTask: async () => task,
            patchTask: async (_taskId: string, nextPatch: unknown) => {
              patch = nextPatch;
              return { ...task, ...(nextPatch as object) };
            }
          },
          userStore: {
            getUser: async () => ({ id: "user-1", teamId: "team-1" })
          },
          repositoryStore: {} as never,
          settingsStore: {} as never,
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.deepEqual(patch, { shareWithTeam: true });
    assert.equal((result as { task: { shareWithTeam: boolean } }).task.shareWithTeam, true);
  });

  it("creates runtime subtasks for the current task repository and links the parent", async () => {
    const tool = toolByName("verft_create_subtask");
    const parentTask = createTask({
      id: "parent-task",
      repoId: "repo-1",
      rootTaskId: null,
      parentTaskId: null
    });
    const childTask = createTask({
      id: "child-task",
      parentTaskId: "parent-task",
      rootTaskId: "parent-task"
    });
    const messages: unknown[] = [];
    let createdInput: unknown = null;

    const result = await tool.handler(
      {
        title: "Child task",
        repoId: "repo-1",
        prompt: "Do focused work"
      },
      {
        user,
        runtimeContext: { taskId: parentTask.id },
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
            getTask: async (taskId: string) => (taskId === parentTask.id ? parentTask : childTask),
            createTask: async (input: unknown) => {
              createdInput = input;
              return childTask;
            },
            appendMessage: async (_taskId: string, input: unknown) => {
              messages.push(input);
              return null;
            }
          },
          taskQueueStore: {} as never,
          scheduler: {} as never,
          spawner: {} as never
        } as never
      }
    );

    assert.equal((createdInput as { parentTaskId?: string }).parentTaskId, "parent-task");
    assert.equal((createdInput as { rootTaskId?: string }).rootTaskId, "parent-task");
    assert.deepEqual(messages, [
      {
        role: "user",
        action: "build",
        content: "Do focused work"
      }
    ]);
    assert.equal((result as { parentTaskId: string }).parentTaskId, "parent-task");
    assert.equal((result as { rootTaskId: string }).rootTaskId, "parent-task");
    assert.equal((result as { task: { id: string } }).task.id, "child-task");
  });

  it("rejects runtime subtasks for repositories outside the current task repository", async () => {
    const tool = toolByName("verft_create_subtask");
    const parentTask = createTask({ id: "parent-task", repoId: "repo-1" });
    const otherRepository = {
      ...repository,
      id: "repo-2",
      name: "Other"
    };
    const multiRepoUser = {
      ...user,
      repositoryIds: ["repo-1", "repo-2"]
    };

    await assert.rejects(
      () =>
        tool.handler(
          {
            title: "Child task",
            repoId: "repo-2",
            prompt: "Do other work"
          },
          {
            user: multiRepoUser,
            runtimeContext: { taskId: parentTask.id },
            deps: {
              repositoryStore: {
                getRepository: async () => otherRepository
              },
              settingsStore: {
                getSettings: async () => {
                  throw new Error("settings should not be read");
                }
              },
              taskStore: {
                getTask: async () => parentTask,
                createTask: async () => {
                  throw new Error("subtask should not be created");
                }
              },
              taskQueueStore: {} as never,
              scheduler: {} as never,
              spawner: {} as never
            } as never
          }
        ),
      /Repository not found/
    );
  });

  it("exposes subtask creation only inside runtime task contexts", () => {
    const tool = toolByName("verft_create_subtask");

    assert.deepEqual(tool.scopes, ["task:create_subtask", "repo:list"]);
    assert.equal(
      tool.available?.({
        user,
        deps: {} as never,
        runtimeContext: null
      }),
      false
    );
    assert.equal(
      tool.available?.({
        user,
        deps: {} as never,
        runtimeContext: { taskId: "task-1" }
      }),
      true
    );
  });

  it("starts a task with the requested action mode", async () => {
    const tool = toolByName("verft_start_task");
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
    const tool = toolByName("verft_add_task_message");
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

  it("only exposes Slack replies inside a runtime task context", () => {
    const tool = toolByName("verft_reply_slack_thread");

    assert.equal(
      tool.available?.({
        user,
        deps: {} as never,
        runtimeContext: null
      }),
      false
    );
    assert.equal(
      tool.available?.({
        user,
        deps: {} as never,
        runtimeContext: { taskId: "task-1" }
      }),
      true
    );
  });

  it("replies to the Slack thread linked to the runtime task", async () => {
    const tool = toolByName("verft_reply_slack_thread");
    const task = createTask({
      slackChannelId: "C12345",
      slackThreadTs: "1783406472.567799"
    });
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const result = await tool.handler(
        {
          text: "Handled this in Slack."
        },
        {
          user,
          runtimeContext: { taskId: task.id },
          deps: {
            repositoryStore: {},
            settingsStore: {
              getRuntimeCredentials: async () => ({ slackBotToken: "xoxb-token" })
            },
            taskStore: {
              getTask: async () => task
            },
            taskQueueStore: {} as never,
            scheduler: {} as never,
            spawner: {} as never
          } as never
        }
      );

      assert.deepEqual(result, {
        ok: true,
        channelId: "C12345",
        threadTs: "1783406472.567799"
      });
      assert.equal(fetchCalls[0]?.url, "https://slack.com/api/chat.postMessage");
      assert.deepEqual(JSON.parse(String(fetchCalls[0]?.init.body)), {
        channel: "C12345",
        thread_ts: "1783406472.567799",
        text: "Handled this in Slack."
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
