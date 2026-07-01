import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  AgentProvider,
  AgentResponsePreference,
  AudienceType,
  McpServerConfig,
  RepositorySlackEventStatus,
  SystemDataStores,
  ProviderModelOption,
  ProviderProfile,
  WorkspaceProvisioningMode,
  ResponsePreferencePreset,
  ResponsePreferencePresetInput,
  SystemSettings,
  UserNotes,
  UpdateCredentialSettingsInput,
  UpdateSettingsInput
} from "@agentswarm/shared-types";
import { CODEX_MODELS, CLAUDE_MODELS } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { defaultHostexecSettings, normalizeHostexecSettings } from "../lib/hostexec-config.js";
import { normalizeMcpServers } from "../lib/mcp-config.js";
import { normalizeProvider, DEFAULT_PROVIDER, normalizeProviderProfile } from "../lib/provider-config.js";
import { defaultModelForProvider } from "../lib/provider-config.js";
import type { CredentialStore, RuntimeCredentials } from "./credential-store.js";

const SETTINGS_KEY = "agentswarm:settings";
const USER_NOTES_KEY_PREFIX = "agentswarm:user-notes:";
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
  taskStore: "postgres",
  snippetStore: "postgres",
  repositoryStore: "postgres",
  credentialStore: "postgres",
  roleStore: "postgres",
  userStore: "postgres",
  settingsStore: "postgres",
  taskQueueStore: "redis",
  webhookDeliveryStore: "redis",
  sessionStore: "redis",
  eventBus: "redis"
});

const defaultSettings: SystemSettings = {
  defaultProvider: DEFAULT_PROVIDER,
  maxAgents: 2,
  branchPrefix: "agentswarm",
  workspaceProvisioningMode: "clone_only",
  gitUsername: "x-access-token",
  gitAuthorName: null,
  gitAuthorEmail: null,
  hostexec: defaultHostexecSettings,
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  taskPromptMagicModel: "gpt-5.4-mini",
  taskPromptMagicTemplate:
    "You are an expert prompt editor for software engineering tasks.\nRewrite the user request into a clear, execution-ready task prompt for an autonomous coding agent.\n\nRequirements:\n- Preserve intent and constraints.\n- Make it specific and actionable.\n- Include acceptance criteria when implied.\n- Avoid changing requested scope.\n- Return plain text only, no markdown fences.\n\nUser request:\n{{user_request}}\n",
  githubTokenConfigured: false,
  openaiApiKeyConfigured: false,
  codexAuthJsonConfigured: false,
  anthropicApiKeyConfigured: false,
  codexDefaultModel: defaultModelForProvider("codex", DEFAULT_CODEX_EFFORT) ?? "gpt-5.5",
  codexModels: CODEX_MODELS,
  codexDefaultEffort: DEFAULT_CODEX_EFFORT,
  claudeDefaultModel: defaultModelForProvider("claude", DEFAULT_CLAUDE_EFFORT) ?? "claude-opus-4-8",
  claudeModels: CLAUDE_MODELS,
  claudeDefaultEffort: DEFAULT_CLAUDE_EFFORT,
  slackAgentMcpServers: [],
  slackAssistantProvider: DEFAULT_PROVIDER,
  slackAssistantModel: defaultModelForProvider(DEFAULT_PROVIDER, DEFAULT_CODEX_EFFORT) ?? "gpt-5.5",
  slackBotTokenConfigured: false,
  slackSigningSecretConfigured: false,
  slackLastEventAt: null,
  slackLastEventStatus: null,
  slackLastEventType: null,
  slackLastEventError: null,
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

const normalizeOptionalGitAuthorName = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
};

const normalizeOptionalGitAuthorEmail = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
};

const normalizeOptionalUrl = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized || null;
};

const normalizeSecret = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const MCP_BEARER_TOKEN_ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLACK_MCP_BEARER_TOKEN_ENV_PREFIX = "AGENTSWARM_SLACK_MCP_BEARER_";

type StoredSlackAgentMcpServer = McpServerConfig & { bearerToken?: string | null };

