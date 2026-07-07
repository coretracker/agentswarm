import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { registerSlackWebhookRoutes } from "./slack-webhooks.js";

const addJsonParser = (app: FastifyInstance): void => {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request: FastifyRequest, body: string | Buffer, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
};

const signSlackPayload = (body: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000))): Record<string, string> => ({
  "x-slack-request-timestamp": timestamp,
  "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`
});

const defaultSettingsStore = {
  getSettings: async () => ({
    defaultProvider: "codex",
    codexDefaultEffort: "high",
    codexDefaultModel: "gpt-5.5",
    claudeDefaultEffort: "high",
    claudeDefaultModel: "claude-opus-4-8"
  })
};

const defaultSpawner = {
  prepareTaskWorkspaceOnly: async () => undefined
};

const installSlackFetchMock = (calls: Array<{ url: string; init: RequestInit }>): (() => void) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
};

test("Slack webhook creates a task from a root app mention", async () => {
  const app = Fastify();
  addJsonParser(app);

  const secret = "slack-secret";
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const restoreFetch = installSlackFetchMock(fetchCalls);
  const createdTasks: unknown[] = [];
  const patchedTasks: unknown[] = [];
  const appendedMessages: unknown[] = [];
  const triggeredActions: unknown[] = [];

  try {
    registerSlackWebhookRoutes(app, {
      repositoryStore: {
        getRepository: async () => ({
          id: "repo-1",
          name: "Web",
          defaultBranch: "develop",
          slackChannelId: "C12345",
          slackTaskOwnerUserId: "user-1"
        }),
        getRepositorySlackSecrets: async () => ({ signingSecret: secret, botToken: "xoxb-token" })
      } as never,
      taskStore: {
        findTaskBySlackThread: async () => null,
        createTask: async (input: unknown) => {
          createdTasks.push(input);
          return { id: "task-1" };
        },
        patchTask: async (_taskId: string, patch: unknown) => {
          patchedTasks.push(patch);
          return {
            id: "task-1",
            taskType: "build",
            executionStatus: "idle",
            slackChannelId: "C12345",
            slackThreadTs: "111.222"
          };
        },
        appendMessage: async (_taskId: string, input: unknown) => {
          appendedMessages.push(input);
          return { id: "message-1", content: (input as { content: string }).content };
        },
        setExecutionState: async () => ({ id: "task-1" }),
        getTask: async () => ({ id: "task-1" }),
        appendLog: async () => undefined
      } as never,
      scheduler: {
        triggerAction: async (...args: unknown[]) => {
          triggeredActions.push(args);
          return true;
        }
      } as never,
      settingsStore: defaultSettingsStore as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "app_mention",
        channel: "C12345",
        user: "U111",
        ts: "111.222",
        text: "<@UVERFT> fix login"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/slack/events/repo-1",
      headers: {
        "content-type": "application/json",
        ...signSlackPayload(payload, secret)
      },
      payload
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.statusCode, 202);
    assert.equal(createdTasks.length, 1);
    assert.deepEqual(patchedTasks[0], {
      slackChannelId: "C12345",
      slackThreadTs: "111.222",
      status: "open",
      workflowStatus: "ready",
      executionStatus: "idle",
      executionAction: "build",
      lastAction: "build"
    });
    assert.equal((appendedMessages[0] as { queueSource: string }).queueSource, "slack_thread");
    assert.equal((appendedMessages[0] as { externalId: string }).externalId, "slack:message:T123:C12345:111.222");
    assert.equal(triggeredActions.length, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, "https://slack.com/api/chat.postMessage");
  } finally {
    restoreFetch();
  }
});

test("Slack webhook queues thread feedback while task is running", async () => {
  const app = Fastify();
  addJsonParser(app);

  const secret = "slack-secret";
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const restoreFetch = installSlackFetchMock(fetchCalls);
  const appendedMessages: unknown[] = [];
  const triggeredActions: unknown[] = [];

  try {
    registerSlackWebhookRoutes(app, {
      repositoryStore: {
        getRepository: async () => ({
          id: "repo-1",
          name: "Web",
          defaultBranch: "develop",
          slackChannelId: "C12345"
        }),
        getRepositorySlackSecrets: async () => ({ signingSecret: secret, botToken: "xoxb-token" })
      } as never,
      taskStore: {
        findTaskBySlackThread: async () => ({
          id: "task-1",
          executionStatus: "running"
        }),
        listMessages: async () => [],
        appendMessage: async (_taskId: string, input: unknown) => {
          appendedMessages.push(input);
          return { id: "message-1", content: (input as { content: string }).content };
        },
        hasPendingChangeProposal: async () => false
      } as never,
      scheduler: {
        triggerAction: async (...args: unknown[]) => {
          triggeredActions.push(args);
          return true;
        },
        triggerNextPendingAction: async () => true
      } as never,
      settingsStore: defaultSettingsStore as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        channel: "C12345",
        user: "U111",
        ts: "222.333",
        thread_ts: "111.222",
        text: "also update the test"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/slack/events/repo-1",
      headers: {
        "content-type": "application/json",
        ...signSlackPayload(payload, secret)
      },
      payload
    });

    assert.equal(response.statusCode, 202);
    assert.equal(appendedMessages.length, 1);
    assert.equal((appendedMessages[0] as { queueState: string }).queueState, "pending");
    assert.equal((appendedMessages[0] as { queueSource: string }).queueSource, "slack_thread");
    assert.equal(triggeredActions.length, 0);
    assert.match(String(fetchCalls[0]?.init.body), /currently working/);
  } finally {
    restoreFetch();
  }
});
