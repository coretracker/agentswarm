import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AgentProvider, McpServerConfig, PermissionScope, ProviderProfile } from "@agentswarm/shared-types";
import type { User } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { collectMcpServerEnvEntries, normalizeMcpServers } from "../lib/mcp-config.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";
import type { PersonalAccessTokenStore } from "./personal-access-token-store.js";
import type { SettingsStore } from "./settings-store.js";
import type {
  SlackAssistantActiveRuntime,
  SlackAssistantConversation,
  SlackAssistantStore,
  SlackAssistantTurn
} from "./slack-assistant-store.js";

const nowIso = (): string => new Date().toISOString();
const SLACK_ASSISTANT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const SLACK_ASSISTANT_MCP_SERVER_NAME = "agentswarm";
const SLACK_ASSISTANT_MCP_ENDPOINT_ENV = "AGENTSWARM_MCP_ENDPOINT";
const SLACK_ASSISTANT_MCP_ENDPOINTS_ENV = "AGENTSWARM_MCP_ENDPOINTS";
const SLACK_ASSISTANT_MCP_TOKEN_ENV = "AGENTSWARM_MCP_TOKEN";
const SLACK_ASSISTANT_MCP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SLACK_ASSISTANT_MCP_SCOPES: PermissionScope[] = [
  "repo:list",
  "repo:read",
  "task:list",
  "task:read",
  "task:create",
  "task:edit",
  "task:build",
  "task:ask"
];

type RuntimeResultPayload = {
  status?: string;
  summaryMarkdown?: string;
};

export type SlackAssistantCommandRunner = (command: string, args: string[]) => Promise<void>;

export interface SlackAssistantMessageInput {
  user: User;
  conversation: SlackAssistantConversation;
  text: string;
  mcpScopes?: PermissionScope[];
}

export interface SlackAssistantRuntime {
  respond(input: SlackAssistantMessageInput): Promise<string>;
}

class UnavailableSlackAssistantRuntime implements SlackAssistantRuntime {
  async respond(): Promise<string> {
    return "Slack assistant runtime is not configured yet.";
  }
}

const sanitizePathSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "slack";

const defaultCommandRunner: SlackAssistantCommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });

const internalAgentSwarmMcpEndpoints = (): string[] => {
  if (existsSync("/.dockerenv")) {
    return [
      `http://127.0.0.1:${env.PORT}/mcp`,
      `http://host.docker.internal:${env.PORT}/mcp`,
      `http://172.17.0.1:${env.PORT}/mcp`
    ];
  }
  return [`http://host.docker.internal:${env.PORT}/mcp`, `http://172.17.0.1:${env.PORT}/mcp`];
};

const internalAgentSwarmMcpDockerArgs = (): string[] => {
  if (existsSync("/.dockerenv")) {
    return ["--network", `container:${hostname()}`];
  }
  return ["--add-host", "host.docker.internal:host-gateway"];
};

const providerProfileForSettings = (
  provider: AgentProvider,
  settings: Awaited<ReturnType<SettingsStore["getSettings"]>>
): ProviderProfile => (provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort);

const normalizeMcpServerName = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const mergeSlackRuntimeMcpServers = (agentSwarmServer: McpServerConfig, slackAgentMcpServers: McpServerConfig[]): McpServerConfig[] => {
  const servers = [agentSwarmServer];
  const seen = new Set([normalizeMcpServerName(agentSwarmServer.name)]);
  for (const server of normalizeMcpServers(slackAgentMcpServers)) {
    const name = normalizeMcpServerName(server.name);
    if (!name || seen.has(name)) {
      continue;
    }
    servers.push(server);
    seen.add(name);
  }
  return servers;
};

const normalizePermissionScopes = (scopes: PermissionScope[] | undefined): PermissionScope[] =>
  Array.from(new Set((scopes ?? []).map((scope) => scope?.trim() as PermissionScope).filter(Boolean)));

