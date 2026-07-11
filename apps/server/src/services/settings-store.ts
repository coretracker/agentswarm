import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  AgentProvider,
  AgentResponsePreference,
  AudienceType,
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
} from "@verft/shared-types";
import { CODEX_MODELS, CLAUDE_MODELS } from "@verft/shared-types";
import { EventBus } from "../lib/events.js";
import { defaultHostexecSettings, normalizeHostexecSettings } from "../lib/hostexec-config.js";
import { normalizeProvider, DEFAULT_PROVIDER, normalizeProviderProfile } from "../lib/provider-config.js";
import { defaultModelForProvider } from "../lib/provider-config.js";
import type { CredentialStore, RuntimeCredentials } from "./credential-store.js";

const SETTINGS_KEY = "verft:settings";
const USER_NOTES_KEY_PREFIX = "verft:user-notes:";
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
  archivedTaskAutoDeleteEnabled: true,
  archivedTaskAutoDeleteDays: 7,
  branchPrefix: "verft",
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
  harnessWhatExists: null,
  harnessAllowedActions: null,
  harnessNotAllowedActions: null,
  harnessHowToWork: null,
  harnessDefinitionOfDone: null,
  harnessEvidenceExpectations: null,
  githubTokenConfigured: false,
  openaiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  slackSigningSecretConfigured: false,
  slackBotTokenConfigured: false,
  codexDefaultModel: defaultModelForProvider("codex", DEFAULT_CODEX_EFFORT) ?? "gpt-5.5",
  codexModels: CODEX_MODELS,
  codexDefaultEffort: DEFAULT_CODEX_EFFORT,
  claudeDefaultModel: defaultModelForProvider("claude", DEFAULT_CLAUDE_EFFORT) ?? "claude-opus-4-8",
  claudeModels: CLAUDE_MODELS,
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

const normalizeHarnessValue = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized || null;
};

const normalizeDefaultProvider = (value: AgentProvider | string | undefined): AgentProvider =>
  normalizeProvider(value ?? defaultSettings.defaultProvider);

const normalizeWorkspaceProvisioningMode = (value: WorkspaceProvisioningMode | string | undefined): WorkspaceProvisioningMode =>
  value === "hybrid" ? "hybrid" : "clone_only";

const normalizeArchivedTaskAutoDeleteDays = (value: number | undefined): number => {
  if (typeof value !== "number") {
    return defaultSettings.archivedTaskAutoDeleteDays;
  }
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : defaultSettings.archivedTaskAutoDeleteDays;
};

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

type RuntimeCodexCredentialSource = "auto" | "global" | "profile";

