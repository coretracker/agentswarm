import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  AgentProvider,
  type AgentResponsePreference,
  type AudienceType,
  SystemDataStores,
  McpServerConfig,
  ProviderProfile,
  type ResponsePreferencePreset,
  type ResponsePreferencePresetInput,
  SystemSettings,
  UpdateCredentialSettingsInput,
  UpdateSettingsInput
} from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { EventBus } from "../lib/events.js";
import { normalizeProvider, DEFAULT_PROVIDER, normalizeProviderProfile } from "../lib/provider-config.js";
import { defaultModelForProvider } from "../lib/provider-config.js";
import type { CredentialStore, RuntimeCredentials } from "./credential-store.js";

const SETTINGS_KEY = "agentswarm:settings";
const SYSTEM_RESPONSE_PREFERENCE_PRESET_ID = "neutral";

const DEFAULT_CODEX_EFFORT: ProviderProfile = "high";
const DEFAULT_CLAUDE_EFFORT: ProviderProfile = "high";
const DEFAULT_AGENT_RESPONSE_PREFERENCE: AgentResponsePreference = {};

const nowIso = (): string => new Date().toISOString();

const buildSystemResponsePreferencePreset = (): ResponsePreferencePreset => ({
  id: SYSTEM_RESPONSE_PREFERENCE_PRESET_ID,
  name: "Neutral",
  description: "No tailored response style. The agent responds normally.",
  preference: DEFAULT_AGENT_RESPONSE_PREFERENCE,
  isSystem: true,
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z"
});

const buildSystemDataStores = (): SystemDataStores => ({
  taskStore: env.STORE_BACKENDS.taskStore,
  snippetStore: env.STORE_BACKENDS.snippetStore,
  repositoryStore: env.STORE_BACKENDS.repositoryStore,
  credentialStore: env.STORE_BACKENDS.credentialStore,
  roleStore: env.STORE_BACKENDS.roleStore,
  userStore: env.STORE_BACKENDS.userStore,
  settingsStore: env.STORE_BACKENDS.settingsStore,
  taskQueueStore: "redis",
  webhookDeliveryStore: "redis",
  sessionStore: "redis",
  eventBus: "redis"
});

const defaultSettings: SystemSettings = {
  defaultProvider: DEFAULT_PROVIDER,
  maxAgents: 2,
  branchPrefix: "agentswarm",
  gitUsername: "x-access-token",
  mcpServers: [],
  openaiBaseUrl: null,
  githubTokenConfigured: false,
  openaiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  codexDefaultModel: defaultModelForProvider("codex", DEFAULT_CODEX_EFFORT) ?? "gpt-5.4",
  codexDefaultEffort: DEFAULT_CODEX_EFFORT,
  claudeDefaultModel: defaultModelForProvider("claude", DEFAULT_CLAUDE_EFFORT) ?? "claude-sonnet-4-5",
  claudeDefaultEffort: DEFAULT_CLAUDE_EFFORT,
  responsePreferencePresets: [buildSystemResponsePreferencePreset()],
  dataStores: buildSystemDataStores()
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

const MCP_BEARER_TOKEN_ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeMcpBearerTokenEnvVar = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !MCP_BEARER_TOKEN_ENV_VAR_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
};

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
        bearerTokenEnvVar: normalizeMcpBearerTokenEnvVar(server.bearerTokenEnvVar)
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

const normalizeResponsePreferencePresetName = (value: string | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, " ");

const normalizeResponsePreferencePresetDescription = (value: string | undefined): string => (value ?? "").trim();

const RESPONSE_AUDIENCES = new Set<AudienceType>(["technical", "non_technical", "mixed"]);
const RESPONSE_EXPLANATION_DEPTH = new Set(["one_line", "brief", "standard", "detailed", "deep_dive"]);
const RESPONSE_JARGON_LEVEL = new Set(["avoid", "balanced", "expert"]);
const RESPONSE_CODE_PREFERENCE = new Set(["only_when_needed", "prefer_examples", "avoid_code"]);
const RESPONSE_CLARIFY_BEHAVIOR = new Set(["ask_when_ambiguous", "make_reasonable_assumptions"]);
const RESPONSE_FORMATTING_STYLE = new Set(["direct", "teaching", "executive", "step_by_step", "checklist", "qa", "problem_solution"]);

