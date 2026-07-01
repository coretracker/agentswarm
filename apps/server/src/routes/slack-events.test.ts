import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import type { Repository, User } from "@agentswarm/shared-types";
import { registerSlackEventRoutes } from "./slack-events.js";
import type {
  SlackAssistantActiveRuntime,
  SlackAssistantConversation,
  SlackAssistantConversationInput,
  SlackAssistantStore,
  SlackAssistantTurn
} from "../services/slack-assistant-store.js";

const now = "2026-07-01T00:00:00.000Z";
const signingSecret = "slack-signing-secret";

const repository: Repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/acme/repo.git",
  defaultBranch: "develop",
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  hostCommands: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  githubPrWebhookSecretConfigured: false,
  slackBotTokenConfigured: true,
  slackSigningSecretConfigured: true,
  githubIntegrationBotLogin: null,
  githubPrAllowedUsers: [],
  githubPrRequireBotMention: false,
  githubPrAutoArchiveOnMerge: false,
  githubPrInitialInstructions: null,
  githubPrFeedbackInstructions: null,
  githubPrReviewInstructions: null,
  githubPrTaskCreatedCommentTemplate: null,
  githubPrTaskOwnerUserId: null,
  harnessWhatExists: null,
  harnessAllowedActions: null,
  harnessHowToWork: null,
  harnessDefinitionOfDone: null,
  harnessEvidenceExpectations: null,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: now,
  updatedAt: now
};

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
    const id = `${input.repositoryId}:${input.slackTeamId}:${input.slackChannelId}:${input.slackUserId}`;
    const current = this.conversations.get(id);
    if (current) {
      return current;
    }
    const conversation: SlackAssistantConversation = {
      id,
      repositoryId: input.repositoryId,
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

const createApp = () => {
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
    repositoryStore: {
      createRepository: async () => repository,
      listRepositories: async () => [repository],
      getRepository: async () => repository,
      getRepositoryRuntimeEnvEntries: async () => [],
      getRepositoryMcpServers: async () => [],
      getRepositorySlackAgentMcpServers: async () => [],
      getRepositoryHostCommands: async () => [],
      updateRepository: async () => repository,
      getRepositoryWebhookTarget: async () => null,
      getRepositoryGitHubPrWebhookSecret: async () => null,
      getRepositorySlackIntegration: async () => ({ repository, botToken: "xoxb-token", signingSecret }),
      recordWebhookDeliveryResult: async () => repository,
      recordSlackEventResult: async (_repositoryId, input) => {
        slackEvents.push(input);
        return repository;
      },
      deleteRepository: async () => false
    },
    userStore: {
      listUsers: async () => [user]
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
      respond: async (input) => `Reply to ${input.user.slackUsername}: ${input.text}`
    }
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
    repositoryStore: {
      createRepository: async () => repository,
      listRepositories: async () => [repository],
      getRepository: async () => repository,
      getRepositoryRuntimeEnvEntries: async () => [],
      getRepositoryMcpServers: async () => [],
      getRepositorySlackAgentMcpServers: async () => [],
      getRepositoryHostCommands: async () => [],
      updateRepository: async () => repository,
      getRepositoryWebhookTarget: async () => null,
      getRepositoryGitHubPrWebhookSecret: async () => null,
      getRepositorySlackIntegration: async () => ({ repository, botToken: "xoxb-token", signingSecret }),
      recordWebhookDeliveryResult: async () => repository,
      recordSlackEventResult: async (_repositoryId, input) => {
        slackEvents.push(input);
        return repository;
      },
      deleteRepository: async () => false
    },
    userStore: {
      listUsers: async () => users
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
    headers: { "content-type": "application/json", ...sign(payload) },
    payload
  });

  assert.equal(response.statusCode, 200);
  await waitForBackgroundWork();
  assert.deepEqual(reactions, [{ channel: "D1", timestamp: "1710000000.000100", name: "eyes" }]);
  assert.deepEqual(posts, [{ channel: "D1", text: "Reply to alice: hello" }]);
  assert.equal(slackEvents.at(-1)?.status, "received");
  assert.equal(slackEvents.at(-1)?.eventType, "message.im");
  assert.equal(Array.from(store.conversations.values())[0]?.turns.length, 2);
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
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
    url: "/repositories/repo-1/slack/events",
    headers: { "content-type": "application/json", ...sign(payload, oldTimestamp) },
    payload
  });

  assert.equal(response.statusCode, 401);
  assert.equal(slackEvents.at(-1)?.status, "failed");
  assert.equal(slackEvents.at(-1)?.errorMessage, "timestamp_skew");
  await app.close();
});
