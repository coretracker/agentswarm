import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import type { Repository, User } from "@agentswarm/shared-types";
import { DockerSlackAssistantRuntime } from "./slack-assistant-service.js";
import type {
  SlackAssistantActiveRuntime,
  SlackAssistantConversation,
  SlackAssistantConversationInput,
  SlackAssistantStore,
  SlackAssistantTurn
} from "./slack-assistant-store.js";

const now = "2026-07-01T00:00:00.000Z";

const repository: Repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/acme/repo.git",
  defaultBranch: "develop",
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  slackAgentMcpServers: [],
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
  updates: Array<SlackAssistantActiveRuntime | null> = [];

  constructor(private conversation: SlackAssistantConversation) {}

  async getOrCreateConversation(_input: SlackAssistantConversationInput): Promise<SlackAssistantConversation> {
    return this.conversation;
  }

  async appendTurn(_conversationId: string, turn: SlackAssistantTurn): Promise<SlackAssistantConversation | null> {
    this.conversation = { ...this.conversation, turns: [...this.conversation.turns, turn] };
    return this.conversation;
  }

  async updateActiveRuntime(
    _conversationId: string,
    activeRuntime: SlackAssistantActiveRuntime | null
  ): Promise<SlackAssistantConversation | null> {
    this.updates.push(activeRuntime);
    this.conversation = { ...this.conversation, activeRuntime };
    return this.conversation;
  }
}

test("DockerSlackAssistantRuntime builds detached provider payload with AgentSwarm MCP", async () => {
  const conversation: SlackAssistantConversation = {
    id: "conv-runtime-test",
    repositoryId: repository.id,
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "codex",
    turns: [{ role: "user", content: "previous", at: now }],
    activeRuntime: {
      provider: "codex",
      status: "idle",
      containerName: null,
      startedAt: "2026-07-01T00:00:00.000Z",
      lastUserMessageAt: "2026-07-01T00:00:00.000Z",
      stoppedAt: null,
      stopReason: "completed"
    },
    createdAt: now,
    updatedAt: now
  };
  const store = new MemorySlackAssistantStore(conversation);
  const runtime = new DockerSlackAssistantRuntime({
    settingsStore: {
      getSettings: async () => ({
        defaultProvider: "codex",
        codexDefaultEffort: "low",
        claudeDefaultEffort: "low"
      }),
      getRuntimeCredentials: async () => ({
        openaiApiKey: "openai-key",
        codexAuthJson: null,
        anthropicApiKey: null,
        githubToken: null,
        gitUsername: "x-access-token",
        gitAuthorName: null,
        gitAuthorEmail: null,
        openaiBaseUrl: null,
        anthropicBaseUrl: null
      })
    } as never,
    personalAccessTokenStore: {
      createToken: async (input: { userId: string; scopes: string[] }) => ({
        id: "token-1",
        name: "Slack DM runtime MCP",
        scopes: input.scopes,
        tokenPrefix: "asw_pat_test",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        token: "runtime-token"
      })
    } as never,
    conversationStore: store,
    now: () => new Date("2026-07-01T00:04:00.000Z"),
    commandRunner: async (command, args) => {
      assert.equal(command, "docker");
      const manifestEnv = args.find((arg) => arg.startsWith("TASK_MANIFEST_FILE="));
      const providerConfigEnv = args.find((arg) => arg.startsWith("PROVIDER_CONFIG_FILE="));
      const mcpTokenEnv = args.find((arg) => arg === "AGENTSWARM_MCP_TOKEN=runtime-token");
      assert.ok(manifestEnv);
      assert.ok(providerConfigEnv);
      assert.ok(mcpTokenEnv);

      const manifest = JSON.parse(await readFile(manifestEnv!.slice("TASK_MANIFEST_FILE=".length), "utf8")) as {
        content: string;
        resultJsonPath: string;
      };
      const providerConfig = await readFile(providerConfigEnv!.slice("PROVIDER_CONFIG_FILE=".length), "utf8");
      assert.match(manifest.content, /detached Slack DM assistant/);
      assert.match(manifest.content, /Latest Slack message:\nhello/);
      assert.match(providerConfig, /mcp_servers\.agentswarm/);
      assert.match(providerConfig, /mcp_servers\.github/);
      assert.doesNotMatch(providerConfig, /should-not-override/);
      await writeFile(
        manifest.resultJsonPath,
        JSON.stringify({ status: "success", summaryMarkdown: "Runtime reply" }),
        "utf8"
      );
    }
  });

  const response = await runtime.respond({
    repository: {
      ...repository,
      slackAgentMcpServers: [
        {
          name: "GitHub",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["-y", "github-mcp"]
        },
        {
          name: "AgentSwarm",
          enabled: true,
          transport: "stdio",
          command: "should-not-override"
        }
      ]
    },
    user,
    conversation,
    text: "hello"
  });

  assert.equal(response, "Runtime reply");
  assert.equal(store.updates.at(-1)?.status, "idle");
});

test("DockerSlackAssistantRuntime marks prior runtime stopped after idle timeout before new run", async () => {
  const conversation: SlackAssistantConversation = {
    id: "conv-idle-test",
    repositoryId: repository.id,
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "codex",
    turns: [],
    activeRuntime: {
      provider: "codex",
      status: "idle",
      containerName: null,
      startedAt: "2026-07-01T00:00:00.000Z",
      lastUserMessageAt: "2026-07-01T00:00:00.000Z",
      stoppedAt: null,
      stopReason: "completed"
    },
    createdAt: now,
    updatedAt: now
  };
  const store = new MemorySlackAssistantStore(conversation);
  const runtime = new DockerSlackAssistantRuntime({
    settingsStore: {
      getSettings: async () => ({
        defaultProvider: "codex",
        codexDefaultEffort: "low",
        claudeDefaultEffort: "low"
      }),
      getRuntimeCredentials: async () => ({
        openaiApiKey: "openai-key",
        codexAuthJson: null,
        anthropicApiKey: null,
        githubToken: null,
        gitUsername: "x-access-token",
        gitAuthorName: null,
        gitAuthorEmail: null,
        openaiBaseUrl: null,
        anthropicBaseUrl: null
      })
    } as never,
    personalAccessTokenStore: {
      createToken: async () => ({
        id: "token-1",
        name: "Slack DM runtime MCP",
        scopes: [],
        tokenPrefix: "asw_pat_test",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        token: "runtime-token"
      })
    } as never,
    conversationStore: store,
    now: () => new Date("2026-07-01T00:06:00.000Z"),
    commandRunner: async (_command, args) => {
      const manifestEnv = args.find((arg) => arg.startsWith("TASK_MANIFEST_FILE="));
      assert.ok(manifestEnv);
      const manifest = JSON.parse(await readFile(manifestEnv!.slice("TASK_MANIFEST_FILE=".length), "utf8")) as {
        resultJsonPath: string;
      };
      await writeFile(
        manifest.resultJsonPath,
        JSON.stringify({ status: "success", summaryMarkdown: "Runtime reply" }),
        "utf8"
      );
    }
  });

  await runtime.respond({ repository, user, conversation, text: "hello again" });

  assert.equal(store.updates[0]?.status, "stopped");
  assert.equal(store.updates[0]?.stopReason, "idle_timeout");
});