const normalizeAgentResponsePreference = (
  value: Partial<AgentResponsePreference> | AgentResponsePreference | null | undefined
): AgentResponsePreference => ({
  audience: (() => {
    if (typeof value?.audience === "string" && RESPONSE_AUDIENCES.has(value.audience as AudienceType)) {
      return value.audience as AudienceType;
    }
    if ((value as { style?: string } | undefined)?.style === "technical" || (value as { style?: string } | undefined)?.style === "non_technical") {
      return (value as { style?: AudienceType }).style;
    }
    return undefined;
  })(),
  explanationDepth:
    typeof value?.explanationDepth === "string" && RESPONSE_EXPLANATION_DEPTH.has(value.explanationDepth)
      ? value.explanationDepth
      : undefined,
  jargonLevel:
    typeof value?.jargonLevel === "string" && RESPONSE_JARGON_LEVEL.has(value.jargonLevel)
      ? value.jargonLevel
      : undefined,
  codePreference:
    typeof value?.codePreference === "string" && RESPONSE_CODE_PREFERENCE.has(value.codePreference)
      ? value.codePreference
      : undefined,
  clarifyBehavior:
    typeof value?.clarifyBehavior === "string" && RESPONSE_CLARIFY_BEHAVIOR.has(value.clarifyBehavior)
      ? value.clarifyBehavior
      : undefined,
  formattingStyle:
    typeof value?.formattingStyle === "string" && RESPONSE_FORMATTING_STYLE.has(value.formattingStyle)
      ? value.formattingStyle
      : undefined,
  extraInstructions: value?.extraInstructions?.trim() || undefined
});