export interface SettingsStore {
  getSettings(): Promise<SystemSettings>;
  updateSettings(input: UpdateSettingsInput): Promise<SystemSettings>;
  updateCredentials(input: UpdateCredentialSettingsInput): Promise<SystemSettings>;
  getRuntimeCredentials(userId?: string | null, codexCredentialSource?: RuntimeCodexCredentialSource): Promise<SettingsRuntimeCredentials>;
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
        archivedTaskAutoDeleteEnabled: defaultSettings.archivedTaskAutoDeleteEnabled,
        archivedTaskAutoDeleteDays: defaultSettings.archivedTaskAutoDeleteDays,
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
        harnessWhatExists: defaultSettings.harnessWhatExists,
        harnessAllowedActions: defaultSettings.harnessAllowedActions,
        harnessNotAllowedActions: defaultSettings.harnessNotAllowedActions,
        harnessHowToWork: defaultSettings.harnessHowToWork,
        harnessDefinitionOfDone: defaultSettings.harnessDefinitionOfDone,
        harnessEvidenceExpectations: defaultSettings.harnessEvidenceExpectations,
        codexDefaultModel: defaultSettings.codexDefaultModel,
        codexModels: defaultSettings.codexModels,
        codexDefaultEffort: defaultSettings.codexDefaultEffort,
        claudeDefaultModel: defaultSettings.claudeDefaultModel,
        claudeModels: defaultSettings.claudeModels,
        claudeDefaultEffort: defaultSettings.claudeDefaultEffort,
        responsePreferencePresets: defaultSettings.responsePreferencePresets
      };
      await this.redis.set(SETTINGS_KEY, JSON.stringify(baseSettings));
    }

    const parsed = raw
      ? (JSON.parse(raw) as Partial<SystemSettings> & {
          agentRules?: string;
          autoModeEnabled?: boolean;
          mcpServers?: unknown;
        })
      : {};
    const normalizedDefaultProvider = normalizeDefaultProvider(parsed.defaultProvider);
    const normalizedCodexDefaultModel = parsed.codexDefaultModel?.trim() || defaultSettings.codexDefaultModel;
    const normalizedClaudeDefaultModel = parsed.claudeDefaultModel?.trim() || defaultSettings.claudeDefaultModel;
    const normalizedBase = {
      defaultProvider: normalizedDefaultProvider,
      maxAgents: parsed.maxAgents ?? defaultSettings.maxAgents,
      archivedTaskAutoDeleteEnabled:
        typeof parsed.archivedTaskAutoDeleteEnabled === "boolean"
          ? parsed.archivedTaskAutoDeleteEnabled
          : defaultSettings.archivedTaskAutoDeleteEnabled,
      archivedTaskAutoDeleteDays: normalizeArchivedTaskAutoDeleteDays(parsed.archivedTaskAutoDeleteDays),
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
      harnessWhatExists: normalizeHarnessValue(parsed.harnessWhatExists),
      harnessAllowedActions: normalizeHarnessValue(parsed.harnessAllowedActions),
      harnessNotAllowedActions: normalizeHarnessValue(parsed.harnessNotAllowedActions),
      harnessHowToWork: normalizeHarnessValue(parsed.harnessHowToWork),
      harnessDefinitionOfDone: normalizeHarnessValue(parsed.harnessDefinitionOfDone),
      harnessEvidenceExpectations: normalizeHarnessValue(parsed.harnessEvidenceExpectations),
      codexDefaultModel: normalizedCodexDefaultModel,
      codexModels: normalizeProviderModels(parsed.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(parsed.codexDefaultEffort) ?? defaultSettings.codexDefaultEffort,
      claudeDefaultModel: normalizedClaudeDefaultModel,
      claudeModels: normalizeProviderModels(parsed.claudeModels, defaultSettings.claudeModels),
      claudeDefaultEffort: normalizeProviderProfile(parsed.claudeDefaultEffort) ?? defaultSettings.claudeDefaultEffort,
      responsePreferencePresets: normalizeResponsePreferencePresets(parsed.responsePreferencePresets)
    };

    if (
      Object.prototype.hasOwnProperty.call(parsed, "autoModeEnabled") ||
      Object.prototype.hasOwnProperty.call(parsed, "agentRules") ||
      parsed.defaultProvider !== normalizedBase.defaultProvider ||
      parsed.maxAgents !== normalizedBase.maxAgents ||
      parsed.archivedTaskAutoDeleteEnabled !== normalizedBase.archivedTaskAutoDeleteEnabled ||
      parsed.archivedTaskAutoDeleteDays !== normalizedBase.archivedTaskAutoDeleteDays ||
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
    const nextDefaultProvider = normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider);
    const nextCodexDefaultModel = input.codexDefaultModel?.trim() || current.codexDefaultModel;
    const nextClaudeDefaultModel = input.claudeDefaultModel?.trim() || current.claudeDefaultModel;
    const nextBase = {
      defaultProvider: nextDefaultProvider,
      maxAgents: input.maxAgents ?? current.maxAgents,
      archivedTaskAutoDeleteEnabled:
        input.archivedTaskAutoDeleteEnabled === undefined
          ? current.archivedTaskAutoDeleteEnabled
          : input.archivedTaskAutoDeleteEnabled,
      archivedTaskAutoDeleteDays:
        input.archivedTaskAutoDeleteDays === undefined
          ? current.archivedTaskAutoDeleteDays
          : normalizeArchivedTaskAutoDeleteDays(input.archivedTaskAutoDeleteDays),
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
      harnessWhatExists: input.harnessWhatExists === undefined ? current.harnessWhatExists : normalizeHarnessValue(input.harnessWhatExists),
      harnessAllowedActions: input.harnessAllowedActions === undefined ? current.harnessAllowedActions : normalizeHarnessValue(input.harnessAllowedActions),
      harnessNotAllowedActions: input.harnessNotAllowedActions === undefined ? current.harnessNotAllowedActions : normalizeHarnessValue(input.harnessNotAllowedActions),
      harnessHowToWork: input.harnessHowToWork === undefined ? current.harnessHowToWork : normalizeHarnessValue(input.harnessHowToWork),
      harnessDefinitionOfDone: input.harnessDefinitionOfDone === undefined ? current.harnessDefinitionOfDone : normalizeHarnessValue(input.harnessDefinitionOfDone),
      harnessEvidenceExpectations: input.harnessEvidenceExpectations === undefined ? current.harnessEvidenceExpectations : normalizeHarnessValue(input.harnessEvidenceExpectations),
      codexDefaultModel: nextCodexDefaultModel,
      codexModels: input.codexModels === undefined ? current.codexModels : normalizeProviderModels(input.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: nextClaudeDefaultModel,
      claudeModels: input.claudeModels === undefined ? current.claudeModels : normalizeProviderModels(input.claudeModels, defaultSettings.claudeModels),
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

  async getRuntimeCredentials(_userId?: string | null, _codexCredentialSource: RuntimeCodexCredentialSource = "auto"): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);

    return {
      ...credentials,
      gitUsername: settings.gitUsername,
      gitAuthorName: settings.gitAuthorName,
      gitAuthorEmail: settings.gitAuthorEmail,
      openaiBaseUrl: settings.openaiBaseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      defaultProvider: settings.defaultProvider
    };
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
          archived_task_auto_delete_enabled,
          archived_task_auto_delete_days,
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
          harness_what_exists,
          harness_allowed_actions,
          harness_not_allowed_actions,
          harness_how_to_work,
          harness_definition_of_done,
          harness_evidence_expectations,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27::jsonb, $28, $29::jsonb)
        ON CONFLICT (singleton_id) DO NOTHING
      `,
      [
        defaultSettings.defaultProvider,
        defaultSettings.maxAgents,
        defaultSettings.archivedTaskAutoDeleteEnabled,
        defaultSettings.archivedTaskAutoDeleteDays,
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
        defaultSettings.harnessWhatExists,
        defaultSettings.harnessAllowedActions,
        defaultSettings.harnessNotAllowedActions,
        defaultSettings.harnessHowToWork,
        defaultSettings.harnessDefinitionOfDone,
        defaultSettings.harnessEvidenceExpectations,
        defaultSettings.codexDefaultModel,
        JSON.stringify(defaultSettings.codexModels),
        defaultSettings.codexDefaultEffort,
        defaultSettings.claudeDefaultModel,
        JSON.stringify(defaultSettings.claudeModels),
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
          archived_task_auto_delete_enabled,
          archived_task_auto_delete_days,
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
          harness_what_exists,
          harness_allowed_actions,
          harness_not_allowed_actions,
          harness_how_to_work,
          harness_definition_of_done,
          harness_evidence_expectations,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
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
    const normalizedBase = {
      defaultProvider: normalizedDefaultProvider,
      maxAgents: typeof row?.max_agents === "number" ? row.max_agents : defaultSettings.maxAgents,
      archivedTaskAutoDeleteEnabled:
        typeof row?.archived_task_auto_delete_enabled === "boolean"
          ? row.archived_task_auto_delete_enabled
          : defaultSettings.archivedTaskAutoDeleteEnabled,
      archivedTaskAutoDeleteDays: normalizeArchivedTaskAutoDeleteDays(
        typeof row?.archived_task_auto_delete_days === "number" ? row.archived_task_auto_delete_days : undefined
      ),
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
      harnessWhatExists: normalizeHarnessValue(row?.harness_what_exists),
      harnessAllowedActions: normalizeHarnessValue(row?.harness_allowed_actions),
      harnessNotAllowedActions: normalizeHarnessValue(row?.harness_not_allowed_actions),
      harnessHowToWork: normalizeHarnessValue(row?.harness_how_to_work),
      harnessDefinitionOfDone: normalizeHarnessValue(row?.harness_definition_of_done),
      harnessEvidenceExpectations: normalizeHarnessValue(row?.harness_evidence_expectations),
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
    const nextDefaultProvider = normalizeDefaultProvider(input.defaultProvider ?? current.defaultProvider);
    const nextCodexDefaultModel = input.codexDefaultModel?.trim() || current.codexDefaultModel;
    const nextClaudeDefaultModel = input.claudeDefaultModel?.trim() || current.claudeDefaultModel;
    const nextBase = {
      defaultProvider: nextDefaultProvider,
      maxAgents: input.maxAgents ?? current.maxAgents,
      archivedTaskAutoDeleteEnabled:
        input.archivedTaskAutoDeleteEnabled === undefined
          ? current.archivedTaskAutoDeleteEnabled
          : input.archivedTaskAutoDeleteEnabled,
      archivedTaskAutoDeleteDays:
        input.archivedTaskAutoDeleteDays === undefined
          ? current.archivedTaskAutoDeleteDays
          : normalizeArchivedTaskAutoDeleteDays(input.archivedTaskAutoDeleteDays),
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
      harnessWhatExists: input.harnessWhatExists === undefined ? current.harnessWhatExists : normalizeHarnessValue(input.harnessWhatExists),
      harnessAllowedActions: input.harnessAllowedActions === undefined ? current.harnessAllowedActions : normalizeHarnessValue(input.harnessAllowedActions),
      harnessNotAllowedActions: input.harnessNotAllowedActions === undefined ? current.harnessNotAllowedActions : normalizeHarnessValue(input.harnessNotAllowedActions),
      harnessHowToWork: input.harnessHowToWork === undefined ? current.harnessHowToWork : normalizeHarnessValue(input.harnessHowToWork),
      harnessDefinitionOfDone: input.harnessDefinitionOfDone === undefined ? current.harnessDefinitionOfDone : normalizeHarnessValue(input.harnessDefinitionOfDone),
      harnessEvidenceExpectations: input.harnessEvidenceExpectations === undefined ? current.harnessEvidenceExpectations : normalizeHarnessValue(input.harnessEvidenceExpectations),
      codexDefaultModel: nextCodexDefaultModel,
      codexModels: input.codexModels === undefined ? current.codexModels : normalizeProviderModels(input.codexModels, defaultSettings.codexModels),
      codexDefaultEffort: normalizeProviderProfile(input.codexDefaultEffort) ?? current.codexDefaultEffort,
      claudeDefaultModel: nextClaudeDefaultModel,
      claudeModels: input.claudeModels === undefined ? current.claudeModels : normalizeProviderModels(input.claudeModels, defaultSettings.claudeModels),
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
          archived_task_auto_delete_enabled,
          archived_task_auto_delete_days,
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
          harness_what_exists,
          harness_allowed_actions,
          harness_not_allowed_actions,
          harness_how_to_work,
          harness_definition_of_done,
          harness_evidence_expectations,
          codex_default_model,
          codex_models,
          codex_default_effort,
          claude_default_model,
          claude_models,
          claude_default_effort,
          response_preference_presets
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27::jsonb, $28, $29::jsonb)
        ON CONFLICT (singleton_id) DO UPDATE
        SET
          default_provider = EXCLUDED.default_provider,
          max_agents = EXCLUDED.max_agents,
          archived_task_auto_delete_enabled = EXCLUDED.archived_task_auto_delete_enabled,
          archived_task_auto_delete_days = EXCLUDED.archived_task_auto_delete_days,
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
          harness_what_exists = EXCLUDED.harness_what_exists,
          harness_allowed_actions = EXCLUDED.harness_allowed_actions,
          harness_not_allowed_actions = EXCLUDED.harness_not_allowed_actions,
          harness_how_to_work = EXCLUDED.harness_how_to_work,
          harness_definition_of_done = EXCLUDED.harness_definition_of_done,
          harness_evidence_expectations = EXCLUDED.harness_evidence_expectations,
          codex_default_model = EXCLUDED.codex_default_model,
          codex_models = EXCLUDED.codex_models,
          codex_default_effort = EXCLUDED.codex_default_effort,
          claude_default_model = EXCLUDED.claude_default_model,
          claude_models = EXCLUDED.claude_models,
          claude_default_effort = EXCLUDED.claude_default_effort,
          response_preference_presets = EXCLUDED.response_preference_presets
      `,
      [
        nextBase.defaultProvider,
        nextBase.maxAgents,
        nextBase.archivedTaskAutoDeleteEnabled,
        nextBase.archivedTaskAutoDeleteDays,
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
        nextBase.harnessWhatExists,
        nextBase.harnessAllowedActions,
        nextBase.harnessNotAllowedActions,
        nextBase.harnessHowToWork,
        nextBase.harnessDefinitionOfDone,
        nextBase.harnessEvidenceExpectations,
        nextBase.codexDefaultModel,
        JSON.stringify(nextBase.codexModels),
        nextBase.codexDefaultEffort,
        nextBase.claudeDefaultModel,
        JSON.stringify(nextBase.claudeModels),
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

  async getRuntimeCredentials(_userId?: string | null, _codexCredentialSource: RuntimeCodexCredentialSource = "auto"): Promise<SettingsRuntimeCredentials> {
    const [credentials, settings] = await Promise.all([
      this.credentialStore.getCredentials(),
      this.getSettings()
    ]);

    return {
      ...credentials,
      gitUsername: settings.gitUsername,
      gitAuthorName: settings.gitAuthorName,
      gitAuthorEmail: settings.gitAuthorEmail,
      openaiBaseUrl: settings.openaiBaseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      defaultProvider: settings.defaultProvider
    };
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
