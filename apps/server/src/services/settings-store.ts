import type Redis from "ioredis";
import type {
  AgentProvider,
  McpServerConfig,
  ProviderProfile,
  SystemSettings,
  UpdateCredentialSettingsInput,
  UpdateSettingsInput
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { normalizeProvider, DEFAULT_PROVIDER, normalizeProviderProfile } from "../lib/provider-config.js";
import { defaultModelForProvider } from "../lib/provider-config.js";
import { CredentialStore, type RuntimeCredentials } from "./credential-store.js";

const SETTINGS_KEY = "agentswarm:settings";

const DEFAULT_CODEX_EFFORT: ProviderProfile = "high";
const DEFAULT_CLAUDE_EFFORT: ProviderProfile = "high";

const defaultSettings: SystemSettings = {
  defaultProvider: DEFAULT_PROVIDER,
  maxAgents: 2,
  branchPrefix: "agentswarm",
  gitUsername: "x-access-token",
  agentRules: "",
  mcpServers: [],
  openaiBaseUrl: null,
  githubTokenConfigured: false,
  openaiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  codexDefaultModel: defaultModelForProvider("codex", DEFAULT_CODEX_EFFORT) ?? "gpt-5.4",
  codexDefaultEffort: DEFAULT_CODEX_EFFORT,
  claudeDefaultModel: defaultModelForProvider("claude", DEFAULT_CLAUDE_EFFORT) ?? "claude-sonnet-4-5",
  claudeDefaultEffort: DEFAULT_CLAUDE_EFFORT
};

const normalizeBranchPrefix = (value: string | undefined): string => {
  const cleaned = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return cleaned || defaultSettings.branchPrefix;
};

const normalizeGitUsername = (value: string | undefined): string => {
  const cleaned = (value ?? "").trim();
  return cleaned || defaultSettings.gitUsername;
};

const normalizeAgentRules = (value: string | undefined): string => (value ?? "").trim();
const normalizeDefaultProvider = (value: AgentProvider | string | undefined): AgentProvider =>
  normalizeProvider(value ?? defaultSettings.defaultProvider);

const normalizeMcpServerName = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeMcpServerArgs = (value: string[] | undefined): string[] =>
  (value ?? []).map((item) => item.trim()).filter(Boolean);

const normalizeMcpServers = (value: McpServerConfig[] | undefined): McpServerConfig[] => {
  const normalized: McpServerConfig[] = [];
  const seenNames = new Set<string>();

  for (const server of value ?? []) {
    const name = normalizeMcpServerName(server.name);
    if (!name || seenNames.has(name)) {
      continue;
    }

    const transport = server.transport === "http" ? "http" : "stdio";
    const baseServer: McpServerConfig = {
      name,
      enabled: server.enabled !== false,
      transport
    };

    if (transport === "http") {
      const url = server.url?.trim() || null;
      if (!url) {
        continue;
      }

      normalized.push({
        ...baseServer,
        url,
        bearerTokenEnvVar: server.bearerTokenEnvVar?.trim() || null
      });
    } else {
      const command = server.command?.trim() || null;
      if (!command) {
        continue;
      }

      normalized.push({
        ...baseServer,
        command,
        args: normalizeMcpServerArgs(server.args)
      });
    }

    seenNames.add(name);
  }

  return normalized;
};

export class SettingsStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus,
    private readonly credentialStore: CredentialStore
  ) {}

  private async publishSettings(settings: SystemSettings): Promise<void> {
    await this.eventBus.publish({ type: "settings:updated", payload: settings });
  }

  async getSettings(): Promise<SystemSettings> {
    const raw = await this.redis.get(SETTINGS_KEY);
    if (!raw) {
      const baseSettings = {
        defaultProvider: defaultSettings.defaultProvider,
        maxAgents: defaultSettings.maxAgents,
        branchPrefix: defaultSettings.branchPrefix,
        gitUsername: defaultSettings.gitUsername,
        agentRules: defaultSettings.agentRules,
        mcpServers: defaultSettings.mcpServers,
        openaiBaseUrl: defaultSettings.openaiBaseUrl
      };
      await this.redis.set(SETTINGS_KEY, JSON.stringify(baseSettings));
    }

    const parsed = raw ? (JSON.parse(raw) as Partial<SystemSettings>) : {};
    const normalizedBase = {
      defaultProvider: normalizeDefaultProvider(parsed.defaultProvider),
      maxAgents: parsed.maxAgents ?? defaultSettings.maxAgents,
      branchPrefix: normalizeBranchPrefix(parsed.branchPrefix),
      gitUsername: normalizeGitUsername(parsed.gitUsername),
      agentRules: normalizeAgentRules(parsed.agentRules),
      mcpServers: normalizeMcpServers(parsed.mcpServers),
      openaiBaseUrl: parsed.openaiBaseUrl?.trim() || null,
      codexDefaultModel: parsed.codexDefaultModel?.trim() || defaultSettings.codexDefaultModel,
      codexDefaultEffort: normalizeProviderProfile(parsed.codexDefaultEffort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel: parsed.claudeDefaultModel?.trim() || defaultSettings.claudeDefaultModel,
      claudeDefaultEffort: normalizeProviderProfile(parsed.claudeDefaultEffort) ?? defaultSettings.claudeDefaultEffort
    };

    if (
      Object.prototype.hasOwnProperty.call(parsed, "autoModeEnabled") ||
      parsed.defaultProvider !== normalizedBase.defaultProvider ||
      parsed.maxAgents !== normalizedBase.maxAgents ||
      parsed.branchPrefix !== normalizedBase.branchPrefix ||
      parsed.gitUsername !== normalizedBase.gitUsername ||
      parsed.agentRules !== normalizedBase.agentRules ||
      JSON.stringify(parsed.mcpServers ?? []) !== JSON.stringify(normalizedBase.mcpServers) ||
      (parsed.openaiBaseUrl?.trim() || null) !== normalizedBase.openaiBaseUrl
    ) {
      await this.redis.set(SETTINGS_KEY, JSON.stringify(normalizedBase));
    }

    const credentialStatus = await this.credentialStore.getCredentialStatus();
    return {
      ...normalizedBase,
      ...credentialStatus
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SystemSettings> {
    const current = await this.getSettings();
    const nextBase = {
      defaultProvider: normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider),
      maxAgents: input.maxAgents ?? current.maxAgents,
      branchPrefix: normalizeBranchPrefix(input.branchPrefix ?? current.branchPrefix),
      gitUsername: normalizeGitUsername(input.gitUsername ?? current.gitUsername),
      agentRules:
        input.agentRules === undefined ? current.agentRules : normalizeAgentRules(input.agentRules),
      mcpServers:
        input.mcpServers === undefined ? current.mcpServers : normalizeMcpServers(input.mcpServers),
      openaiBaseUrl:
        input.openaiBaseUrl === undefined
          ? current.openaiBaseUrl
          : input.openaiBaseUrl?.trim()
            ? input.openaiBaseUrl.trim()
            : null,
      codexDefaultModel: input.codexDefaultModel?.trim() || current.codexDefaultModel,
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: input.claudeDefaultModel?.trim() || current.claudeDefaultModel,
      claudeDefaultEffort: normalizeProviderProfile(input.claudeDefaultEffort) ?? current.claudeDefaultEffort
    };

    await this.redis.set(SETTINGS_KEY, JSON.stringify(nextBase));
    const next = await this.getSettings();
    await this.publishSettings(next);
    return next;
  }

  async updateCredentials(input: UpdateCredentialSettingsInput): Promise<SystemSettings> {
    await this.credentialStore.updateCredentials(input);
    const settings = await this.getSettings();
    await this.publishSettings(settings);
    return settings;
  }

  async getRuntimeCredentials(): Promise<
    RuntimeCredentials & { gitUsername: string; openaiBaseUrl: string | null; defaultProvider: AgentProvider }
  > {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);

    return {
      ...credentials,
      gitUsername: settings.gitUsername,
      openaiBaseUrl: settings.openaiBaseUrl,
      defaultProvider: settings.defaultProvider
    };
  }
}