const normalizeResponsePreferencePresets = (
  value: ResponsePreferencePresetInput[] | ResponsePreferencePreset[] | undefined
): ResponsePreferencePreset[] => {
  const systemPreset = buildSystemResponsePreferencePreset();
  const presets: ResponsePreferencePreset[] = [];
  const seenIds = new Set<string>([systemPreset.id]);
  const seenNames = new Set<string>([systemPreset.name.toLowerCase()]);

  for (const rawPreset of value ?? []) {
    const presetId = typeof rawPreset.id === "string" && rawPreset.id.trim() ? rawPreset.id.trim() : randomUUID();
    if (presetId === systemPreset.id || seenIds.has(presetId)) {
      continue;
    }

    const name = normalizeResponsePreferencePresetName(rawPreset.name);
    const normalizedNameKey = name.toLowerCase();
    if (!name || seenNames.has(normalizedNameKey)) {
      continue;
    }

    presets.push({
      id: presetId,
      name,
      description: normalizeResponsePreferencePresetDescription(rawPreset.description),
      preference: normalizeAgentResponsePreference(rawPreset.preference),
      isSystem: false,
      createdAt: "createdAt" in rawPreset && typeof rawPreset.createdAt === "string" ? rawPreset.createdAt : nowIso(),
      updatedAt: nowIso()
    });
    seenIds.add(presetId);
    seenNames.add(normalizedNameKey);
  }

  return [systemPreset, ...presets].sort((left, right) => {
    if (left.isSystem !== right.isSystem) {
      return left.isSystem ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
};

export interface SettingsRuntimeCredentials extends RuntimeCredentials {
  gitUsername: string;
  openaiBaseUrl: string | null;
  defaultProvider: AgentProvider;
}

export interface SettingsStore {
  getSettings(): Promise<SystemSettings>;
  updateSettings(input: UpdateSettingsInput): Promise<SystemSettings>;
  updateCredentials(input: UpdateCredentialSettingsInput): Promise<SystemSettings>;
  getRuntimeCredentials(userId?: string | null): Promise<SettingsRuntimeCredentials>;
}

export class RedisSettingsStore implements SettingsStore {
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
        mcpServers: defaultSettings.mcpServers,
        openaiBaseUrl: defaultSettings.openaiBaseUrl,
        codexDefaultModel: defaultSettings.codexDefaultModel,
        codexDefaultEffort: defaultSettings.codexDefaultEffort,
        claudeDefaultModel: defaultSettings.claudeDefaultModel,
        claudeDefaultEffort: defaultSettings.claudeDefaultEffort,
        responsePreferencePresets: defaultSettings.responsePreferencePresets
      };
      await this.redis.set(SETTINGS_KEY, JSON.stringify(baseSettings));
    }

    const parsed = raw ? (JSON.parse(raw) as Partial<SystemSettings> & { agentRules?: string; autoModeEnabled?: boolean }) : {};
    const normalizedBase = {
      defaultProvider: normalizeDefaultProvider(parsed.defaultProvider),
      maxAgents: parsed.maxAgents ?? defaultSettings.maxAgents,
      branchPrefix: normalizeBranchPrefix(parsed.branchPrefix),
      gitUsername: normalizeGitUsername(parsed.gitUsername),
      mcpServers: normalizeMcpServers(parsed.mcpServers),
      openaiBaseUrl: parsed.openaiBaseUrl?.trim() || null,
      codexDefaultModel: parsed.codexDefaultModel?.trim() || defaultSettings.codexDefaultModel,
      codexDefaultEffort: normalizeProviderProfile(parsed.codexDefaultEffort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel: parsed.claudeDefaultModel?.trim() || defaultSettings.claudeDefaultModel,
      claudeDefaultEffort: normalizeProviderProfile(parsed.claudeDefaultEffort) ?? defaultSettings.claudeDefaultEffort,
      responsePreferencePresets: normalizeResponsePreferencePresets(parsed.responsePreferencePresets)
    };

    if (
      Object.prototype.hasOwnProperty.call(parsed, "autoModeEnabled") ||
      Object.prototype.hasOwnProperty.call(parsed, "agentRules") ||
      parsed.defaultProvider !== normalizedBase.defaultProvider ||
      parsed.maxAgents !== normalizedBase.maxAgents ||
      parsed.branchPrefix !== normalizedBase.branchPrefix ||
      parsed.gitUsername !== normalizedBase.gitUsername ||
      JSON.stringify(parsed.mcpServers ?? []) !== JSON.stringify(normalizedBase.mcpServers) ||
      (parsed.openaiBaseUrl?.trim() || null) !== normalizedBase.openaiBaseUrl ||
      JSON.stringify(parsed.responsePreferencePresets ?? []) !== JSON.stringify(normalizedBase.responsePreferencePresets)
    ) {
      await this.redis.set(SETTINGS_KEY, JSON.stringify(normalizedBase));
    }

    const credentialStatus = await this.credentialStore.getCredentialStatus();
    return {
      ...normalizedBase,
      ...credentialStatus,
      dataStores: buildSystemDataStores()
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SystemSettings> {
    const current = await this.getSettings();
    const nextBase = {
      defaultProvider: normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider),
      maxAgents: input.maxAgents ?? current.maxAgents,
      branchPrefix: normalizeBranchPrefix(input.branchPrefix ?? current.branchPrefix),
      gitUsername: normalizeGitUsername(input.gitUsername ?? current.gitUsername),
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
      claudeDefaultEffort: normalizeProviderProfile(input.claudeDefaultEffort) ?? current.claudeDefaultEffort,
      responsePreferencePresets:
        input.responsePreferencePresets === undefined
          ? current.responsePreferencePresets
          : normalizeResponsePreferencePresets(input.responsePreferencePresets)
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

  async getRuntimeCredentials(userId?: string | null): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);
    const codexAuthJson = userId?.trim()
      ? await this.credentialStore.getCodexAuthJsonForUser(userId.trim())
      : null;

    return {
      ...credentials,
      codexAuthJson: codexAuthJson || null,
      gitUsername: settings.gitUsername,
      openaiBaseUrl: settings.openaiBaseUrl,
      defaultProvider: settings.defaultProvider
    };
  }
}

export class PostgresSettingsStore implements SettingsStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus,
    private readonly credentialStore: CredentialStore
  ) {}

  private async publishSettings(settings: SystemSettings): Promise<void> {
    await this.eventBus.publish({ type: "settings:updated", payload: settings });
  }

  private async ensureBaseSettingsRow(): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO system_settings (
          singleton_id,
          default_provider,
          max_agents,
          branch_prefix,
          git_username,
          mcp_servers,
          openai_base_url,
          codex_default_model,
          codex_default_effort,
          claude_default_model,
          claude_default_effort,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (singleton_id) DO NOTHING
      `,
      [
        defaultSettings.defaultProvider,
        defaultSettings.maxAgents,
        defaultSettings.branchPrefix,
        defaultSettings.gitUsername,
        JSON.stringify(defaultSettings.mcpServers),
        defaultSettings.openaiBaseUrl,
        defaultSettings.codexDefaultModel,
        defaultSettings.codexDefaultEffort,
        defaultSettings.claudeDefaultModel,
        defaultSettings.claudeDefaultEffort,
        JSON.stringify(defaultSettings.responsePreferencePresets)
      ]
    );
  }

  async getSettings(): Promise<SystemSettings> {
    await this.ensureBaseSettingsRow();
    const result = await this.pool.query(
      `
        SELECT
          default_provider,
          max_agents,
          branch_prefix,
          git_username,
          mcp_servers,
          openai_base_url,
          codex_default_model,
          codex_default_effort,
          claude_default_model,
          claude_default_effort,
          response_preference_presets
        FROM system_settings
        WHERE singleton_id = 1
      `
    );
    const row = result.rows[0];
    const normalizedBase = {
      defaultProvider: normalizeDefaultProvider(row?.default_provider),
      maxAgents: typeof row?.max_agents === "number" ? row.max_agents : defaultSettings.maxAgents,
      branchPrefix: normalizeBranchPrefix(typeof row?.branch_prefix === "string" ? row.branch_prefix : undefined),
      gitUsername: normalizeGitUsername(typeof row?.git_username === "string" ? row.git_username : undefined),
      mcpServers: normalizeMcpServers(Array.isArray(row?.mcp_servers) ? (row.mcp_servers as McpServerConfig[]) : undefined),
      openaiBaseUrl: typeof row?.openai_base_url === "string" && row.openai_base_url.trim().length > 0 ? row.openai_base_url.trim() : null,
      codexDefaultModel:
        typeof row?.codex_default_model === "string" && row.codex_default_model.trim().length > 0
          ? row.codex_default_model.trim()
          : defaultSettings.codexDefaultModel,
      codexDefaultEffort: normalizeProviderProfile(row?.codex_default_effort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel:
        typeof row?.claude_default_model === "string" && row.claude_default_model.trim().length > 0
          ? row.claude_default_model.trim()
          : defaultSettings.claudeDefaultModel,
      claudeDefaultEffort: normalizeProviderProfile(row?.claude_default_effort) ?? defaultSettings.claudeDefaultEffort,
      responsePreferencePresets: normalizeResponsePreferencePresets(
        Array.isArray(row?.response_preference_presets) ? (row.response_preference_presets as ResponsePreferencePreset[]) : undefined
      )
    };

    const credentialStatus = await this.credentialStore.getCredentialStatus();
    return {
      ...normalizedBase,
      ...credentialStatus,
      dataStores: buildSystemDataStores()
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SystemSettings> {
    const current = await this.getSettings();
    const nextBase = {
      defaultProvider: normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider),
      maxAgents: input.maxAgents ?? current.maxAgents,
      branchPrefix: normalizeBranchPrefix(input.branchPrefix ?? current.branchPrefix),
      gitUsername: normalizeGitUsername(input.gitUsername ?? current.gitUsername),
      mcpServers: input.mcpServers === undefined ? current.mcpServers : normalizeMcpServers(input.mcpServers),
      openaiBaseUrl:
        input.openaiBaseUrl === undefined
          ? current.openaiBaseUrl
          : input.openaiBaseUrl?.trim()
            ? input.openaiBaseUrl.trim()
            : null,
      codexDefaultModel: input.codexDefaultModel?.trim() || current.codexDefaultModel,
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: input.claudeDefaultModel?.trim() || current.claudeDefaultModel,
      claudeDefaultEffort: normalizeProviderProfile(input.claudeDefaultEffort) ?? current.claudeDefaultEffort,
      responsePreferencePresets:
        input.responsePreferencePresets === undefined
          ? current.responsePreferencePresets
          : normalizeResponsePreferencePresets(input.responsePreferencePresets)
    };

    await this.pool.query(
      `
        INSERT INTO system_settings (
          singleton_id,
          default_provider,
          max_agents,
          branch_prefix,
          git_username,
          mcp_servers,
          openai_base_url,
          codex_default_model,
          codex_default_effort,
          claude_default_model,
          claude_default_effort,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (singleton_id) DO UPDATE
        SET
          default_provider = EXCLUDED.default_provider,
          max_agents = EXCLUDED.max_agents,
          branch_prefix = EXCLUDED.branch_prefix,
          git_username = EXCLUDED.git_username,
          mcp_servers = EXCLUDED.mcp_servers,
          openai_base_url = EXCLUDED.openai_base_url,
          codex_default_model = EXCLUDED.codex_default_model,
          codex_default_effort = EXCLUDED.codex_default_effort,
          claude_default_model = EXCLUDED.claude_default_model,
          claude_default_effort = EXCLUDED.claude_default_effort,
          response_preference_presets = EXCLUDED.response_preference_presets
      `,
      [
        nextBase.defaultProvider,
        nextBase.maxAgents,
        nextBase.branchPrefix,
        nextBase.gitUsername,
        JSON.stringify(nextBase.mcpServers),
        nextBase.openaiBaseUrl,
        nextBase.codexDefaultModel,
        nextBase.codexDefaultEffort,
        nextBase.claudeDefaultModel,
        nextBase.claudeDefaultEffort,
        JSON.stringify(nextBase.responsePreferencePresets)
      ]
    );
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

  async getRuntimeCredentials(userId?: string | null): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);
    const codexAuthJson = userId?.trim()
      ? await this.credentialStore.getCodexAuthJsonForUser(userId.trim())
      : null;

    return {
      ...credentials,
      codexAuthJson: codexAuthJson || null,
      gitUsername: settings.gitUsername,
      openaiBaseUrl: settings.openaiBaseUrl,
      defaultProvider: settings.defaultProvider
    };
  }
}