const normalizeHarnessSection = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const buildSlackHarnessMarkdown = (
  integration: Awaited<ReturnType<SettingsStore["getSlackIntegration"]>>
): string | null => {
  const sections = [
    { heading: "What exists?", content: normalizeHarnessSection(integration?.slackHarnessWhatExists) },
    { heading: "What is allowed?", content: normalizeHarnessSection(integration?.slackHarnessAllowedActions) },
    { heading: "How should you work?", content: normalizeHarnessSection(integration?.slackHarnessHowToWork) },
    { heading: "How do you know you are done?", content: normalizeHarnessSection(integration?.slackHarnessDefinitionOfDone) },
    { heading: "How do you prove it?", content: normalizeHarnessSection(integration?.slackHarnessEvidenceExpectations) }
  ].filter((section): section is { heading: string; content: string } => Boolean(section.content));

  if (sections.length === 0) {
    return null;
  }

  return ["# Slack Agent Harness", ...sections.flatMap((section) => [``, `## ${section.heading}`, section.content])].join("\n");
};

const buildConversationPrompt = (input: SlackAssistantMessageInput): string => {
  const turns = input.conversation.turns.slice(-24);
  const transcript = turns
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n");
  return [
    "You are AgentSwarm's detached Slack DM assistant.",
    "Use AgentSwarm MCP as the source of truth for AgentSwarm data. Use configured Slack agent MCP tools or AgentSwarm repository/task context when relevant.",
    "Do not create or mutate AgentSwarm tasks unless the user explicitly asks for that.",
    "Keep Slack replies concise and practical.",
    "No single repository is pre-selected; use AgentSwarm data and user intent to choose targets.",
    "",
    `Matched AgentSwarm user: ${input.user.name} <${input.user.email}>`,
    "",
    "Conversation so far:",
    transcript || "(new conversation)",
    "",
    "Latest Slack message:",
    input.text
  ].join("\n");
};