const normalizeMcpServerName = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeBearerTokenEnvVarName = (value: string | null | undefined): string | null => {
  const normalized = normalizeSecret(value);
  if (!normalized || !MCP_BEARER_TOKEN_ENV_VAR_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
};

const normalizeSlackMcpBearerEnvVarSegment = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const nextSlackMcpBearerTokenEnvVar = (serverName: string, used: Set<string>): string => {
  const base = `${SLACK_MCP_BEARER_TOKEN_ENV_PREFIX}${normalizeSlackMcpBearerEnvVarSegment(serverName) || "SERVER"}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let counter = 2;
  while (used.has(`${base}_${counter}`)) {
    counter += 1;
  }
  const generated = `${base}_${counter}`;
  used.add(generated);
  return generated;
};

const parseStoredSlackAgentMcpServers = (value: unknown): StoredSlackAgentMcpServer[] =>
  Array.isArray(value) ? (value as StoredSlackAgentMcpServer[]) : [];

const storedSlackAgentMcpBearerTokensByName = (servers: StoredSlackAgentMcpServer[]): Map<string, string> => {
  const tokensByName = new Map<string, string>();
  for (const server of servers) {
    const name = normalizeMcpServerName(server.name);
    if (!name || tokensByName.has(name)) {
      continue;
    }
    const bearerToken = normalizeSecret(server.bearerToken);
    if (bearerToken) {
      tokensByName.set(name, bearerToken);
    }
  }
  return tokensByName;
};

const normalizeSlackAgentMcpServersForRead = (servers: StoredSlackAgentMcpServer[]): McpServerConfig[] => {
  const normalizedServers = normalizeMcpServers(servers);
  const bearerTokensByName = storedSlackAgentMcpBearerTokensByName(servers);
  return normalizedServers.map((server) => {
    if (server.transport !== "http") {
      return server;
    }
    if (!bearerTokensByName.has(server.name)) {
      return server;
    }
    return {
      ...server,
      bearerTokenConfigured: true
    };
  });
};

const normalizeSlackAgentMcpServersForStorage = (
  nextInput: McpServerConfig[] | undefined,
  currentStoredServers: StoredSlackAgentMcpServer[]
): StoredSlackAgentMcpServer[] => {
  const normalizedServers = normalizeMcpServers(nextInput ?? currentStoredServers);
  const currentBearerTokensByName = storedSlackAgentMcpBearerTokensByName(currentStoredServers);
  const nextInputByName = new Map<string, McpServerConfig>();
  for (const server of nextInput ?? []) {
    const name = normalizeMcpServerName(server.name);
    if (!name || nextInputByName.has(name)) {
      continue;
    }
    nextInputByName.set(name, server);
  }

  return normalizedServers.map((server) => {
    if (server.transport !== "http") {
      return server;
    }
    const input = nextInputByName.get(server.name);
    const nextBearerToken = input?.clearBearerToken
      ? null
      : normalizeSecret(input?.bearerToken) ?? currentBearerTokensByName.get(server.name) ?? null;
    if (!nextBearerToken) {
      return server;
    }
    return {
      ...server,
      bearerToken: nextBearerToken
    };
  });
};

const buildSlackIntegrationRuntimeMcp = (
  servers: StoredSlackAgentMcpServer[]
): { servers: McpServerConfig[]; env: Record<string, string> } => {
  const mcpServers = normalizeSlackAgentMcpServersForRead(servers);
  const bearerTokensByName = storedSlackAgentMcpBearerTokensByName(servers);
  const usedEnvVarNames = new Set(
    mcpServers
      .map((server) => (server.transport === "http" ? normalizeBearerTokenEnvVarName(server.bearerTokenEnvVar) : null))
      .filter((name): name is string => Boolean(name))
  );
  const env: Record<string, string> = {};

  return {
    servers: mcpServers.map((server) => {
      if (server.transport !== "http") {
        return server;
      }
      const bearerToken = bearerTokensByName.get(server.name);
      if (!bearerToken) {
        return server;
      }
      const envVarName =
        normalizeBearerTokenEnvVarName(server.bearerTokenEnvVar) ?? nextSlackMcpBearerTokenEnvVar(server.name, usedEnvVarNames);
      usedEnvVarNames.add(envVarName);
      env[envVarName] = bearerToken;
      return {
        ...server,
        bearerTokenEnvVar: envVarName,
        bearerTokenConfigured: true
      };
    }),
    env
  };
};

const normalizeSlackEventValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeSlackEventStatus = (value: unknown): RepositorySlackEventStatus | null =>
  value === "received" || value === "ignored" || value === "failed" ? value : null;

const normalizeDefaultProvider = (value: AgentProvider | string | undefined): AgentProvider =>
  normalizeProvider(value ?? defaultSettings.defaultProvider);

const defaultSlackAssistantModel = (
  provider: AgentProvider,
  codexDefaultModel: string,
  claudeDefaultModel: string
): string => (provider === "claude" ? claudeDefaultModel : codexDefaultModel);

const normalizeSlackAssistantProvider = (
  value: AgentProvider | string | undefined,
  fallbackProvider: AgentProvider
): AgentProvider => normalizeProvider(value ?? fallbackProvider);

const normalizeSlackAssistantModel = (
  value: unknown,
  provider: AgentProvider,
  codexDefaultModel: string,
  claudeDefaultModel: string
): string => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return defaultSlackAssistantModel(provider, codexDefaultModel, claudeDefaultModel);
};

const normalizeWorkspaceProvisioningMode = (value: WorkspaceProvisioningMode | string | undefined): WorkspaceProvisioningMode =>
  value === "hybrid" ? "hybrid" : "clone_only";

const normalizeProviderModels = (value: ProviderModelOption[] | undefined, fallback: ProviderModelOption[]): ProviderModelOption[] => {
  const normalized: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of value ?? []) {
    const modelValue = model.value?.trim();
    if (!modelValue || seenValues.has(modelValue)) {
      continue;
    }
    const label = model.label?.trim() || modelValue;
    normalized.push({ label, value: modelValue });
    seenValues.add(modelValue);
  }

  return normalized.length > 0 ? normalized : fallback;
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
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  openaiBaseUrl: string | null;
  anthropicBaseUrl: string | null;
  defaultProvider: AgentProvider;
}

export interface SlackIntegrationSettings {
  botToken: string;
  signingSecret: string;
  slackAgentMcpServers: McpServerConfig[];
  slackAssistantProvider: AgentProvider;
  slackAssistantModel: string;
  mcpRuntimeEnv?: Record<string, string>;
}

export interface RecordSlackEventResultInput {
  status: RepositorySlackEventStatus;
  receivedAt: string;
  eventType?: string | null;
  errorMessage?: string | null;
}

type RuntimeCodexCredentialSource = "auto" | "global" | "profile";

export interface SettingsStore {
  getSettings(): Promise<SystemSettings>;
  updateSettings(input: UpdateSettingsInput): Promise<SystemSettings>;
  updateCredentials(input: UpdateCredentialSettingsInput): Promise<SystemSettings>;
  getRuntimeCredentials(userId?: string | null, codexCredentialSource?: RuntimeCodexCredentialSource): Promise<SettingsRuntimeCredentials>;
  getSlackIntegration(): Promise<SlackIntegrationSettings | null>;
  recordSlackEventResult(input: RecordSlackEventResultInput): Promise<SystemSettings>;
  getUserNotes(userId: string): Promise<UserNotes>;
  updateUserNotes(userId: string, notes: string): Promise<UserNotes>;
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
        workspaceProvisioningMode: defaultSettings.workspaceProvisioningMode,
        gitUsername: defaultSettings.gitUsername,
        gitAuthorName: defaultSettings.gitAuthorName,
        gitAuthorEmail: defaultSettings.gitAuthorEmail,
        hostexec: defaultSettings.hostexec,
        openaiBaseUrl: defaultSettings.openaiBaseUrl,
        anthropicBaseUrl: defaultSettings.anthropicBaseUrl,
        taskPromptMagicModel: defaultSettings.taskPromptMagicModel,
        taskPromptMagicTemplate: defaultSettings.taskPromptMagicTemplate,
        codexDefaultModel: defaultSettings.codexDefaultModel,
        codexModels: defaultSettings.codexModels,
        codexDefaultEffort: defaultSettings.codexDefaultEffort,
        claudeDefaultModel: defaultSettings.claudeDefaultModel,
        claudeModels: defaultSettings.claudeModels,
        claudeDefaultEffort: defaultSettings.claudeDefaultEffort,
        slackAgentMcpServers: defaultSettings.slackAgentMcpServers,
        slackAssistantProvider: defaultSettings.slackAssistantProvider,
        slackAssistantModel: defaultSettings.slackAssistantModel,
        slackBotToken: null,
        slackSigningSecret: null,
        slackLastEventAt: defaultSettings.slackLastEventAt,
        slackLastEventStatus: defaultSettings.slackLastEventStatus,
        slackLastEventType: defaultSettings.slackLastEventType,
        slackLastEventError: defaultSettings.slackLastEventError,
        responsePreferencePresets: defaultSettings.responsePreferencePresets
      };
      await this.redis.set(SETTINGS_KEY, JSON.stringify(baseSettings));
    }

    const parsed = raw
      ? (JSON.parse(raw) as Partial<SystemSettings> & {
          slackBotToken?: string | null;
          slackSigningSecret?: string | null;
          slackAgentMcpServers?: unknown;
          slackAssistantProvider?: AgentProvider | string;
          slackAssistantModel?: string | null;
          agentRules?: string;
          autoModeEnabled?: boolean;
          mcpServers?: unknown;
        })
      : {};
    const storedSlackAgentMcpServers = normalizeSlackAgentMcpServersForStorage(
      undefined,
      parseStoredSlackAgentMcpServers(parsed.slackAgentMcpServers)
    );
    const slackBotToken = normalizeSecret(parsed.slackBotToken);
    const slackSigningSecret = normalizeSecret(parsed.slackSigningSecret);
    const normalizedDefaultProvider = normalizeDefaultProvider(parsed.defaultProvider);
    const normalizedCodexDefaultModel = parsed.codexDefaultModel?.trim() || defaultSettings.codexDefaultModel;
    const normalizedClaudeDefaultModel = parsed.claudeDefaultModel?.trim() || defaultSettings.claudeDefaultModel;
    const normalizedSlackAssistantProvider = normalizeSlackAssistantProvider(parsed.slackAssistantProvider, normalizedDefaultProvider);
    const normalizedSlackAssistantModel = normalizeSlackAssistantModel(
      parsed.slackAssistantModel,
      normalizedSlackAssistantProvider,
      normalizedCodexDefaultModel,
      normalizedClaudeDefaultModel
    );
    const normalizedBase = {
      defaultProvider: normalizedDefaultProvider,
      maxAgents: parsed.maxAgents ?? defaultSettings.maxAgents,
      branchPrefix: normalizeBranchPrefix(parsed.branchPrefix),
      workspaceProvisioningMode: normalizeWorkspaceProvisioningMode(parsed.workspaceProvisioningMode),
      gitUsername: normalizeGitUsername(parsed.gitUsername),
      gitAuthorName: normalizeOptionalGitAuthorName(parsed.gitAuthorName),
      gitAuthorEmail: normalizeOptionalGitAuthorEmail(parsed.gitAuthorEmail),
      hostexec: normalizeHostexecSettings(parsed.hostexec),
      openaiBaseUrl: normalizeOptionalUrl(parsed.openaiBaseUrl),
      anthropicBaseUrl: normalizeOptionalUrl(parsed.anthropicBaseUrl),
      taskPromptMagicModel: parsed.taskPromptMagicModel?.trim() || defaultSettings.taskPromptMagicModel,
      taskPromptMagicTemplate: parsed.taskPromptMagicTemplate?.trim() || defaultSettings.taskPromptMagicTemplate,
      codexDefaultModel: normalizedCodexDefaultModel,
      codexModels: normalizeProviderModels(parsed.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(parsed.codexDefaultEffort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel: normalizedClaudeDefaultModel,
      claudeModels: normalizeProviderModels(parsed.claudeModels, defaultSettings.claudeModels),
      claudeDefaultEffort: normalizeProviderProfile(parsed.claudeDefaultEffort) ?? defaultSettings.claudeDefaultEffort,
      slackAgentMcpServers: normalizeSlackAgentMcpServersForRead(storedSlackAgentMcpServers),
      slackAssistantProvider: normalizedSlackAssistantProvider,
      slackAssistantModel: normalizedSlackAssistantModel,
      slackBotTokenConfigured: Boolean(slackBotToken),
      slackSigningSecretConfigured: Boolean(slackSigningSecret),
      slackLastEventAt: normalizeSlackEventValue(parsed.slackLastEventAt),
      slackLastEventStatus: normalizeSlackEventStatus(parsed.slackLastEventStatus),
      slackLastEventType: normalizeSlackEventValue(parsed.slackLastEventType),
      slackLastEventError: normalizeSlackEventValue(parsed.slackLastEventError),
      responsePreferencePresets: normalizeResponsePreferencePresets(parsed.responsePreferencePresets)
    };
    const normalizedStorage = {
      ...normalizedBase,
      slackAgentMcpServers: storedSlackAgentMcpServers,
      slackBotToken,
      slackSigningSecret
    };

    if (
      Object.prototype.hasOwnProperty.call(parsed, "autoModeEnabled") ||
      Object.prototype.hasOwnProperty.call(parsed, "agentRules") ||
      parsed.defaultProvider !== normalizedBase.defaultProvider ||
      parsed.maxAgents !== normalizedBase.maxAgents ||
      parsed.branchPrefix !== normalizedBase.branchPrefix ||
      parsed.workspaceProvisioningMode !== normalizedBase.workspaceProvisioningMode ||
      parsed.gitUsername !== normalizedBase.gitUsername ||
      (parsed.gitAuthorName ?? null) !== normalizedBase.gitAuthorName ||
      (parsed.gitAuthorEmail ?? null) !== normalizedBase.gitAuthorEmail ||
      JSON.stringify(parsed.hostexec ?? defaultHostexecSettings) !== JSON.stringify(normalizedBase.hostexec) ||
      Object.prototype.hasOwnProperty.call(parsed, "mcpServers") ||
      normalizeOptionalUrl(parsed.openaiBaseUrl) !== normalizedBase.openaiBaseUrl ||
      normalizeOptionalUrl(parsed.anthropicBaseUrl) !== normalizedBase.anthropicBaseUrl ||
      (parsed.taskPromptMagicModel?.trim() || defaultSettings.taskPromptMagicModel) !== normalizedBase.taskPromptMagicModel ||
      (parsed.taskPromptMagicTemplate?.trim() || defaultSettings.taskPromptMagicTemplate) !== normalizedBase.taskPromptMagicTemplate ||
      JSON.stringify(parsed.codexModels ?? []) !== JSON.stringify(normalizedBase.codexModels) ||
      JSON.stringify(parsed.claudeModels ?? []) !== JSON.stringify(normalizedBase.claudeModels) ||
      JSON.stringify(parseStoredSlackAgentMcpServers(parsed.slackAgentMcpServers)) !== JSON.stringify(storedSlackAgentMcpServers) ||
      normalizeSlackAssistantProvider(parsed.slackAssistantProvider, normalizedDefaultProvider) !== normalizedBase.slackAssistantProvider ||
      normalizeSlackAssistantModel(
        parsed.slackAssistantModel,
        normalizedBase.slackAssistantProvider,
        normalizedBase.codexDefaultModel,
        normalizedBase.claudeDefaultModel
      ) !== normalizedBase.slackAssistantModel ||
      normalizeSecret(parsed.slackBotToken) !== slackBotToken ||
      normalizeSecret(parsed.slackSigningSecret) !== slackSigningSecret ||
      normalizeSlackEventValue(parsed.slackLastEventAt) !== normalizedBase.slackLastEventAt ||
      normalizeSlackEventStatus(parsed.slackLastEventStatus) !== normalizedBase.slackLastEventStatus ||
      normalizeSlackEventValue(parsed.slackLastEventType) !== normalizedBase.slackLastEventType ||
      normalizeSlackEventValue(parsed.slackLastEventError) !== normalizedBase.slackLastEventError ||
      JSON.stringify(parsed.responsePreferencePresets ?? []) !== JSON.stringify(normalizedBase.responsePreferencePresets)
    ) {
      await this.redis.set(SETTINGS_KEY, JSON.stringify(normalizedStorage));
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
    const raw = await this.redis.get(SETTINGS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as {
          slackBotToken?: string | null;
          slackSigningSecret?: string | null;
          slackAgentMcpServers?: unknown;
          slackAssistantProvider?: AgentProvider | string;
          slackAssistantModel?: string | null;
        })
      : {};
    const currentStoredSlackAgentMcpServers = normalizeSlackAgentMcpServersForStorage(
      undefined,
      parseStoredSlackAgentMcpServers(parsed.slackAgentMcpServers)
    );
    const nextStoredSlackAgentMcpServers =
      input.slackAgentMcpServers === undefined
        ? currentStoredSlackAgentMcpServers
        : normalizeSlackAgentMcpServersForStorage(input.slackAgentMcpServers, currentStoredSlackAgentMcpServers);
    const nextSlackAgentMcpServers = normalizeSlackAgentMcpServersForRead(nextStoredSlackAgentMcpServers);
    const currentSlackBotToken = normalizeSecret(parsed.slackBotToken);
    const currentSlackSigningSecret = normalizeSecret(parsed.slackSigningSecret);
    const nextSlackBotToken = input.clearSlackBotToken
      ? null
      : input.slackBotToken !== undefined
        ? normalizeSecret(input.slackBotToken)
        : currentSlackBotToken;
    const nextSlackSigningSecret = input.clearSlackSigningSecret
      ? null
      : input.slackSigningSecret !== undefined
        ? normalizeSecret(input.slackSigningSecret)
        : currentSlackSigningSecret;
    const nextDefaultProvider = normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider);
    const nextCodexDefaultModel = input.codexDefaultModel?.trim() || current.codexDefaultModel;
    const nextClaudeDefaultModel = input.claudeDefaultModel?.trim() || current.claudeDefaultModel;
    const nextSlackAssistantProvider = normalizeSlackAssistantProvider(
      input.slackAssistantProvider ?? current.slackAssistantProvider,
      nextDefaultProvider
    );
    const nextSlackAssistantModel = normalizeSlackAssistantModel(
      input.slackAssistantModel ??
        (input.slackAssistantProvider !== undefined && input.slackAssistantProvider !== current.slackAssistantProvider
          ? null
          : current.slackAssistantModel),
      nextSlackAssistantProvider,
      nextCodexDefaultModel,
      nextClaudeDefaultModel
    );
    const nextBase = {
      defaultProvider: nextDefaultProvider,
      maxAgents: input.maxAgents ?? current.maxAgents,
      branchPrefix: normalizeBranchPrefix(input.branchPrefix ?? current.branchPrefix),
      workspaceProvisioningMode: normalizeWorkspaceProvisioningMode(
        input.workspaceProvisioningMode ?? current.workspaceProvisioningMode
      ),
      gitUsername: normalizeGitUsername(input.gitUsername ?? current.gitUsername),
      gitAuthorName:
        input.gitAuthorName === undefined ? current.gitAuthorName : normalizeOptionalGitAuthorName(input.gitAuthorName),
      gitAuthorEmail:
        input.gitAuthorEmail === undefined ? current.gitAuthorEmail : normalizeOptionalGitAuthorEmail(input.gitAuthorEmail),
      hostexec:
        input.hostexec === undefined
          ? current.hostexec
          : input.hostexec === null
            ? defaultHostexecSettings
            : normalizeHostexecSettings({ ...current.hostexec, ...input.hostexec }),
      openaiBaseUrl:
        input.openaiBaseUrl === undefined
          ? current.openaiBaseUrl
          : normalizeOptionalUrl(input.openaiBaseUrl),
      anthropicBaseUrl:
        input.anthropicBaseUrl === undefined
          ? current.anthropicBaseUrl
          : normalizeOptionalUrl(input.anthropicBaseUrl),
      taskPromptMagicModel: input.taskPromptMagicModel?.trim() || current.taskPromptMagicModel,
      taskPromptMagicTemplate: input.taskPromptMagicTemplate?.trim() || current.taskPromptMagicTemplate,
      codexDefaultModel: nextCodexDefaultModel,
      codexModels: input.codexModels === undefined ? current.codexModels : normalizeProviderModels(input.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: nextClaudeDefaultModel,
      claudeModels: input.claudeModels === undefined ? current.claudeModels : normalizeProviderModels(input.claudeModels, defaultSettings.claudeModels),
      claudeDefaultEffort: normalizeProviderProfile(input.claudeDefaultEffort) ?? current.claudeDefaultEffort,
      slackAgentMcpServers: nextSlackAgentMcpServers,
      slackAssistantProvider: nextSlackAssistantProvider,
      slackAssistantModel: nextSlackAssistantModel,
      slackBotTokenConfigured: Boolean(nextSlackBotToken),
      slackSigningSecretConfigured: Boolean(nextSlackSigningSecret),
      slackLastEventAt: current.slackLastEventAt,
      slackLastEventStatus: current.slackLastEventStatus,
      slackLastEventType: current.slackLastEventType,
      slackLastEventError: current.slackLastEventError,
      responsePreferencePresets:
        input.responsePreferencePresets === undefined
          ? current.responsePreferencePresets
          : normalizeResponsePreferencePresets(input.responsePreferencePresets)
    };
    await this.redis.set(
      SETTINGS_KEY,
      JSON.stringify({
        ...nextBase,
        slackAgentMcpServers: nextStoredSlackAgentMcpServers,
        slackBotToken: nextSlackBotToken,
        slackSigningSecret: nextSlackSigningSecret
      })
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

  async getRuntimeCredentials(_userId?: string | null, _codexCredentialSource: RuntimeCodexCredentialSource = "auto"): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);

    return {
      ...credentials,
      codexAuthJson: credentials.codexAuthJson ?? null,
      gitUsername: settings.gitUsername,
      gitAuthorName: settings.gitAuthorName,
      gitAuthorEmail: settings.gitAuthorEmail,
      openaiBaseUrl: settings.openaiBaseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      defaultProvider: settings.defaultProvider
    };
  }

  async getSlackIntegration(): Promise<SlackIntegrationSettings | null> {
    const raw = await this.redis.get(SETTINGS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as {
          defaultProvider?: AgentProvider | string;
          codexDefaultModel?: string | null;
          claudeDefaultModel?: string | null;
          slackBotToken?: string | null;
          slackSigningSecret?: string | null;
          slackAgentMcpServers?: unknown;
          slackAssistantProvider?: AgentProvider | string;
          slackAssistantModel?: string | null;
        })
      : {};
    const botToken = normalizeSecret(parsed.slackBotToken);
    const signingSecret = normalizeSecret(parsed.slackSigningSecret);
    if (!botToken || !signingSecret) {
      return null;
    }
    const defaultProvider = normalizeDefaultProvider(parsed.defaultProvider);
    const codexDefaultModel = parsed.codexDefaultModel?.trim() || defaultSettings.codexDefaultModel;
    const claudeDefaultModel = parsed.claudeDefaultModel?.trim() || defaultSettings.claudeDefaultModel;
    const slackAssistantProvider = normalizeSlackAssistantProvider(parsed.slackAssistantProvider, defaultProvider);
    const slackAssistantModel = normalizeSlackAssistantModel(
      parsed.slackAssistantModel,
      slackAssistantProvider,
      codexDefaultModel,
      claudeDefaultModel
    );
    const runtimeMcp = buildSlackIntegrationRuntimeMcp(
      normalizeSlackAgentMcpServersForStorage(undefined, parseStoredSlackAgentMcpServers(parsed.slackAgentMcpServers))
    );
    return {
      botToken,
      signingSecret,
      slackAgentMcpServers: runtimeMcp.servers,
      slackAssistantProvider,
      slackAssistantModel,
      mcpRuntimeEnv: runtimeMcp.env
    };
  }

  async recordSlackEventResult(input: RecordSlackEventResultInput): Promise<SystemSettings> {
    const current = await this.getSettings();
    const raw = await this.redis.get(SETTINGS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { slackBotToken?: string | null; slackSigningSecret?: string | null; slackAgentMcpServers?: unknown })
      : {};
    await this.redis.set(
      SETTINGS_KEY,
      JSON.stringify({
        ...current,
        slackAgentMcpServers: normalizeSlackAgentMcpServersForStorage(
          undefined,
          parseStoredSlackAgentMcpServers(parsed.slackAgentMcpServers)
        ),
        slackBotToken: normalizeSecret(parsed.slackBotToken),
        slackSigningSecret: normalizeSecret(parsed.slackSigningSecret),
        slackLastEventAt: input.receivedAt,
        slackLastEventStatus: input.status,
        slackLastEventType: normalizeSlackEventValue(input.eventType),
        slackLastEventError:
          input.status === "failed" || input.status === "ignored"
            ? normalizeSlackEventValue(input.errorMessage)
            : null
      })
    );
    const next = await this.getSettings();
    await this.publishSettings(next);
    return next;
  }

  async getUserNotes(userId: string): Promise<UserNotes> {
    const key = `${USER_NOTES_KEY_PREFIX}${userId}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      const initial: UserNotes = { notes: "", updatedAt: nowIso() };
      await this.redis.set(key, JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(raw) as Partial<UserNotes> | null;
    return {
      notes: typeof parsed?.notes === "string" ? parsed.notes : "",
      updatedAt: typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim().length > 0 ? parsed.updatedAt : nowIso()
    };
  }

  async updateUserNotes(userId: string, notes: string): Promise<UserNotes> {
    const key = `${USER_NOTES_KEY_PREFIX}${userId}`;
    const next: UserNotes = {
      notes,
      updatedAt: nowIso()
    };
    await this.redis.set(key, JSON.stringify(next));
    return next;
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
          workspace_provisioning_mode,
          git_username,
          git_author_name,
          git_author_email,
          hostexec_enabled,
          hostexec_url,
          hostexec_bearer_token_env_var,
          openai_base_url,
          anthropic_base_url,
          task_prompt_magic_model,
          task_prompt_magic_template,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
          slack_agent_mcp_servers,
          slack_assistant_provider,
          slack_assistant_model,
          slack_bot_token,
          slack_signing_secret,
          slack_last_event_at,
          slack_last_event_status,
          slack_last_event_type,
          slack_last_event_error,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19::jsonb, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29, $30::jsonb)
        ON CONFLICT (singleton_id) DO NOTHING
      `,
      [
        defaultSettings.defaultProvider,
        defaultSettings.maxAgents,
        defaultSettings.branchPrefix,
        defaultSettings.workspaceProvisioningMode,
        defaultSettings.gitUsername,
        defaultSettings.gitAuthorName,
        defaultSettings.gitAuthorEmail,
        defaultSettings.hostexec.enabled,
        defaultSettings.hostexec.url,
        defaultSettings.hostexec.bearerTokenEnvVar,
        defaultSettings.openaiBaseUrl,
        defaultSettings.anthropicBaseUrl,
        defaultSettings.taskPromptMagicModel,
        defaultSettings.taskPromptMagicTemplate,
        defaultSettings.codexDefaultModel,
        JSON.stringify(defaultSettings.codexModels),
        defaultSettings.codexDefaultEffort,
        defaultSettings.claudeDefaultModel,
        JSON.stringify(defaultSettings.claudeModels),
        defaultSettings.claudeDefaultEffort,
        JSON.stringify(defaultSettings.slackAgentMcpServers),
        defaultSettings.slackAssistantProvider,
        defaultSettings.slackAssistantModel,
        null,
        null,
        defaultSettings.slackLastEventAt,
        defaultSettings.slackLastEventStatus,
        defaultSettings.slackLastEventType,
        defaultSettings.slackLastEventError,
        JSON.stringify(defaultSettings.responsePreferencePresets)
      ]
    );
  }

  private async getStoredSlackAgentMcpServers(): Promise<StoredSlackAgentMcpServer[]> {
    await this.ensureBaseSettingsRow();
    const result = await this.pool.query<{ slack_agent_mcp_servers: unknown }>(
      `
        SELECT slack_agent_mcp_servers
        FROM system_settings
        WHERE singleton_id = 1
      `
    );
    return normalizeSlackAgentMcpServersForStorage(
      undefined,
      parseStoredSlackAgentMcpServers(result.rows[0]?.slack_agent_mcp_servers)
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
          workspace_provisioning_mode,
          git_username,
          git_author_name,
          git_author_email,
          hostexec_enabled,
          hostexec_url,
          hostexec_bearer_token_env_var,
          openai_base_url,
          anthropic_base_url,
          task_prompt_magic_model,
          task_prompt_magic_template,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
          slack_agent_mcp_servers,
          slack_assistant_provider,
          slack_assistant_model,
          slack_bot_token,
          slack_signing_secret,
          slack_last_event_at,
          slack_last_event_status,
          slack_last_event_type,
          slack_last_event_error,
          response_preference_presets
        FROM system_settings
        WHERE singleton_id = 1
      `
    );
    const row = result.rows[0];
    const normalizedDefaultProvider = normalizeDefaultProvider(row?.default_provider);
    const normalizedCodexDefaultModel =
      typeof row?.codex_default_model === "string" && row.codex_default_model.trim().length > 0
        ? row.codex_default_model.trim()
        : defaultSettings.codexDefaultModel;
    const normalizedClaudeDefaultModel =
      typeof row?.claude_default_model === "string" && row.claude_default_model.trim().length > 0
        ? row.claude_default_model.trim()
        : defaultSettings.claudeDefaultModel;
    const normalizedSlackAssistantProvider = normalizeSlackAssistantProvider(row?.slack_assistant_provider, normalizedDefaultProvider);
    const normalizedSlackAssistantModel = normalizeSlackAssistantModel(
      row?.slack_assistant_model,
      normalizedSlackAssistantProvider,
      normalizedCodexDefaultModel,
      normalizedClaudeDefaultModel
    );
    const normalizedBase = {
      defaultProvider: normalizedDefaultProvider,
      maxAgents: typeof row?.max_agents === "number" ? row.max_agents : defaultSettings.maxAgents,
      branchPrefix: normalizeBranchPrefix(typeof row?.branch_prefix === "string" ? row.branch_prefix : undefined),
      workspaceProvisioningMode: normalizeWorkspaceProvisioningMode(row?.workspace_provisioning_mode),
      gitUsername: normalizeGitUsername(typeof row?.git_username === "string" ? row.git_username : undefined),
      gitAuthorName: normalizeOptionalGitAuthorName(typeof row?.git_author_name === "string" ? row.git_author_name : null),
      gitAuthorEmail: normalizeOptionalGitAuthorEmail(typeof row?.git_author_email === "string" ? row.git_author_email : null),
      hostexec: normalizeHostexecSettings({
        enabled: row?.hostexec_enabled === true,
        url: typeof row?.hostexec_url === "string" ? row.hostexec_url : null,
        bearerTokenEnvVar:
          typeof row?.hostexec_bearer_token_env_var === "string" ? row.hostexec_bearer_token_env_var : null
      }),
      openaiBaseUrl: normalizeOptionalUrl(typeof row?.openai_base_url === "string" ? row.openai_base_url : null),
      anthropicBaseUrl: normalizeOptionalUrl(typeof row?.anthropic_base_url === "string" ? row.anthropic_base_url : null),
      taskPromptMagicModel:
        typeof row?.task_prompt_magic_model === "string" && row.task_prompt_magic_model.trim().length > 0
          ? row.task_prompt_magic_model.trim()
          : defaultSettings.taskPromptMagicModel,
      taskPromptMagicTemplate:
        typeof row?.task_prompt_magic_template === "string" && row.task_prompt_magic_template.trim().length > 0
          ? row.task_prompt_magic_template.trim()
          : defaultSettings.taskPromptMagicTemplate,
      codexDefaultModel: normalizedCodexDefaultModel,
      codexModels: normalizeProviderModels(
        Array.isArray(row?.codex_models) ? (row.codex_models as ProviderModelOption[]) : undefined,
        defaultSettings.codexModels
      ),
      codexDefaultEffort: normalizeProviderProfile(row?.codex_default_effort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel: normalizedClaudeDefaultModel,
      claudeModels: normalizeProviderModels(
        Array.isArray(row?.claude_models) ? (row.claude_models as ProviderModelOption[]) : undefined,
        defaultSettings.claudeModels
      ),
      claudeDefaultEffort: normalizeProviderProfile(row?.claude_default_effort) ?? defaultSettings.claudeDefaultEffort,
      slackAgentMcpServers: normalizeSlackAgentMcpServersForRead(
        normalizeSlackAgentMcpServersForStorage(
          undefined,
          parseStoredSlackAgentMcpServers(row?.slack_agent_mcp_servers)
        )
      ),
      slackAssistantProvider: normalizedSlackAssistantProvider,
      slackAssistantModel: normalizedSlackAssistantModel,
      slackBotTokenConfigured: normalizeSecret(typeof row?.slack_bot_token === "string" ? row.slack_bot_token : null) !== null,
      slackSigningSecretConfigured: normalizeSecret(typeof row?.slack_signing_secret === "string" ? row.slack_signing_secret : null) !== null,
      slackLastEventAt: normalizeSlackEventValue(row?.slack_last_event_at),
      slackLastEventStatus: normalizeSlackEventStatus(row?.slack_last_event_status),
      slackLastEventType: normalizeSlackEventValue(row?.slack_last_event_type),
      slackLastEventError: normalizeSlackEventValue(row?.slack_last_event_error),
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
    const currentStoredSlackAgentMcpServers = await this.getStoredSlackAgentMcpServers();
    const nextStoredSlackAgentMcpServers =
      input.slackAgentMcpServers === undefined
        ? currentStoredSlackAgentMcpServers
        : normalizeSlackAgentMcpServersForStorage(input.slackAgentMcpServers, currentStoredSlackAgentMcpServers);
    const nextSlackAgentMcpServers = normalizeSlackAgentMcpServersForRead(nextStoredSlackAgentMcpServers);
    const currentSlackIntegration = await this.getSlackIntegration();
    const currentSlackBotToken = currentSlackIntegration?.botToken ?? null;
    const currentSlackSigningSecret = currentSlackIntegration?.signingSecret ?? null;
    const nextSlackBotToken = input.clearSlackBotToken
      ? null
      : input.slackBotToken !== undefined
        ? normalizeSecret(input.slackBotToken)
        : currentSlackBotToken;
    const nextSlackSigningSecret = input.clearSlackSigningSecret
      ? null
      : input.slackSigningSecret !== undefined
        ? normalizeSecret(input.slackSigningSecret)
        : currentSlackSigningSecret;
    const nextDefaultProvider = normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider);
    const nextCodexDefaultModel = input.codexDefaultModel?.trim() || current.codexDefaultModel;
    const nextClaudeDefaultModel = input.claudeDefaultModel?.trim() || current.claudeDefaultModel;
    const nextSlackAssistantProvider = normalizeSlackAssistantProvider(
      input.slackAssistantProvider ?? current.slackAssistantProvider,
      nextDefaultProvider
    );
    const nextSlackAssistantModel = normalizeSlackAssistantModel(
      input.slackAssistantModel ??
        (input.slackAssistantProvider !== undefined && input.slackAssistantProvider !== current.slackAssistantProvider
          ? null
          : current.slackAssistantModel),
      nextSlackAssistantProvider,
      nextCodexDefaultModel,
      nextClaudeDefaultModel
    );
    const nextBase = {
      defaultProvider: nextDefaultProvider,
      maxAgents: input.maxAgents ?? current.maxAgents,
      branchPrefix: normalizeBranchPrefix(input.branchPrefix ?? current.branchPrefix),
      workspaceProvisioningMode: normalizeWorkspaceProvisioningMode(
        input.workspaceProvisioningMode ?? current.workspaceProvisioningMode
      ),
      gitUsername: normalizeGitUsername(input.gitUsername ?? current.gitUsername),
      gitAuthorName:
        input.gitAuthorName === undefined ? current.gitAuthorName : normalizeOptionalGitAuthorName(input.gitAuthorName),
      gitAuthorEmail:
        input.gitAuthorEmail === undefined ? current.gitAuthorEmail : normalizeOptionalGitAuthorEmail(input.gitAuthorEmail),
      hostexec:
        input.hostexec === undefined
          ? current.hostexec
          : input.hostexec === null
            ? defaultHostexecSettings
            : normalizeHostexecSettings({ ...current.hostexec, ...input.hostexec }),
      openaiBaseUrl:
        input.openaiBaseUrl === undefined
          ? current.openaiBaseUrl
          : normalizeOptionalUrl(input.openaiBaseUrl),
      anthropicBaseUrl:
        input.anthropicBaseUrl === undefined
          ? current.anthropicBaseUrl
          : normalizeOptionalUrl(input.anthropicBaseUrl),
      taskPromptMagicModel: input.taskPromptMagicModel?.trim() || current.taskPromptMagicModel,
      taskPromptMagicTemplate: input.taskPromptMagicTemplate?.trim() || current.taskPromptMagicTemplate,
      codexDefaultModel: nextCodexDefaultModel,
      codexModels: input.codexModels === undefined ? current.codexModels : normalizeProviderModels(input.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: nextClaudeDefaultModel,
      claudeModels: input.claudeModels === undefined ? current.claudeModels : normalizeProviderModels(input.claudeModels, defaultSettings.claudeModels),
      claudeDefaultEffort: normalizeProviderProfile(input.claudeDefaultEffort) ?? current.claudeDefaultEffort,
      slackAgentMcpServers: nextSlackAgentMcpServers,
      slackAssistantProvider: nextSlackAssistantProvider,
      slackAssistantModel: nextSlackAssistantModel,
      slackBotTokenConfigured: Boolean(nextSlackBotToken),
      slackSigningSecretConfigured: Boolean(nextSlackSigningSecret),
      slackLastEventAt: current.slackLastEventAt,
      slackLastEventStatus: current.slackLastEventStatus,
      slackLastEventType: current.slackLastEventType,
      slackLastEventError: current.slackLastEventError,
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
          workspace_provisioning_mode,
          git_username,
          git_author_name,
          git_author_email,
          hostexec_enabled,
          hostexec_url,
          hostexec_bearer_token_env_var,
          openai_base_url,
          anthropic_base_url,
          task_prompt_magic_model,
          task_prompt_magic_template,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
          slack_agent_mcp_servers,
          slack_assistant_provider,
          slack_assistant_model,
          slack_bot_token,
          slack_signing_secret,
          slack_last_event_at,
          slack_last_event_status,
          slack_last_event_type,
          slack_last_event_error,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19::jsonb, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29, $30::jsonb)
        ON CONFLICT (singleton_id) DO UPDATE
        SET
          default_provider = EXCLUDED.default_provider,
          max_agents = EXCLUDED.max_agents,
          branch_prefix = EXCLUDED.branch_prefix,
          workspace_provisioning_mode = EXCLUDED.workspace_provisioning_mode,
          git_username = EXCLUDED.git_username,
          git_author_name = EXCLUDED.git_author_name,
          git_author_email = EXCLUDED.git_author_email,
          hostexec_enabled = EXCLUDED.hostexec_enabled,
          hostexec_url = EXCLUDED.hostexec_url,
          hostexec_bearer_token_env_var = EXCLUDED.hostexec_bearer_token_env_var,
          openai_base_url = EXCLUDED.openai_base_url,
          anthropic_base_url = EXCLUDED.anthropic_base_url,
          task_prompt_magic_model = EXCLUDED.task_prompt_magic_model,
          task_prompt_magic_template = EXCLUDED.task_prompt_magic_template,
          codex_default_model = EXCLUDED.codex_default_model,
          codex_models = EXCLUDED.codex_models,
          codex_default_effort = EXCLUDED.codex_default_effort,
          claude_default_model = EXCLUDED.claude_default_model,
          claude_models = EXCLUDED.claude_models,
          claude_default_effort = EXCLUDED.claude_default_effort,
          slack_agent_mcp_servers = EXCLUDED.slack_agent_mcp_servers,
          slack_assistant_provider = EXCLUDED.slack_assistant_provider,
          slack_assistant_model = EXCLUDED.slack_assistant_model,
          slack_bot_token = EXCLUDED.slack_bot_token,
          slack_signing_secret = EXCLUDED.slack_signing_secret,
          slack_last_event_at = EXCLUDED.slack_last_event_at,
          slack_last_event_status = EXCLUDED.slack_last_event_status,
          slack_last_event_type = EXCLUDED.slack_last_event_type,
          slack_last_event_error = EXCLUDED.slack_last_event_error,
          response_preference_presets = EXCLUDED.response_preference_presets
      `,
      [
        nextBase.defaultProvider,
        nextBase.maxAgents,
        nextBase.branchPrefix,
        nextBase.workspaceProvisioningMode,
        nextBase.gitUsername,
        nextBase.gitAuthorName,
        nextBase.gitAuthorEmail,
        nextBase.hostexec.enabled,
        nextBase.hostexec.url,
        nextBase.hostexec.bearerTokenEnvVar,
        nextBase.openaiBaseUrl,
        nextBase.anthropicBaseUrl,
        nextBase.taskPromptMagicModel,
        nextBase.taskPromptMagicTemplate,
        nextBase.codexDefaultModel,
        JSON.stringify(nextBase.codexModels),
        nextBase.codexDefaultEffort,
        nextBase.claudeDefaultModel,
        JSON.stringify(nextBase.claudeModels),
        nextBase.claudeDefaultEffort,
        JSON.stringify(nextStoredSlackAgentMcpServers),
        nextBase.slackAssistantProvider,
        nextBase.slackAssistantModel,
        nextSlackBotToken,
        nextSlackSigningSecret,
        nextBase.slackLastEventAt,
        nextBase.slackLastEventStatus,
        nextBase.slackLastEventType,
        nextBase.slackLastEventError,
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

  async getRuntimeCredentials(_userId?: string | null, _codexCredentialSource: RuntimeCodexCredentialSource = "auto"): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);

    return {
      ...credentials,
      codexAuthJson: credentials.codexAuthJson ?? null,
      gitUsername: settings.gitUsername,
      gitAuthorName: settings.gitAuthorName,
      gitAuthorEmail: settings.gitAuthorEmail,
      openaiBaseUrl: settings.openaiBaseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      defaultProvider: settings.defaultProvider
    };
  }

  async getSlackIntegration(): Promise<SlackIntegrationSettings | null> {
    await this.ensureBaseSettingsRow();
    const result = await this.pool.query(
      `
        SELECT
          default_provider,
          codex_default_model,
          claude_default_model,
          slack_bot_token,
          slack_signing_secret,
          slack_agent_mcp_servers,
          slack_assistant_provider,
          slack_assistant_model
        FROM system_settings
        WHERE singleton_id = 1
      `
    );
    const row = result.rows[0];
    const botToken = normalizeSecret(typeof row?.slack_bot_token === "string" ? row.slack_bot_token : null);
    const signingSecret = normalizeSecret(typeof row?.slack_signing_secret === "string" ? row.slack_signing_secret : null);
    if (!botToken || !signingSecret) {
      return null;
    }
    const defaultProvider = normalizeDefaultProvider(row?.default_provider);
    const codexDefaultModel =
      typeof row?.codex_default_model === "string" && row.codex_default_model.trim().length > 0
        ? row.codex_default_model.trim()
        : defaultSettings.codexDefaultModel;
    const claudeDefaultModel =
      typeof row?.claude_default_model === "string" && row.claude_default_model.trim().length > 0
        ? row.claude_default_model.trim()
        : defaultSettings.claudeDefaultModel;
    const slackAssistantProvider = normalizeSlackAssistantProvider(row?.slack_assistant_provider, defaultProvider);
    const slackAssistantModel = normalizeSlackAssistantModel(
      row?.slack_assistant_model,
      slackAssistantProvider,
      codexDefaultModel,
      claudeDefaultModel
    );
    const runtimeMcp = buildSlackIntegrationRuntimeMcp(
      normalizeSlackAgentMcpServersForStorage(undefined, parseStoredSlackAgentMcpServers(row?.slack_agent_mcp_servers))
    );
    return {
      botToken,
      signingSecret,
      slackAgentMcpServers: runtimeMcp.servers,
      slackAssistantProvider,
      slackAssistantModel,
      mcpRuntimeEnv: runtimeMcp.env
    };
  }

  async recordSlackEventResult(input: RecordSlackEventResultInput): Promise<SystemSettings> {
    await this.ensureBaseSettingsRow();
    await this.pool.query(
      `
        UPDATE system_settings
        SET
          slack_last_event_at = $1,
          slack_last_event_status = $2,
          slack_last_event_type = $3,
          slack_last_event_error = $4
        WHERE singleton_id = 1
      `,
      [
        input.receivedAt,
        input.status,
        normalizeSlackEventValue(input.eventType),
        input.status === "failed" || input.status === "ignored"
          ? normalizeSlackEventValue(input.errorMessage)
          : null
      ]
    );
    const next = await this.getSettings();
    await this.publishSettings(next);
    return next;
  }

  async getUserNotes(userId: string): Promise<UserNotes> {
    const result = await this.pool.query(
      `
        SELECT notes, updated_at
        FROM user_notes
        WHERE user_id = $1
      `,
      [userId]
    );
    const row = result.rows[0];
    return {
      notes: typeof row?.notes === "string" ? row.notes : "",
      updatedAt:
        typeof row?.updated_at === "string" && row.updated_at.trim().length > 0
          ? row.updated_at
          : nowIso()
    };
  }

  async updateUserNotes(userId: string, notes: string): Promise<UserNotes> {
    const next: UserNotes = {
      notes,
      updatedAt: nowIso()
    };
    await this.pool.query(
      `
        INSERT INTO user_notes (user_id, notes, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
        SET notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
      `,
      [userId, next.notes, next.updatedAt]
    );
    return next;
  }
}
