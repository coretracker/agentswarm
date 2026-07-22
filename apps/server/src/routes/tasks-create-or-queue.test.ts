import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import Fastify from "fastify";
import { registerTaskRoutes } from "./tasks.js";

const user = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  githubUsername: "ada",
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
  roles: [],
  repositoryIds: ["repo-1"],
  lastLoginAt: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  scopes: ["repo:list", "repo:read", "task:create", "task:edit", "task:build", "task:read"],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: []
};

const repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/acme/repo.git",
  defaultBranch: "main"
};

const openTask = {
  id: "task-1",
  ownerUserId: "user-1",
  repoId: "repo-1",
  status: "open",
  workflowStatus: "ready",
  executionStatus: "idle",
  executionAction: null,
  taskType: "build",
  provider: "codex",
  providerProfile: "high",
  modelOverride: null,
  codexCredentialSource: "auto",
  title: "Fix CI",
  prompt: "Fix CI",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z"
};

const buildDeps = (overrides: Record<string, unknown> = {}) => {
  const authUser = { ...user, scopes: overrides.scopes ?? user.scopes };
  const calls: Record<string, unknown[]> = {
    appendedMessages: [],
    linkedTargets: [],
    triggerNextPendingAction: [],
    triggerAction: [],
    createdTasks: [],
    patchedTasks: []
  };
  const taskStore = {
    findTaskByExternalTarget: async () => ("existingTask" in overrides ? overrides.existingTask : openTask),
    findTaskByGitHubPrNumber: async () => null,
    findTaskByGitHubIssueNumber: async () => null,
    linkTaskExternalTarget: async (...args: unknown[]) => {
      calls.linkedTargets.push(args);
    },
    listMessages: async () => overrides.messages ?? [],
    appendMessage: async (_taskId: string, input: unknown) => {
      calls.appendedMessages.push(input);
      return { id: "message-1", content: (input as { content: string }).content };
    },
    hasPendingChangeProposal: async () => false,
    getActiveInteractiveSession: async () => null,
    createTask: async (input: unknown) => {
      calls.createdTasks.push(input);
      return { ...openTask, id: "task-created", status: "draft", ownerUserId: "user-1" };
    },
    patchTask: async (_taskId: string, patch: unknown) => {
      calls.patchedTasks.push(patch);
      return { ...openTask, id: "task-created", ...(patch as Record<string, unknown>) };
    },
    setExecutionState: async (taskId: string, executionStatus: string, extra: unknown) => ({
      ...openTask,
      id: taskId,
      executionStatus,
      ...(extra as Record<string, unknown>)
    }),
    getTask: async (taskId: string) => ({ ...openTask, id: taskId }),
    appendLog: async () => undefined
  };
  return {
    calls,
    deps: {
      auth: {
        authenticateBearerToken: async (token: string | null) =>
          token === "pat"
            ? {
                user: authUser,
                scopes: new Set(authUser.scopes as string[]),
                sessionToken: "",
                expiresAt: "2027-07-13T00:00:00.000Z",
                session: { user: authUser, expiresAt: "2027-07-13T00:00:00.000Z" }
              }
            : null,
        requireAllScopes: () => async () => undefined,
        requireAuth: () => async () => undefined
      },
      repositoryStore: {
        getRepository: async () => repository
      },
      settingsStore: {
        getSettings: async () => ({
          defaultProvider: "codex",
          codexDefaultEffort: "high",
          codexDefaultModel: "gpt-5.5",
          claudeDefaultEffort: "high",
          claudeDefaultModel: "claude-opus-4-8"
        })
      },
      taskStore,
      scheduler: {
        triggerNextPendingAction: async (...args: unknown[]) => {
          calls.triggerNextPendingAction.push(args);
          return true;
        },
        triggerAction: async (...args: unknown[]) => {
          calls.triggerAction.push(args);
          return true;
        }
      },
      spawner: {
        prepareTaskWorkspaceOnly: async () => undefined,
        getTaskBranchSyncCounts: async () => ({ pullCount: 0, pushCount: 0 })
      },
      taskQueueStore: {},
      userStore: {}
    }
  };
};

const injectCreateOrQueue = async (overrides: Record<string, unknown> = {}) => {
  const app = Fastify();
  const built = buildDeps(overrides);
  registerTaskRoutes(app, built.deps as never);
  const response = await app.inject({
    method: "POST",
    url: "/tasks/create-or-queue",
    headers: {
      authorization: "Bearer pat"
    },
    payload: {
      repoId: "repo-1",
      target: { type: "github_pr", id: "123" },
      task: {
        title: "Fix PR #123 CI",
        message: "npm run ci failed. Fix it.",
        action: "build",
        workOnBranch: true
      },
      dedupeKey: "github-actions:acme/repo:1:1:test"
    }
  });
  await setImmediate();
  await app.close();
  return { response, ...built };
};

test("create-or-queue appends a queued message to an existing external target task", async () => {
  const { response, calls } = await injectCreateOrQueue();

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    taskId: "task-1",
    messageId: "message-1",
    createdTask: false,
    queuedMessage: true,
    deduped: false
  });
  assert.deepEqual(calls.linkedTargets, [["task-1", "repo-1", "github_pr", "123"]]);
  assert.deepEqual(calls.appendedMessages, [
    {
      role: "user",
      action: "build",
      queueState: "pending",
      queueSource: "user",
      externalId: "github-actions:acme/repo:1:1:test",
      content: "npm run ci failed. Fix it."
    }
  ]);
  assert.deepEqual(calls.triggerNextPendingAction, [["task-1", "manual"]]);
});

test("create-or-queue creates and starts a task when no external target task exists", async () => {
  const { response, calls } = await injectCreateOrQueue({ existingTask: null });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    taskId: "task-created",
    messageId: "message-1",
    createdTask: true,
    queuedMessage: true,
    deduped: false
  });
  assert.equal(calls.createdTasks.length, 1);
  assert.deepEqual(calls.linkedTargets, [["task-created", "repo-1", "github_pr", "123"]]);
  assert.equal(calls.triggerAction.length, 1);
});

test("create-or-queue dedupes repeated external events", async () => {
  const { response, calls } = await injectCreateOrQueue({
    messages: [{ id: "message-existing", externalId: "github-actions:acme/repo:1:1:test" }]
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    taskId: "task-1",
    messageId: "message-existing",
    createdTask: false,
    queuedMessage: false,
    deduped: true
  });
  assert.deepEqual(calls.appendedMessages, []);
});

test("create-or-queue requires task:create when the target has no task", async () => {
  const { response } = await injectCreateOrQueue({
    existingTask: null,
    scopes: ["repo:list", "repo:read", "task:edit", "task:build", "task:read"]
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { message: "Task create access is required." });
});