export class DockerSlackAssistantRuntime implements SlackAssistantRuntime {
  constructor(
    private readonly deps: {
      settingsStore: SettingsStore;
      personalAccessTokenStore: PersonalAccessTokenStore;
      conversationStore: SlackAssistantStore;
      commandRunner?: SlackAssistantCommandRunner;
      now?: () => Date;
    }
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async buildRuntimeMcpConfig(
    user: User,
    conversation: SlackAssistantConversation,
    slackAgentMcpServers: McpServerConfig[],
    slackAgentMcpRuntimeEnv: Record<string, string>,
    executionId: string,
    mcpScopes: PermissionScope[] | undefined
  ): Promise<{ servers: McpServerConfig[]; env: Record<string, string> }> {
    const tokenScopes = normalizePermissionScopes(mcpScopes);
    const token = await this.deps.personalAccessTokenStore.createToken({
      userId: user.id,
      name: `Slack DM runtime MCP ${executionId}`,
      scopes: tokenScopes.length > 0 ? tokenScopes : SLACK_ASSISTANT_MCP_SCOPES,
      expiresAt: new Date(this.now().getTime() + SLACK_ASSISTANT_MCP_TOKEN_TTL_MS).toISOString(),
      runtimeContext: {
        kind: "slack_assistant",
        conversationId: conversation.id,
        slackChannelId: conversation.slackChannelId
      }
    });
    const endpoints = internalAgentSwarmMcpEndpoints();
    const agentSwarmMcpEnv = {
      [SLACK_ASSISTANT_MCP_ENDPOINT_ENV]: endpoints[0] ?? `http://127.0.0.1:${env.PORT}/mcp`,
      [SLACK_ASSISTANT_MCP_ENDPOINTS_ENV]: endpoints.join(","),
      [SLACK_ASSISTANT_MCP_TOKEN_ENV]: token.token
    };
    const agentSwarmServer: McpServerConfig = {
      name: SLACK_ASSISTANT_MCP_SERVER_NAME,
      transport: "stdio",
      command: "node",
      args: ["/usr/local/bin/agentswarm-mcp-bridge.mjs"],
      env: agentSwarmMcpEnv,
      enabled: true
    };
    return {
      env: {
        ...slackAgentMcpRuntimeEnv,
        ...agentSwarmMcpEnv
      },
      servers: mergeSlackRuntimeMcpServers(agentSwarmServer, slackAgentMcpServers)
    };
  }

  private async markIdleExpired(input: SlackAssistantMessageInput): Promise<void> {
    const runtime = input.conversation.activeRuntime;
    if (!runtime || runtime.status === "stopped") {
      return;
    }
    const idleMs = this.now().getTime() - Date.parse(runtime.lastUserMessageAt);
    if (!Number.isFinite(idleMs) || idleMs < SLACK_ASSISTANT_IDLE_TIMEOUT_MS) {
      return;
    }
    await this.deps.conversationStore.updateActiveRuntime(input.conversation.id, {
      ...runtime,
      status: "stopped",
      containerName: null,
      stoppedAt: this.now().toISOString(),
      stopReason: "idle_timeout"
    });
  }

  async respond(input: SlackAssistantMessageInput): Promise<string> {
    await this.markIdleExpired(input);
    const settings = await this.deps.settingsStore.getSettings();
    const slackIntegration = await this.deps.settingsStore.getSlackIntegration();
    const provider = slackIntegration?.slackAssistantProvider ?? settings.slackAssistantProvider;
    const slackAssistantModel = (slackIntegration?.slackAssistantModel ?? settings.slackAssistantModel).trim();
    const providerDefinition = getProviderRuntimeDefinition(provider);
    const credentials = await this.deps.settingsStore.getRuntimeCredentials(input.user.id, "auto");
    const missingCredentialMessage = providerDefinition.getMissingCredentialMessage(credentials);
    if (missingCredentialMessage) {
      return `Slack assistant runtime is not ready: ${missingCredentialMessage}`;
    }

    const executionId = nanoid();
    const conversationSegment = sanitizePathSegment(input.conversation.id);
    const executionSegment = sanitizePathSegment(executionId);
    const providerProfile = providerProfileForSettings(provider, settings);
    const resolvedModel = providerDefinition.getResolvedModel(slackAssistantModel || null, providerProfile);
    const resolvedProfileSettings = providerDefinition.getResolvedProfileSettings(providerProfile, resolvedModel);
    const configuredSlackAgentMcpServers = normalizeMcpServers([
      ...(slackIntegration?.slackAgentMcpServers ?? []),
      ...(settings.slackAgentMcpServers ?? [])
    ]);
    const runtimeMcp = await this.buildRuntimeMcpConfig(
      input.user,
      input.conversation,
      configuredSlackAgentMcpServers,
      slackIntegration?.mcpRuntimeEnv ?? {},
      executionId,
      input.mcpScopes
    );
    const providerConfigContent = providerDefinition.getProviderConfig(runtimeMcp.servers);
    const payloadDir = path.join(env.RUNTIME_PAYLOAD_ROOT, "slack-assistant", conversationSegment, executionSegment);
    const workspacePath = path.join(env.RUNTIME_PAYLOAD_ROOT, "slack-assistant-workspaces", conversationSegment);
    const providerModelSegment = sanitizePathSegment(slackAssistantModel || "default-model");
    const providerStatePath = path.join(
      env.RUNTIME_PAYLOAD_ROOT,
      "slack-assistant-state",
      conversationSegment,
      provider,
      providerModelSegment
    );
    const providerHomePath = path.dirname(providerStatePath);
    const manifestPath = path.join(payloadDir, "manifest.json");
    const providerConfigPath = path.join(payloadDir, providerDefinition.configFileName);
    const slackHarnessPath = path.join(workspacePath, "AGENTS.md");
    const resultMarkdownPath = path.join(payloadDir, "result.md");
    const resultJsonPath = path.join(payloadDir, "result.json");
    const rawEventsJsonlPath = path.join(payloadDir, "raw-events.jsonl");
    const containerName = `agentswarm-slack-${conversationSegment.slice(0, 32)}-${executionSegment.slice(0, 8)}`;
    const timestamp = this.now().toISOString();
    const activeRuntime: SlackAssistantActiveRuntime = {
      provider,
      status: "active",
      containerName,
      startedAt: input.conversation.activeRuntime?.startedAt ?? timestamp,
      lastUserMessageAt: timestamp,
      stoppedAt: null,
      stopReason: null
    };

    await Promise.all([
      mkdir(payloadDir, { recursive: true }),
      mkdir(workspacePath, { recursive: true }),
      mkdir(providerStatePath, { recursive: true })
    ]);
    const slackHarnessMarkdown = buildSlackHarnessMarkdown(slackIntegration);
    await Promise.all([
      writeFile(providerConfigPath, providerConfigContent, "utf8"),
      slackHarnessMarkdown
        ? writeFile(slackHarnessPath, slackHarnessMarkdown, "utf8")
        : unlink(slackHarnessPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
              throw error;
            }
          }),
      writeFile(resultMarkdownPath, "", "utf8"),
      writeFile(resultJsonPath, "", "utf8"),
      writeFile(
        manifestPath,
        JSON.stringify(
          {
            id: input.conversation.id,
            taskType: "ask",
            action: "ask",
            provider,
            providerProfile,
            resolvedModel,
            resolvedReasoningEffort: resolvedProfileSettings.reasoningEffort,
            resolvedThinkingBudgetTokens: resolvedProfileSettings.thinkingBudgetTokens,
            workspacePath,
            resultMarkdownPath,
            resultJsonPath,
            rawEventsJsonlPath,
            agentResponsePreference: input.user.agentResponsePreference,
            content: buildConversationPrompt(input)
          },
          null,
          2
        ),
        "utf8"
      )
    ]);

