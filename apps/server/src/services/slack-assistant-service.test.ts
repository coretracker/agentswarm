import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { User } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { DockerSlackAssistantRuntime } from "./slack-assistant-service.js";
import type {
  SlackAssistantActiveRuntime,
  SlackAssistantConversation,
  SlackAssistantConversationInput,
  SlackAssistantStore,
  SlackAssistantTurn
} from "./slack-assistant-store.js";

const now = "2026-07-01T00:00:00.000Z";
const originalRuntimePayloadRoot = env.RUNTIME_PAYLOAD_ROOT;
let runtimePayloadRoot: string | null = null;

test.before(async () => {
  runtimePayloadRoot = await mkdtemp(path.join(tmpdir(), "agentswarm-slack-runtime-test-"));
  env.RUNTIME_PAYLOAD_ROOT = runtimePayloadRoot;
});

test.after(async () => {
  env.RUNTIME_PAYLOAD_ROOT = originalRuntimePayloadRoot;
  if (runtimePayloadRoot) {
    await rm(runtimePayloadRoot, { recursive: true, force: true });
  }
});

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
    repositoryId: null,
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
  let issuedScopes: string[] = [];
  const runtime = new DockerSlackAssistantRuntime({
    settingsStore: {
      getSettings: async () => ({
        defaultProvider: "codex",
        slackAssistantProvider: "codex",
        slackAssistantModel: "gpt-5.5",
        codexDefaultEffort: "low",
        claudeDefaultEffort: "low",
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
      }),
      getSlackIntegration: async () => ({
        botToken: "xoxb-token",
        signingSecret: "signing-secret",
        slackAgentMcpServers: [],
        slackAssistantProvider: "codex",
        slackAssistantModel: "gpt-5.4-mini",
        slackHarnessWhatExists: "Slack DM assistant workspace.",
        slackHarnessAllowedActions: "Answer the user in Slack.",
        slackHarnessHowToWork: null,
        slackHarnessDefinitionOfDone: null,
        slackHarnessEvidenceExpectations: "Return a concise reply."
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
      createToken: async (input: { userId: string; scopes: string[]; runtimeContext?: unknown }) => {
        issuedScopes = input.scopes;
        assert.deepEqual(input.runtimeContext, {
          kind: "slack_assistant",
          conversationId: conversation.id,
          slackChannelId: conversation.slackChannelId
        });
        return {
          id: "token-1",
          name: "Slack DM runtime MCP",
          scopes: input.scopes,
          tokenPrefix: "asw_pat_test",
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: now,
          token: "runtime-token"
        };
      }
    } as never,
    conversationStore: store,
    now: () => new Date("2026-07-01T00:04:00.000Z"),
    commandRunner: async (command, args) => {
      assert.equal(command, "docker");
      const manifestEnv = args.find((arg) => arg.startsWith("TASK_MANIFEST_FILE="));
      const providerConfigEnv = args.find((arg) => arg.startsWith("PROVIDER_CONFIG_FILE="));
      const providerStateEnv = args.find((arg) => arg.startsWith("TASK_PROVIDER_STATE_PATH="));
      const mcpTokenEnv = args.find((arg) => arg === "AGENTSWARM_MCP_TOKEN=runtime-token");
      assert.ok(manifestEnv);
      assert.ok(providerConfigEnv);
      assert.ok(providerStateEnv);
      assert.ok(mcpTokenEnv);

      const manifest = JSON.parse(await readFile(manifestEnv!.slice("TASK_MANIFEST_FILE=".length), "utf8")) as {
        provider: string;
        resolvedModel: string;
        content: string;
        resultJsonPath: string;
        workspacePath: string;
      };
      const providerConfig = await readFile(providerConfigEnv!.slice("PROVIDER_CONFIG_FILE=".length), "utf8");
      const slackHarness = await readFile(path.join(manifest.workspacePath, "AGENTS.md"), "utf8");
      assert.match(manifest.content, /detached Slack DM assistant/);
      assert.match(manifest.content, /Latest Slack message:\nhello/);
      assert.match(slackHarness, /# Slack Agent Harness/);
      assert.match(slackHarness, /Slack DM assistant workspace\./);
      assert.match(slackHarness, /Return a concise reply\./);
      assert.equal(manifest.provider, "codex");
      assert.equal(manifest.resolvedModel, "gpt-5.4-mini");
      assert.match(providerStateEnv!, /\/codex\/gpt-5\.4-mini$/);
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
    user,
    conversation,
    text: "hello",
    mcpScopes: ["repo:list", "repo:read", "task:list", "task:read", "task:create", "task:build"]
  });

  assert.equal(response, "Runtime reply");
  assert.equal(store.updates.at(-1)?.status, "idle");
  assert.deepEqual(issuedScopes, [
    "repo:list",
    "repo:read",
    "task:list",
    "task:read",
    "task:create",
    "task:build"
  ]);
});

test("DockerSlackAssistantRuntime marks prior runtime stopped after idle timeout before new run", async () => {
  const conversation: SlackAssistantConversation = {
    id: "conv-idle-test",
    repositoryId: null,
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
        slackAssistantProvider: "codex",
        slackAssistantModel: "gpt-5.5",
        codexDefaultEffort: "low",
        claudeDefaultEffort: "low",
        slackAgentMcpServers: []
      }),
      getSlackIntegration: async () => null,
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

  await runtime.respond({ user, conversation, text: "hello again" });

  assert.equal(store.updates[0]?.status, "stopped");
  assert.equal(store.updates[0]?.stopReason, "idle_timeout");
});

test("DockerSlackAssistantRuntime stops active Slack assistant container", async () => {
  const conversation: SlackAssistantConversation = {
    id: "conv-stop-test",
    repositoryId: null,
    userId: user.id,
    slackTeamId: "T1",
    slackChannelId: "D1",
    slackUserId: "U1",
    provider: "codex",
    turns: [],
    activeRuntime: {
      provider: "codex",
      status: "active",
      containerName: "agentswarm-slack-active",
      startedAt: "2026-07-01T00:00:00.000Z",
      lastUserMessageAt: "2026-07-01T00:00:00.000Z",
      stoppedAt: null,
      stopReason: null
    },
    createdAt: now,
    updatedAt: now
  };
  const store = new MemorySlackAssistantStore(conversation);
  const commands: Array<{ command: string; args: string[] }> = [];
  const runtime = new DockerSlackAssistantRuntime({
    settingsStore: {} as never,
    personalAccessTokenStore: {} as never,
    conversationStore: store,
    now: () => new Date("2026-07-01T00:07:00.000Z"),
    commandRunner: async (command, args) => {
      commands.push({ command, args });
    }
  });

  const stopped = await runtime.stop(conversation);

  assert.equal(stopped, true);
  assert.deepEqual(commands, [{ command: "docker", args: ["stop", "agentswarm-slack-active"] }]);
  assert.equal(store.updates.at(-1)?.status, "stopped");
  assert.equal(store.updates.at(-1)?.containerName, null);
  assert.equal(store.updates.at(-1)?.stoppedAt, "2026-07-01T00:07:00.000Z");
  assert.equal(store.updates.at(-1)?.stopReason, "cancelled");
});
