import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  CreateRepositoryInput,
  GitHubAutomationRule,
  Repository,
  RepositoryEnvSecret,
  RepositoryEnvSecretInput,
  RepositoryEnvVar,
  UpdateRepositoryInput
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { HttpError } from "../lib/http-error.js";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";
const USER_KEY_PREFIX = "agentswarm:user:";
const USER_IDS_KEY = "agentswarm:user_ids";
const REPOSITORY_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_ENV_VAR_MAX_COUNT = 250;
const REPOSITORY_ENV_VAR_KEY_MAX_LENGTH = 128;
const REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH = 8192;
const REPOSITORY_ENV_SECRET_KEY_PATTERN = REPOSITORY_ENV_VAR_KEY_PATTERN;
const REPOSITORY_ENV_SECRET_MAX_COUNT = REPOSITORY_ENV_VAR_MAX_COUNT;
const REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH = REPOSITORY_ENV_VAR_KEY_MAX_LENGTH;
const REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH = REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH;

const nowIso = (): string => new Date().toISOString();
export interface RepositoryEnvSecretValue {
  key: string;
  value: string;
}

type StoredRepository = Omit<Repository, "webhookSecretConfigured" | "githubWebhookSecretConfigured" | "envSecrets"> & {
  envSecrets: RepositoryEnvSecretValue[];
  webhookSecret: string | null;
  githubWebhookSecret: string | null;
  webhookSecretConfigured?: boolean;
  githubWebhookSecretConfigured?: boolean;
} & Record<string, unknown>;

const normalizeRepositoryEnvVars = (value: unknown): RepositoryEnvVar[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const envVars: RepositoryEnvVar[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawKey = (entry as Record<string, unknown>).key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_VAR_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_VAR_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const rawValue = (entry as Record<string, unknown>).value;
    const normalizedValue = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
    if (normalizedValue.length > REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH) {
      continue;
    }

    envVars.push({ key, value: normalizedValue });
    seen.add(key);
    if (envVars.length >= REPOSITORY_ENV_VAR_MAX_COUNT) {
      break;
    }
  }

  return envVars;
};

type NormalizedRepositoryEnvSecretInput = {
  key: string;
  value?: string;
};

const normalizeRepositoryEnvSecretInputs = (value: unknown): NormalizedRepositoryEnvSecretInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const secrets: NormalizedRepositoryEnvSecretInput[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawKey = (entry as Record<string, unknown>).key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_SECRET_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const rawValue = (entry as Record<string, unknown>).value;
    const normalizedValue =
      typeof rawValue === "string" && rawValue.length <= REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH
        ? rawValue
        : undefined;

    secrets.push({
      key,
      ...(normalizedValue !== undefined ? { value: normalizedValue } : {})
    });
    seen.add(key);
    if (secrets.length >= REPOSITORY_ENV_SECRET_MAX_COUNT) {
      break;
    }
  }

  return secrets;
};

const normalizeRepositoryEnvSecretValues = (value: unknown): RepositoryEnvSecretValue[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const secrets: RepositoryEnvSecretValue[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawKey = (entry as Record<string, unknown>).key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_SECRET_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const rawValue = (entry as Record<string, unknown>).value;
    const normalizedValue = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
    if (normalizedValue.length === 0 || normalizedValue.length > REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH) {
      continue;
    }

    secrets.push({ key, value: normalizedValue });
    seen.add(key);
    if (secrets.length >= REPOSITORY_ENV_SECRET_MAX_COUNT) {
      break;
    }
  }

  return secrets;
};

const toConfiguredRepositoryEnvSecrets = (value: RepositoryEnvSecretValue[]): RepositoryEnvSecret[] =>
  value.map((entry) => ({
    key: entry.key,
    configured: true
  }));

const resolveNextRepositoryEnvSecrets = (
  current: RepositoryEnvSecretValue[],
  input: RepositoryEnvSecretInput[] | undefined
): RepositoryEnvSecretValue[] => {
  if (input === undefined) {
    return current;
  }

  const normalizedInput = normalizeRepositoryEnvSecretInputs(input);
  const currentByKey = new Map(current.map((entry) => [entry.key, entry.value] as const));
  const next: RepositoryEnvSecretValue[] = [];

  for (const secret of normalizedInput) {
    if (typeof secret.value === "string" && secret.value.length > 0) {
      next.push({ key: secret.key, value: secret.value });
      continue;
    }

    const existingValue = currentByKey.get(secret.key);
    if (existingValue !== undefined) {
      next.push({ key: secret.key, value: existingValue });
      continue;
    }

    throw new HttpError(400, `Secret value is required for ${secret.key}.`);
  }

  return next;
};