    await this.deps.conversationStore.updateActiveRuntime(input.conversation.id, activeRuntime);
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      ...internalAgentSwarmMcpDockerArgs(),
      "-v",
      `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
      "-e",
      `TASK_MANIFEST_FILE=${manifestPath}`,
      "-e",
      `PROVIDER_CONFIG_FILE=${providerConfigPath}`,
      "-e",
      `TASK_WORKSPACE_PATH=${workspacePath}`,
      "-e",
      `TASK_WORSPACE_PATH=${workspacePath}`,
      "-e",
      `TASK_PROVIDER_STATE_PATH=${providerStatePath}`,
      "-e",
      `TASK_PROVIDER_HOME=${providerHomePath}`
    ];
    const providerRuntimeEnv = providerDefinition.getRuntimeEnv(credentials);
    const runtimeEnv = {
      ...Object.fromEntries(collectMcpServerEnvEntries(runtimeMcp.servers, { ...process.env, ...runtimeMcp.env })),
      ...runtimeMcp.env,
      ...providerRuntimeEnv
    };
    for (const [name, value] of Object.entries(runtimeEnv)) {
      if (value) {
        args.push("-e", `${name}=${value}`);
      }
    }
    args.push(providerDefinition.image, ...providerDefinition.command);

    const run = this.deps.commandRunner ?? defaultCommandRunner;
    try {
      await run("docker", args);
      const rawResult = await readFile(resultJsonPath, "utf8");
      const parsed = JSON.parse(rawResult) as RuntimeResultPayload;
      const summaryMarkdown = parsed.summaryMarkdown?.trim();
      if (!summaryMarkdown) {
        throw new Error("Slack assistant runtime returned an empty response.");
      }
      await this.deps.conversationStore.updateActiveRuntime(input.conversation.id, {
        ...activeRuntime,
        status: "idle",
        containerName: null,
        stopReason: "completed"
      });
      return summaryMarkdown;
    } catch (error) {
      await this.deps.conversationStore.updateActiveRuntime(input.conversation.id, {
        ...activeRuntime,
        status: "stopped",
        containerName: null,
        stoppedAt: this.now().toISOString(),
        stopReason: "failed"
      });
      throw error;
    }
  }
}

export class SlackAssistantService {
  constructor(
    private readonly conversationStore: SlackAssistantStore,
    private readonly runtime: SlackAssistantRuntime = new UnavailableSlackAssistantRuntime()
  ) {}

  async handleMessage(input: SlackAssistantMessageInput): Promise<string> {
    const userTurn: SlackAssistantTurn = { role: "user", content: input.text, at: nowIso() };
    const conversationWithUserTurn = await this.conversationStore.appendTurn(input.conversation.id, userTurn);
    const reply = await this.runtime.respond({
      ...input,
      conversation: conversationWithUserTurn ?? input.conversation
    });
    await this.conversationStore.appendTurn(input.conversation.id, { role: "assistant", content: reply, at: nowIso() });
    return reply;
  }
}
