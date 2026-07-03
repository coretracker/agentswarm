import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import type { User } from "@verft/shared-types";
import { registerSlackEventRoutes } from "./slack-events.js";
import type { SlackAssistantRuntime } from "../services/slack-assistant-service.js";
import type {
  SlackAssistantActiveRuntime,
  SlackAssistantConversation,
  SlackAssistantConversationInput,
  SlackAssistantStore,
  SlackAssistantTurn
} from "../services/slack-assistant-store.js";

const now = "2026-07-01T00:00:00.000Z";
const signingSecret = "slack-signing-secret";

const user: User = {
  id: "user-1",
  name: "User One",
  email: "user@example.com",
  githubUsername: null,
  slackUsername: "alice",
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
  agentResponsePreference: {},
  roles: [],
  repositoryIds: [],
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now
};

class MemorySlackAssistantStore implements SlackAssistantStore {
  conversations = new Map<string, SlackAssistantConversation>();

  async getOrCreateConversation(input: SlackAssistantConversationInput): Promise<SlackAssistantConversation> {
    const id = `${input.slackTeamId}:${input.slackChannelId}:${input.slackUserId}`;
    const current = this.conversations.get(id);
    if (current) {
      return current;
    }
    const conversation: SlackAssistantConversation = {
      id,
      repositoryId: null,
      userId: input.userId,
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      slackUserId: input.slackUserId,
      provider: input.provider ?? "codex",
      turns: [],
      activeRuntime: null,
      createdAt: now,
      updatedAt: now
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  async appendTurn(conversationId: string, turn: SlackAssistantTurn): Promise<SlackAssistantConversation | null> {
    const current = this.conversations.get(conversationId);
    if (!current) {
      return null;
    }
    const next = { ...current, turns: [...current.turns, turn], updatedAt: turn.at };
    this.conversations.set(conversationId, next);
    return next;
  }

  async updateActiveRuntime(
    conversationId: string,
    activeRuntime: SlackAssistantActiveRuntime | null
  ): Promise<SlackAssistantConversation | null> {
    const current = this.conversations.get(conversationId);
    if (!current) {
      return null;
    }
    const next = { ...current, activeRuntime, updatedAt: now };
    this.conversations.set(conversationId, next);
    return next;
  }
}

const sign = (payload: string, timestamp = String(Math.floor(Date.now() / 1000))): Record<string, string> => ({
  "x-slack-request-timestamp": timestamp,
  "x-slack-signature": `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${payload}`).digest("hex")}`
});

const waitForBackgroundWork = async (ms = 0): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const createApp = (
  runtime: SlackAssistantRuntime = {
    respond: async (input) => `Reply to ${input.user.slackUsername}: ${input.text}`
  },
  slackUploadRoot?: string
) => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const reactions: Array<{ channel: string; timestamp: string; name: string }> = [];
  const slackEvents: Array<{ status: string; eventType?: string | null; errorMessage?: string | null }> = [];
  let profileLookups = 0;
  const store = new MemorySlackAssistantStore();
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "claude",
        slackAssistantModel: "claude-sonnet-4-6",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async (input: { status: string; eventType?: string | null; errorMessage?: string | null }) => {
        slackEvents.push(input);
      }
    } as never,
    userStore: {
      listUsers: async () => [user],
      getAuthSessionUser: async (userId: string) =>
        userId === user.id
          ? ({
              ...user,
              scopes: ["repo:list", "repo:read", "task:list", "task:read", "task:create", "task:build", "task:ask"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: []
            } as never)
          : null
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => {
        profileLookups += 1;
        return { id: "U1", name: "Alice" };
      },
      postMessage: async (_botToken, channel, text) => {
        posts.push({ channel, text });
      },
      addReaction: async (_botToken, channel, timestamp, name) => {
        reactions.push({ channel, timestamp, name });
      },
      downloadFile: async () => Buffer.from("")
    },
    runtime,
    slackUploadRoot
  });
  return { app, posts, reactions, slackEvents, store, getProfileLookups: () => profileLookups };
};

const createAppWithUsers = (users: User[]) => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const reactions: Array<{ channel: string; timestamp: string; name: string }> = [];
  const slackEvents: Array<{ status: string; eventType?: string | null; errorMessage?: string | null }> = [];
  let profileLookups = 0;
  const store = new MemorySlackAssistantStore();
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "codex",
        slackAssistantModel: "gpt-5.5",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async (input: { status: string; eventType?: string | null; errorMessage?: string | null }) => {
        slackEvents.push(input);
      }
    } as never,
    userStore: {
      listUsers: async () => users,
      getAuthSessionUser: async (userId: string) => {
        const matched = users.find((entry) => entry.id === userId && entry.active);
        if (!matched) {
          return null;
        }
        return {
          ...matched,
          scopes: ["repo:list", "repo:read", "task:list", "task:read", "task:create", "task:build", "task:ask"],
          allowedProviders: [],
          allowedModels: [],
          allowedEfforts: []
        } as never;
      }
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => {
        profileLookups += 1;
        return { id: "U1", name: "Alice" };
      },
      postMessage: async (_botToken, channel, text) => {
        posts.push({ channel, text });
      },
      addReaction: async (_botToken, channel, timestamp, name) => {
        reactions.push({ channel, timestamp, name });
      },
      downloadFile: async () => Buffer.from("")
    },
    runtime: {
      respond: async () => "Reply by id"
    }
  });
  return { app, posts, reactions, slackEvents, store, getProfileLookups: () => profileLookups };
};

test("Slack event route responds to URL verification", async () => {
  const { app, slackEvents } = createApp();
  const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { challenge: "challenge-token" });
  assert.equal(slackEvents.at(-1)?.status, "received");
  assert.equal(slackEvents.at(-1)?.eventType, "url_verification");
  await app.close();
});

test("Slack event route maps a DM to a profile, reacts, and posts runtime response", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const { app, posts, reactions, slackEvents, store } = createApp(undefined, uploadRoot);
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "1710000000.000100",
      text: "hello"
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork();
  assert.deepEqual(reactions, [{ channel: "D1", timestamp: "1710000000.000100", name: "eyes" }]);
  assert.deepEqual(posts, [{ channel: "D1", text: "Reply to alice: hello" }]);
  assert.equal(slackEvents.at(-1)?.status, "received");
  assert.equal(slackEvents.at(-1)?.eventType, "message.im");
  assert.equal(Array.from(store.conversations.values())[0]?.provider, "claude");
  assert.equal(Array.from(store.conversations.values())[0]?.turns.length, 2);
  await app.close();
});

test("Slack event route replies with busy message when a conversation is already active", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const { app, posts, slackEvents, store } = createApp(undefined, uploadRoot);
  const conversation = await store.getOrCreateConversation({
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "claude"
  });
  await store.updateActiveRuntime(conversation.id, {
    provider: "claude",
    status: "active",
    containerName: "verft-slack-active",
    startedAt: new Date().toISOString(),
    lastUserMessageAt: new Date().toISOString(),
    stoppedAt: null,
    stopReason: null
  });
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "second question"
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, ignored: "assistant_busy" });
  assert.deepEqual(posts, [
    {
      channel: "D1",
      text: "I'm still working on your previous message. Please wait until I'm done, then send your next question."
    }
  ]);
  assert.equal(slackEvents.at(-1)?.status, "ignored");
  assert.equal(slackEvents.at(-1)?.errorMessage, "assistant_busy");
  assert.equal((await store.getOrCreateConversation({
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "claude"
  })).turns.length, 0);
  await app.close();
});

test("Slack event route stops an active run on exact /stop command", async () => {
  let stopCalls = 0;
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const { app, posts, slackEvents, store } = createApp({
    respond: async () => {
      throw new Error("unexpected respond");
    },
    stop: async (conversation) => {
      stopCalls += 1;
      await store.updateActiveRuntime(conversation.id, {
        ...conversation.activeRuntime!,
        status: "stopped",
        containerName: null,
        stoppedAt: new Date().toISOString(),
        stopReason: "cancelled"
      });
      return true;
    }
  }, uploadRoot);
  const conversation = await store.getOrCreateConversation({
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "claude"
  });
  await store.updateActiveRuntime(conversation.id, {
    provider: "claude",
    status: "active",
    containerName: "verft-slack-active",
    startedAt: new Date().toISOString(),
    lastUserMessageAt: new Date().toISOString(),
    stoppedAt: null,
    stopReason: null
  });
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "  /stop  "
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, ignored: "assistant_stopped" });
  assert.equal(stopCalls, 1);
  assert.deepEqual(posts, [{ channel: "D1", text: "Stopped the current Slack assistant run. You can send a new question now." }]);
  assert.equal(slackEvents.at(-1)?.status, "ignored");
  assert.equal(slackEvents.at(-1)?.errorMessage, "assistant_stopped");
  assert.equal((await store.getOrCreateConversation({
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "claude"
  })).activeRuntime?.stopReason, "cancelled");
  await app.close();
});

test("Slack event route treats non-exact stop text as a normal message", async () => {
  let stopCalls = 0;
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const { app, posts } = createApp({
    respond: async (input) => `Reply to ${input.text}`,
    stop: async () => {
      stopCalls += 1;
      return true;
    }
  }, uploadRoot);
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "/stop now"
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork();
  assert.equal(stopCalls, 0);
  assert.deepEqual(posts, [{ channel: "D1", text: "Reply to /stop now" }]);
  await app.close();
});

test("Slack event route replies with setup message when no active profile matches", async () => {
  const { app, posts, slackEvents, store } = createAppWithUsers([{ ...user, active: false }]);
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "hello"
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(posts, [{ channel: "D1", text: "I could not find an active Verft profile with this Slack username." }]);
  assert.equal(slackEvents.at(-1)?.status, "ignored");
  assert.equal(slackEvents.at(-1)?.errorMessage, "unmatched_user");
  assert.equal(store.conversations.size, 0);
  await app.close();
});

test("Slack event route matches a user by Slack user ID without profile lookup", async () => {
  const { app, posts, getProfileLookups } = createAppWithUsers([{ ...user, slackUsername: "U1" }]);
  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "hello"
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork();
  assert.equal(getProfileLookups(), 0);
  assert.deepEqual(posts, [{ channel: "D1", text: "Reply by id" }]);
  await app.close();
});

test("Slack event route returns signature_mismatch for bad signature", async () => {
  const { app, slackEvents } = createApp();
  const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=bad" },
    payload
  });

  assert.equal(response.statusCode, 401);
  assert.equal(slackEvents.at(-1)?.status, "failed");
  assert.equal(slackEvents.at(-1)?.errorMessage, "signature_mismatch");
  await app.close();
});

test("Slack event route returns missing_headers when signature headers are absent", async () => {
  const { app, slackEvents } = createApp();
  const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json" },
    payload
  });

  assert.equal(response.statusCode, 401);
  assert.equal(slackEvents.at(-1)?.status, "failed");
  assert.equal(slackEvents.at(-1)?.errorMessage, "missing_headers");
  await app.close();
});

test("Slack event route returns timestamp_invalid when timestamp is not numeric", async () => {
  const { app, slackEvents } = createApp();
  const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload, "abc") },
    payload
  });

  assert.equal(response.statusCode, 401);
  assert.equal(slackEvents.at(-1)?.status, "failed");
  assert.equal(slackEvents.at(-1)?.errorMessage, "timestamp_invalid");
  await app.close();
});

test("Slack event route returns timestamp_skew when timestamp is too old", async () => {
  const { app, slackEvents } = createApp();
  const payload = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 700);
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload, oldTimestamp) },
    payload
  });

  assert.equal(response.statusCode, 401);
  assert.equal(slackEvents.at(-1)?.status, "failed");
  assert.equal(slackEvents.at(-1)?.errorMessage, "timestamp_skew");
  await app.close();
});

test("Slack event route persists text file to filesystem and passes local path to runtime", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const capturedInputs: Array<{ text: string; fileAttachments?: Array<{ name: string; localPath: string; mimetype: string }> }> = [];
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const store = new MemorySlackAssistantStore();
  const fileContent = Buffer.from("error: something went wrong\n");
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "claude",
        slackAssistantModel: "claude-sonnet-4-6",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async () => {}
    } as never,
    userStore: {
      listUsers: async () => [user],
      getAuthSessionUser: async (userId: string) =>
        userId === user.id
          ? ({
              ...user,
              scopes: ["repo:list"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: []
            } as never)
          : null
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => ({ id: "U1", name: "Alice" }),
      postMessage: async (_botToken, channel, text) => { posts.push({ channel, text }); },
      addReaction: async () => {},
      downloadFile: async (_botToken, fileUrl) => {
        assert.equal(fileUrl, "https://files.slack.com/files-pri/T1/F1/log.txt");
        return fileContent;
      }
    },
    runtime: {
      respond: async (input) => {
        capturedInputs.push({ text: input.text, fileAttachments: input.fileAttachments });
        return "Got your file";
      }
    },
    slackUploadRoot: uploadRoot
  });

  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "1710000000.000200",
      text: "check this log",
      files: [
        {
          id: "F1",
          name: "log.txt",
          mimetype: "text/plain",
          size: 26,
          url_private: "https://files.slack.com/files-pri/T1/F1/log.txt",
          url_private_download: "https://files.slack.com/files-pri/T1/F1/log.txt"
        }
      ]
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork(50);
  assert.deepEqual(posts, [{ channel: "D1", text: "Got your file" }]);
  assert.equal(capturedInputs.length, 1);
  assert.equal(capturedInputs[0]?.text, "check this log");
  assert.equal(capturedInputs[0]?.fileAttachments?.length, 1);
  assert.equal(capturedInputs[0]?.fileAttachments?.[0]?.name, "log.txt");
  assert.equal(capturedInputs[0]?.fileAttachments?.[0]?.mimetype, "text/plain");
  const localPath = capturedInputs[0]?.fileAttachments?.[0]?.localPath;
  assert.ok(localPath, "localPath should be set");
  assert.ok(localPath.startsWith(uploadRoot), "localPath should be under uploadRoot");
  assert.ok(localPath.endsWith("log.txt"), "localPath should end with filename");
  const writtenContent = await readFile(localPath);
  assert.deepEqual(writtenContent, fileContent);
  await app.close();
});

test("Slack event route persists image file to filesystem (binary files accepted)", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const capturedInputs: Array<{ text: string; fileAttachments?: Array<{ name: string; localPath: string; mimetype: string }> }> = [];
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const store = new MemorySlackAssistantStore();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "claude",
        slackAssistantModel: "claude-sonnet-4-6",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async () => {}
    } as never,
    userStore: {
      listUsers: async () => [user],
      getAuthSessionUser: async (userId: string) =>
        userId === user.id
          ? ({
              ...user,
              scopes: ["repo:list"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: []
            } as never)
          : null
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => ({ id: "U1", name: "Alice" }),
      postMessage: async (_botToken, channel, text) => { posts.push({ channel, text }); },
      addReaction: async () => {},
      downloadFile: async () => pngBytes
    },
    runtime: {
      respond: async (input) => {
        capturedInputs.push({ text: input.text, fileAttachments: input.fileAttachments });
        return "Got your image";
      }
    },
    slackUploadRoot: uploadRoot
  });

  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "1710000000.000300",
      text: "check this screenshot",
      files: [
        {
          id: "F2",
          name: "screenshot.png",
          mimetype: "image/png",
          size: 4,
          url_private_download: "https://files.slack.com/files-pri/T1/F2/screenshot.png"
        }
      ]
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork(50);
  assert.deepEqual(posts, [{ channel: "D1", text: "Got your image" }]);
  assert.equal(capturedInputs.length, 1);
  assert.equal(capturedInputs[0]?.fileAttachments?.length, 1);
  assert.equal(capturedInputs[0]?.fileAttachments?.[0]?.name, "screenshot.png");
  assert.equal(capturedInputs[0]?.fileAttachments?.[0]?.mimetype, "image/png");
  const localPath = capturedInputs[0]?.fileAttachments?.[0]?.localPath;
  assert.ok(localPath?.endsWith("screenshot.png"), "localPath should end with filename");
  const writtenBytes = await readFile(localPath!);
  assert.deepEqual(writtenBytes, pngBytes);
  await app.close();
});

test("Slack event route processes a file-only message with no text", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  const capturedInputs: Array<{ text: string; fileAttachments?: Array<{ name: string }> }> = [];
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const store = new MemorySlackAssistantStore();
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "claude",
        slackAssistantModel: "claude-sonnet-4-6",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async () => {}
    } as never,
    userStore: {
      listUsers: async () => [user],
      getAuthSessionUser: async (userId: string) =>
        userId === user.id
          ? ({
              ...user,
              scopes: ["repo:list"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: []
            } as never)
          : null
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => ({ id: "U1", name: "Alice" }),
      postMessage: async (_botToken, channel, text) => { posts.push({ channel, text }); },
      addReaction: async () => {},
      downloadFile: async () => Buffer.from("config: value\n")
    },
    runtime: {
      respond: async (input) => {
        capturedInputs.push({ text: input.text, fileAttachments: input.fileAttachments });
        return "Processed file";
      }
    },
    slackUploadRoot: uploadRoot
  });

  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "1710000000.000400",
      files: [
        {
          id: "F3",
          name: "config.json",
          mimetype: "application/json",
          size: 14,
          url_private_download: "https://files.slack.com/files-pri/T1/F3/config.json"
        }
      ]
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork(50);
  assert.deepEqual(posts, [{ channel: "D1", text: "Processed file" }]);
  assert.equal(capturedInputs.length, 1);
  assert.equal(capturedInputs[0]?.text, "");
  assert.equal(capturedInputs[0]?.fileAttachments?.length, 1);
  assert.equal(capturedInputs[0]?.fileAttachments?.[0]?.name, "config.json");
  await app.close();
});

test("Slack event route skips files that exceed the download limit and processes the rest", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "slack-test-"));
  let downloadCalls = 0;
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });
  const posts: Array<{ channel: string; text: string }> = [];
  const store = new MemorySlackAssistantStore();
  const capturedAttachmentCounts: number[] = [];
  registerSlackEventRoutes(app, {
    settingsStore: {
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret,
        slackAgentMcpServers: [],
        slackAssistantProvider: "claude",
        slackAssistantModel: "claude-sonnet-4-6",
        slackHarnessWhatExists: null,
        slackHarnessAllowedActions: null,
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: null
      }),
      recordSlackEventResult: async () => {}
    } as never,
    userStore: {
      listUsers: async () => [user],
      getAuthSessionUser: async (userId: string) =>
        userId === user.id
          ? ({
              ...user,
              scopes: ["repo:list"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: []
            } as never)
          : null
    } as never,
    slackAssistantStore: store,
    slackClient: {
      getUserProfile: async () => ({ id: "U1", name: "Alice" }),
      postMessage: async (_botToken, channel, text) => { posts.push({ channel, text }); },
      addReaction: async () => {},
      downloadFile: async (_botToken, fileUrl) => {
        downloadCalls += 1;
        if (fileUrl.includes("huge")) {
          throw new Error("Slack file size 200000000 bytes exceeds the 104857600 byte download limit.");
        }
        return Buffer.from("x");
      }
    },
    runtime: {
      respond: async (input) => {
        capturedAttachmentCounts.push(input.fileAttachments?.length ?? 0);
        return "ok";
      }
    },
    slackUploadRoot: uploadRoot
  });

  const payload = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      text: "here",
      files: [
        { id: "F4", name: "huge.bin", mimetype: "application/octet-stream", size: 200 * 1024 * 1024, url_private_download: "https://example.com/huge.bin" },
        { id: "F5", name: "photo.png", mimetype: "image/png", size: 500, url_private_download: "https://example.com/photo.png" },
        { id: "F6", name: "small.txt", mimetype: "text/plain", size: 100, url_private_download: "https://example.com/small.txt" }
      ]
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork(50);
  assert.equal(downloadCalls, 3, "all three files should be attempted");
  assert.equal(capturedAttachmentCounts[0], 2, "only non-oversized files should be in attachments");
  const uploadedFiles = await readdir(uploadRoot, { recursive: true });
  const filenames = uploadedFiles.filter((f) => typeof f === "string" && (f.endsWith(".png") || f.endsWith(".txt")));
  assert.equal(filenames.length, 2, "photo.png and small.txt should be persisted");
  await app.close();
});