const normalizeLabels = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const labels = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(labels));
};

const normalizeStringList = (value: unknown, options?: { lowercase?: boolean }): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (options?.lowercase ? entry.toLowerCase() : entry));
  return Array.from(new Set(entries));
};

const normalizeGitHubAutomations = (value: unknown): GitHubAutomationRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const now = nowIso();
  const rules: GitHubAutomationRule[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seenIds.has(id)) {
      continue;
    }
    const trigger = record.trigger === "pull_request_opened" ? "pull_request_opened" : "issue_opened";
    const taskRaw = (record.task && typeof record.task === "object") ? (record.task as Record<string, unknown>) : {};
    const labelFilterRaw =
      (record.labelFilter && typeof record.labelFilter === "object") ? (record.labelFilter as Record<string, unknown>) : {};
    rules.push({
      id,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
      enabled: record.enabled !== false,
      trigger,
      syncStatusEnabled: record.syncStatusEnabled === true,
      automationEnabled: record.automationEnabled === true,
      allowedTriggers: normalizeStringList(record.allowedTriggers).filter((entry): entry is "emoji_reaction" | "slash_command" | "bot_mention" =>
        entry === "emoji_reaction" || entry === "slash_command" || entry === "bot_mention"
      ),
      allowedReactions: normalizeStringList(record.allowedReactions),
      allowedCommands: normalizeStringList(record.allowedCommands),
      allowedActorLogins: normalizeStringList(record.allowedActorLogins, { lowercase: true }),
      labelFilter: {
        labelsAny: normalizeLabels(labelFilterRaw.labelsAny),
        labelsAll: normalizeLabels(labelFilterRaw.labelsAll),
        labelsNone: normalizeLabels(labelFilterRaw.labelsNone)
      },
      task: {
        assigneeEmail: typeof taskRaw.assigneeEmail === "string" && taskRaw.assigneeEmail.trim() ? taskRaw.assigneeEmail.trim().toLowerCase() : undefined,
        codexCredentialSource:
          taskRaw.codexCredentialSource === "profile" || taskRaw.codexCredentialSource === "global" || taskRaw.codexCredentialSource === "auto"
            ? taskRaw.codexCredentialSource
            : undefined,
        taskType: taskRaw.taskType === "ask" ? "ask" : "build",
        startMode: taskRaw.startMode === "prepare_workspace" ? "prepare_workspace" : taskRaw.startMode === "idle" ? "idle" : "run_now",
        includeComments: taskRaw.includeComments === true,
        titleTemplate: typeof taskRaw.titleTemplate === "string" ? taskRaw.titleTemplate.trim() : undefined,
        notes: typeof taskRaw.notes === "string" ? taskRaw.notes : undefined,
        provider: taskRaw.provider === "claude" ? "claude" : taskRaw.provider === "codex" ? "codex" : undefined,
        providerProfile:
          taskRaw.providerProfile === "low" ||
          taskRaw.providerProfile === "medium" ||
          taskRaw.providerProfile === "high" ||
          taskRaw.providerProfile === "max"
            ? taskRaw.providerProfile
            : undefined,
        modelOverride: typeof taskRaw.modelOverride === "string" && taskRaw.modelOverride.trim() ? taskRaw.modelOverride.trim() : undefined,
        baseBranch: typeof taskRaw.baseBranch === "string" && taskRaw.baseBranch.trim() ? taskRaw.baseBranch.trim() : undefined,
        branchStrategy:
          taskRaw.branchStrategy === "work_on_branch" || taskRaw.branchStrategy === "feature_branch"
            ? taskRaw.branchStrategy
            : undefined,
        snippetId: typeof taskRaw.snippetId === "string" && taskRaw.snippetId.trim() ? taskRaw.snippetId.trim() : undefined
      },
      createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now
    });
    seenIds.add(id);
  }
  return rules;
};

export interface RepositoryWebhookTarget {
  repository: Repository;
  webhookUrl: string;
  webhookSecret: string;
}

