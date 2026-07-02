import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import type { User } from "@agentswarm/shared-types";
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
  slackUsername: "alice",
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

const waitForBackgroundWork = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

const createApp = (runtime: SlackAssistantRuntime = {
  respond: async (input) => `Reply to ${input.user.slackUsername}: ${input.text}`
}) => {
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
      }
    },
    runtime
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
      }
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
  const { app, posts, reactions, slackEvents, store } = createApp();
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
  const { app, posts, slackEvents, store } = createApp();
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
    containerName: "agentswarm-slack-active",
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
  });
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
    containerName: "agentswarm-slack-active",
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
  const { app, posts } = createApp({
    respond: async (input) => `Reply to ${input.text}`,
    stop: async () => {
      stopCalls += 1;
      return true;
    }
  });
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
  assert.deepEqual(posts, [{ channel: "D1", text: "I could not find an active AgentSwarm profile with this Slack username." }]);
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