export interface RepositoryStore {
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  listRepositories(): Promise<Repository[]>;
  getRepository(repositoryId: string): Promise<Repository | null>;
  getRepositoryEnvSecrets(repositoryId: string): Promise<RepositoryEnvSecretValue[]>;
  updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null>;
  getRepositoryGitHubWebhookSecret(repositoryId: string): Promise<string | null>;
  getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null>;
  recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null>;
  deleteRepository(repositoryId: string): Promise<boolean>;
}

export class RedisRepositoryStore implements RepositoryStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private repoKey(repoId: string): string {
    return `${REPO_KEY_PREFIX}${repoId}`;
  }

  private userKey(userId: string): string {
    return `${USER_KEY_PREFIX}${userId}`;
  }

  private normalizeUserRepositoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }

  private async buildRepositoryRemovalUserUpdates(repositoryId: string): Promise<Array<{ userKey: string; userPayload: string }>> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    if (userIds.length === 0) {
      return [];
    }

    const lookupPipeline = this.redis.pipeline();
    for (const userId of userIds) {
      lookupPipeline.get(this.userKey(userId));
    }
    const lookupResults = await lookupPipeline.exec();

    const updates: Array<{ userKey: string; userPayload: string }> = [];
    for (let index = 0; index < userIds.length; index += 1) {
      const raw = lookupResults?.[index]?.[1];
      if (typeof raw !== "string") {
        continue;
      }

      let parsedUser: Record<string, unknown>;
      try {
        parsedUser = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const repositoryIds = this.normalizeUserRepositoryIds(parsedUser.repositoryIds);
      if (!repositoryIds.includes(repositoryId)) {
        continue;
      }

      const nextRepositoryIds = repositoryIds.filter((entry) => entry !== repositoryId);
      updates.push({
        userKey: this.userKey(userIds[index]!),
        userPayload: JSON.stringify({
          ...parsedUser,
          repositoryIds: nextRepositoryIds,
          updatedAt: nowIso()
        })
      });
    }

    return updates;
  }

  private normalizeWebhookUrl(url: string | null | undefined): string | null {
    const normalized = (url ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeGitHubWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private assertValidWebhookConfiguration(input: { webhookEnabled: boolean; webhookUrl: string | null; webhookSecret: string | null }): void {
    if (!input.webhookEnabled) {
      return;
    }

    if (!input.webhookUrl) {
      throw new HttpError(400, "Webhook URL is required when webhooks are enabled.");
    }

    if (!input.webhookSecret) {
      throw new HttpError(400, "Webhook secret is required when webhooks are enabled.");
    }
  }

  private normalizeStoredRepository(repository: StoredRepository): StoredRepository {
    const webhookSecret = this.normalizeWebhookSecret(repository.webhookSecret);
    const githubWebhookSecret = this.normalizeGitHubWebhookSecret(repository.githubWebhookSecret);
    const webhookUrl = this.normalizeWebhookUrl(repository.webhookUrl as string | null | undefined);
    const webhookEnabled = repository.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(repository.envVars);
    const envSecrets = normalizeRepositoryEnvSecretValues(repository.envSecrets);
    const githubAutomations = normalizeGitHubAutomations(repository.githubAutomations);
    return {
      ...repository,
      name: String(repository.name ?? "").trim(),
      url: String(repository.url ?? "").trim(),
      defaultBranch: String(repository.defaultBranch ?? "").trim() || "develop",
      syncStatusEnabled: repository.syncStatusEnabled === true,
      envVars,
      envSecrets,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
      githubWebhookSecret,
      githubAutomations,
      webhookLastAttemptAt: typeof repository.webhookLastAttemptAt === "string" ? repository.webhookLastAttemptAt : null,
      webhookLastStatus: repository.webhookLastStatus === "success" || repository.webhookLastStatus === "failed" ? repository.webhookLastStatus : null,
      webhookLastError: typeof repository.webhookLastError === "string" && repository.webhookLastError.trim().length > 0
        ? repository.webhookLastError.trim()
        : null
    };
  }

  private normalizeRepository(repository: StoredRepository): Repository {
    const normalized = this.normalizeStoredRepository(repository);
    return {
      id: normalized.id,
      name: normalized.name,
      url: normalized.url,
      defaultBranch: normalized.defaultBranch,
      syncStatusEnabled: normalized.syncStatusEnabled === true,
      envVars: normalized.envVars,
      envSecrets: toConfiguredRepositoryEnvSecrets(normalized.envSecrets),
      webhookUrl: normalized.webhookUrl,
      webhookEnabled: normalized.webhookEnabled,
      webhookSecretConfigured: Boolean(normalized.webhookSecret),
      githubWebhookSecretConfigured: Boolean(normalized.githubWebhookSecret),
      githubAutomations: normalizeGitHubAutomations(normalized.githubAutomations),
      webhookLastAttemptAt: normalized.webhookLastAttemptAt ?? null,
      webhookLastStatus: normalized.webhookLastStatus ?? null,
      webhookLastError: normalized.webhookLastError ?? null,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt
    };
  }

  private async getStoredRepository(repositoryId: string): Promise<StoredRepository | null> {
    const raw = await this.redis.get(this.repoKey(repositoryId));
    if (!raw) {
      return null;
    }

    return this.normalizeStoredRepository(JSON.parse(raw) as StoredRepository);
  }

  async createRepository(input: CreateRepositoryInput): Promise<Repository> {
    const timestamp = nowIso();
    const webhookUrl = this.normalizeWebhookUrl(input.webhookUrl);
    const webhookSecret = this.normalizeWebhookSecret(input.webhookSecret);
    const githubWebhookSecret = this.normalizeGitHubWebhookSecret(input.githubWebhookSecret);
    const webhookEnabled = input.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(input.envVars);
    const envSecrets = resolveNextRepositoryEnvSecrets([], input.envSecrets);
    const githubAutomations = normalizeGitHubAutomations(input.githubAutomations);
    this.assertValidWebhookConfiguration({
      webhookEnabled,
      webhookUrl,
      webhookSecret
    });

    const stored: StoredRepository = {
      id: nanoid(),
      name: input.name.trim(),
      url: input.url.trim(),
      defaultBranch: input.defaultBranch?.trim() || "develop",
      syncStatusEnabled: input.syncStatusEnabled === true,
      envVars,
      envSecrets,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
      githubWebhookSecret,
      githubAutomations,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const repository = this.normalizeRepository(stored);

    await this.redis
      .multi()
      .set(this.repoKey(repository.id), JSON.stringify(stored))
      .sadd(REPO_IDS_KEY, repository.id)
      .exec();
    await this.eventBus.publish({ type: "repository:created", payload: repository });

    return repository;
  }

  async listRepositories(): Promise<Repository[]> {
    const ids = await this.redis.smembers(REPO_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.repoKey(id));
    }

    const result = await pipeline.exec();
    const repositories: Repository[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        repositories.push(this.normalizeRepository(JSON.parse(raw) as StoredRepository));
      }
    }

    return repositories.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRepository(repositoryId: string): Promise<Repository | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    return this.normalizeRepository(stored);
  }

  async getRepositoryEnvSecrets(repositoryId: string): Promise<RepositoryEnvSecretValue[]> {
    const stored = await this.getStoredRepository(repositoryId);
    return stored?.envSecrets ?? [];
  }

  async getRepositoryGitHubWebhookSecret(repositoryId: string): Promise<string | null> {
    const stored = await this.getStoredRepository(repositoryId);
    return stored?.githubWebhookSecret ?? null;
  }

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const current = await this.getStoredRepository(repositoryId);
    if (!current) {
      return null;
    }

    const nextWebhookSecret =
      input.clearWebhookSecret === true
        ? null
        : input.webhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.webhookSecret)
          : current.webhookSecret;
    const nextGitHubWebhookSecret =
      input.clearGithubWebhookSecret === true
        ? null
        : input.githubWebhookSecret !== undefined
          ? this.normalizeGitHubWebhookSecret(input.githubWebhookSecret)
          : current.githubWebhookSecret;
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const nextEnvVars = input.envVars !== undefined ? normalizeRepositoryEnvVars(input.envVars) : current.envVars;
    const nextEnvSecrets = resolveNextRepositoryEnvSecrets(current.envSecrets, input.envSecrets);
    const nextGitHubAutomations =
      input.githubAutomations !== undefined ? normalizeGitHubAutomations(input.githubAutomations) : normalizeGitHubAutomations(current.githubAutomations);

    this.assertValidWebhookConfiguration({
      webhookEnabled: nextWebhookEnabled,
      webhookUrl: nextWebhookUrl,
      webhookSecret: nextWebhookSecret
    });

    const nextStored: StoredRepository = {
      ...current,
      name: input.name?.trim() || current.name,
      url: input.url?.trim() || current.url,
      defaultBranch: input.defaultBranch?.trim() || current.defaultBranch,
      syncStatusEnabled: input.syncStatusEnabled !== undefined ? input.syncStatusEnabled === true : current.syncStatusEnabled === true,
      envVars: nextEnvVars,
      envSecrets: nextEnvSecrets,
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecret: nextWebhookSecret,
      githubWebhookSecret: nextGitHubWebhookSecret,
      githubAutomations: nextGitHubAutomations,
      updatedAt: nowIso()
    };
    const next = this.normalizeRepository(nextStored);

    await this.redis.set(this.repoKey(repositoryId), JSON.stringify(nextStored));
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    if (!stored.webhookEnabled || !stored.webhookUrl || !stored.webhookSecret) {
      return null;
    }

    return {
      repository: this.normalizeRepository(stored),
      webhookUrl: stored.webhookUrl,
      webhookSecret: stored.webhookSecret
    };
  }

  async recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    const nextStored: StoredRepository = {
      ...stored,
      webhookLastAttemptAt: input.attemptedAt,
      webhookLastStatus: input.status,
      webhookLastError: input.status === "failed" ? input.errorMessage?.trim() || "Webhook delivery failed." : null,
      updatedAt: nowIso()
    };
    const next = this.normalizeRepository(nextStored);

    await this.redis.set(this.repoKey(repositoryId), JSON.stringify(nextStored));
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async deleteRepository(repositoryId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.repoKey(repositoryId));
    if (!exists) {
      return false;
    }

    const userUpdates = await this.buildRepositoryRemovalUserUpdates(repositoryId);
    const transaction = this.redis.multi();
    for (const userUpdate of userUpdates) {
      transaction.set(userUpdate.userKey, userUpdate.userPayload);
    }
    await transaction.del(this.repoKey(repositoryId)).srem(REPO_IDS_KEY, repositoryId).exec();
    await this.eventBus.publish({ type: "repository:deleted", payload: { id: repositoryId } });
    return true;
  }
}

export class PostgresRepositoryStore implements RepositoryStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus
  ) {}

  private normalizeWebhookUrl(url: string | null | undefined): string | null {
    const normalized = (url ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeGitHubWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private assertValidWebhookConfiguration(input: { webhookEnabled: boolean; webhookUrl: string | null; webhookSecret: string | null }): void {
    if (!input.webhookEnabled) {
      return;
    }

    if (!input.webhookUrl) {
      throw new HttpError(400, "Webhook URL is required when webhooks are enabled.");
    }

    if (!input.webhookSecret) {
      throw new HttpError(400, "Webhook secret is required when webhooks are enabled.");
    }
  }

  private mapRepositoryRow(row: Record<string, unknown>): Repository {
    const envSecrets = normalizeRepositoryEnvSecretValues(row.env_secrets);
    return {
      id: String(row.id),
      name: String(row.name ?? "").trim(),
      url: String(row.url ?? "").trim(),
      defaultBranch: String(row.default_branch ?? "").trim() || "develop",
      syncStatusEnabled: row.sync_status_enabled === true,
      envVars: normalizeRepositoryEnvVars(row.env_vars),
      envSecrets: toConfiguredRepositoryEnvSecrets(envSecrets),
      webhookUrl: typeof row.webhook_url === "string" && row.webhook_url.trim().length > 0 ? row.webhook_url.trim() : null,
      webhookEnabled: row.webhook_enabled === true,
      webhookSecretConfigured: typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0,
      githubWebhookSecretConfigured:
        typeof row.github_webhook_secret === "string" && row.github_webhook_secret.trim().length > 0,
      githubAutomations: normalizeGitHubAutomations(row.github_automations),
      webhookLastAttemptAt: typeof row.webhook_last_attempt_at === "string" ? row.webhook_last_attempt_at : null,
      webhookLastStatus:
        row.webhook_last_status === "success" || row.webhook_last_status === "failed" ? row.webhook_last_status : null,
      webhookLastError:
        typeof row.webhook_last_error === "string" && row.webhook_last_error.trim().length > 0 ? row.webhook_last_error.trim() : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private async getStoredRepositoryRow(repositoryId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query("SELECT * FROM repositories WHERE id = $1", [repositoryId]);
    return result.rows[0] ?? null;
  }

  async createRepository(input: CreateRepositoryInput): Promise<Repository> {
    const timestamp = nowIso();
    const webhookUrl = this.normalizeWebhookUrl(input.webhookUrl);
    const webhookSecret = this.normalizeWebhookSecret(input.webhookSecret);
    const githubWebhookSecret = this.normalizeGitHubWebhookSecret(input.githubWebhookSecret);
    const webhookEnabled = input.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(input.envVars);
    const envSecrets = resolveNextRepositoryEnvSecrets([], input.envSecrets);
    const githubAutomations = normalizeGitHubAutomations(input.githubAutomations);
    this.assertValidWebhookConfiguration({
      webhookEnabled,
      webhookUrl,
      webhookSecret
    });

    const repository = {
      id: nanoid(),
      name: input.name.trim(),
      url: input.url.trim(),
      defaultBranch: input.defaultBranch?.trim() || "develop",
      syncStatusEnabled: input.syncStatusEnabled === true,
      envVars,
      envSecrets: toConfiguredRepositoryEnvSecrets(envSecrets),
      webhookUrl,
      webhookEnabled,
      webhookSecretConfigured: Boolean(webhookSecret),
      githubWebhookSecretConfigured: Boolean(githubWebhookSecret),
      githubAutomations,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies Repository;

    await this.pool.query(
      `
        INSERT INTO repositories (
          id,
          name,
          url,
          default_branch,
          sync_status_enabled,
          env_vars,
          env_secrets,
          webhook_url,
          webhook_enabled,
          webhook_secret,
          github_webhook_secret,
          github_automations,
          webhook_last_attempt_at,
          webhook_last_status,
          webhook_last_error,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)
      `,
      [
        repository.id,
        repository.name,
        repository.url,
        repository.defaultBranch,
        repository.syncStatusEnabled === true,
        JSON.stringify(repository.envVars),
        JSON.stringify(envSecrets),
        repository.webhookUrl,
        repository.webhookEnabled,
        webhookSecret,
        githubWebhookSecret,
        JSON.stringify(repository.githubAutomations ?? []),
        repository.webhookLastAttemptAt,
        repository.webhookLastStatus,
        repository.webhookLastError,
        repository.createdAt,
        repository.updatedAt
      ]
    );
    await this.eventBus.publish({ type: "repository:created", payload: repository });
    return repository;
  }

  async listRepositories(): Promise<Repository[]> {
    const result = await this.pool.query("SELECT * FROM repositories ORDER BY name ASC");
    return result.rows.map((row) => this.mapRepositoryRow(row));
  }

  async getRepository(repositoryId: string): Promise<Repository | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    return row ? this.mapRepositoryRow(row) : null;
  }

  async getRepositoryEnvSecrets(repositoryId: string): Promise<RepositoryEnvSecretValue[]> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return [];
    }
    return normalizeRepositoryEnvSecretValues(row.env_secrets);
  }

  async getRepositoryGitHubWebhookSecret(repositoryId: string): Promise<string | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }
    const value = row.github_webhook_secret;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const currentRow = await this.getStoredRepositoryRow(repositoryId);
    if (!currentRow) {
      return null;
    }

    const current = this.mapRepositoryRow(currentRow);
    const currentWebhookSecret =
      typeof currentRow.webhook_secret === "string" && currentRow.webhook_secret.trim().length > 0 ? currentRow.webhook_secret.trim() : null;
    const currentGitHubWebhookSecret =
      typeof currentRow.github_webhook_secret === "string" && currentRow.github_webhook_secret.trim().length > 0
        ? currentRow.github_webhook_secret.trim()
        : null;
    const currentEnvSecrets = normalizeRepositoryEnvSecretValues(currentRow.env_secrets);
    const nextWebhookSecret =
      input.clearWebhookSecret === true
        ? null
        : input.webhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.webhookSecret)
          : currentWebhookSecret;
    const nextGitHubWebhookSecret =
      input.clearGithubWebhookSecret === true
        ? null
        : input.githubWebhookSecret !== undefined
          ? this.normalizeGitHubWebhookSecret(input.githubWebhookSecret)
          : currentGitHubWebhookSecret;
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const nextEnvVars = input.envVars !== undefined ? normalizeRepositoryEnvVars(input.envVars) : current.envVars;
    const nextEnvSecrets = resolveNextRepositoryEnvSecrets(currentEnvSecrets, input.envSecrets);
    const nextGitHubAutomations =
      input.githubAutomations !== undefined ? normalizeGitHubAutomations(input.githubAutomations) : normalizeGitHubAutomations(current.githubAutomations);

    this.assertValidWebhookConfiguration({
      webhookEnabled: nextWebhookEnabled,
      webhookUrl: nextWebhookUrl,
      webhookSecret: nextWebhookSecret
    });

    const next: Repository = {
      ...current,
      name: input.name?.trim() || current.name,
      url: input.url?.trim() || current.url,
      defaultBranch: input.defaultBranch?.trim() || current.defaultBranch,
      syncStatusEnabled: input.syncStatusEnabled !== undefined ? input.syncStatusEnabled === true : current.syncStatusEnabled === true,
      envVars: nextEnvVars,
      envSecrets: toConfiguredRepositoryEnvSecrets(nextEnvSecrets),
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecretConfigured: Boolean(nextWebhookSecret),
      githubWebhookSecretConfigured: Boolean(nextGitHubWebhookSecret),
      githubAutomations: nextGitHubAutomations,
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        UPDATE repositories
        SET
          name = $2,
          url = $3,
          default_branch = $4,
          sync_status_enabled = $5,
          env_vars = $6::jsonb,
          env_secrets = $7::jsonb,
          webhook_url = $8,
          webhook_enabled = $9,
          webhook_secret = $10,
          github_webhook_secret = $11,
          github_automations = $12::jsonb,
          webhook_last_attempt_at = $13,
          webhook_last_status = $14,
          webhook_last_error = $15,
          created_at = $16,
          updated_at = $17
        WHERE id = $1
      `,
      [
        repositoryId,
        next.name,
        next.url,
        next.defaultBranch,
        next.syncStatusEnabled === true,
        JSON.stringify(next.envVars),
        JSON.stringify(nextEnvSecrets),
        next.webhookUrl,
        next.webhookEnabled,
        nextWebhookSecret,
        nextGitHubWebhookSecret,
        JSON.stringify(next.githubAutomations ?? []),
        next.webhookLastAttemptAt,
        next.webhookLastStatus,
        next.webhookLastError,
        next.createdAt,
        next.updatedAt
      ]
    );
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }

    const repository = this.mapRepositoryRow(row);
    const webhookSecret =
      typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0 ? row.webhook_secret.trim() : null;

    if (!repository.webhookEnabled || !repository.webhookUrl || !webhookSecret) {
      return null;
    }

    return {
      repository,
      webhookUrl: repository.webhookUrl,
      webhookSecret
    };
  }

  async recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }

    const current = this.mapRepositoryRow(row);
    const webhookSecret =
      typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0 ? row.webhook_secret.trim() : null;
    const githubWebhookSecret =
      typeof row.github_webhook_secret === "string" && row.github_webhook_secret.trim().length > 0
        ? row.github_webhook_secret.trim()
        : null;
    const envSecrets = normalizeRepositoryEnvSecretValues(row.env_secrets);
    const next: Repository = {
      ...current,
      webhookLastAttemptAt: input.attemptedAt,
      webhookLastStatus: input.status,
      webhookLastError: input.status === "failed" ? input.errorMessage?.trim() || "Webhook delivery failed." : null,
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        UPDATE repositories
        SET
          name = $2,
          url = $3,
          default_branch = $4,
          sync_status_enabled = $5,
          env_vars = $6::jsonb,
          env_secrets = $7::jsonb,
          webhook_url = $8,
          webhook_enabled = $9,
          webhook_secret = $10,
          github_webhook_secret = $11,
          github_automations = $12::jsonb,
          webhook_last_attempt_at = $13,
          webhook_last_status = $14,
          webhook_last_error = $15,
          created_at = $16,
          updated_at = $17
        WHERE id = $1
      `,
      [
        repositoryId,
        next.name,
        next.url,
        next.defaultBranch,
        next.syncStatusEnabled === true,
        JSON.stringify(next.envVars),
        JSON.stringify(envSecrets),
        next.webhookUrl,
        next.webhookEnabled,
        webhookSecret,
        githubWebhookSecret,
        JSON.stringify(next.githubAutomations ?? []),
        next.webhookLastAttemptAt,
        next.webhookLastStatus,
        next.webhookLastError,
        next.createdAt,
        next.updatedAt
      ]
    );
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async deleteRepository(repositoryId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM repositories WHERE id = $1", [repositoryId]);
    if (result.rowCount === 0) {
      return false;
    }

    await this.eventBus.publish({ type: "repository:deleted", payload: { id: repositoryId } });
    return true;
  }
}
