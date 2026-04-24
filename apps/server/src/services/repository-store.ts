import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { CreateRepositoryInput, Repository, RepositoryEnvVar, UpdateRepositoryInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { HttpError } from "../lib/http-error.js";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";
const REPOSITORY_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_ENV_VAR_MAX_COUNT = 250;
const REPOSITORY_ENV_VAR_KEY_MAX_LENGTH = 128;
const REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH = 8192;

const nowIso = (): string => new Date().toISOString();
type StoredRepository = Omit<Repository, "webhookSecretConfigured"> & {
  webhookSecret: string | null;
  webhookSecretConfigured?: boolean;
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

export interface RepositoryWebhookTarget {
  repository: Repository;
  webhookUrl: string;
  webhookSecret: string;
}

export interface RepositoryStore {
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  listRepositories(): Promise<Repository[]>;
  getRepository(repositoryId: string): Promise<Repository | null>;
  updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null>;
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

  private normalizeWebhookUrl(url: string | null | undefined): string | null {
    const normalized = (url ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeWebhookSecret(secret: string | null | undefined): string | null {
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
    const webhookUrl = this.normalizeWebhookUrl(repository.webhookUrl as string | null | undefined);
    const webhookEnabled = repository.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(repository.envVars);
    return {
      ...repository,
      name: String(repository.name ?? "").trim(),
      url: String(repository.url ?? "").trim(),
      defaultBranch: String(repository.defaultBranch ?? "").trim() || "develop",
      envVars,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
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
      envVars: normalized.envVars,
      webhookUrl: normalized.webhookUrl,
      webhookEnabled: normalized.webhookEnabled,
      webhookSecretConfigured: Boolean(normalized.webhookSecret),
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
    const webhookEnabled = input.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(input.envVars);
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
      envVars,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
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
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const nextEnvVars = input.envVars !== undefined ? normalizeRepositoryEnvVars(input.envVars) : current.envVars;

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
      envVars: nextEnvVars,
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecret: nextWebhookSecret,
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

    await this.redis.multi().del(this.repoKey(repositoryId)).srem(REPO_IDS_KEY, repositoryId).exec();
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
    return {
      id: String(row.id),
      name: String(row.name ?? "").trim(),
      url: String(row.url ?? "").trim(),
      defaultBranch: String(row.default_branch ?? "").trim() || "develop",
      envVars: normalizeRepositoryEnvVars(row.env_vars),
      webhookUrl: typeof row.webhook_url === "string" && row.webhook_url.trim().length > 0 ? row.webhook_url.trim() : null,
      webhookEnabled: row.webhook_enabled === true,
      webhookSecretConfigured: typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0,
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
    const webhookEnabled = input.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(input.envVars);
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
      envVars,
      webhookUrl,
      webhookEnabled,
      webhookSecretConfigured: Boolean(webhookSecret),
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
          env_vars,
          webhook_url,
          webhook_enabled,
          webhook_secret,
          webhook_last_attempt_at,
          webhook_last_status,
          webhook_last_error,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        repository.id,
        repository.name,
        repository.url,
        repository.defaultBranch,
        JSON.stringify(repository.envVars),
        repository.webhookUrl,
        repository.webhookEnabled,
        webhookSecret,
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

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const currentRow = await this.getStoredRepositoryRow(repositoryId);
    if (!currentRow) {
      return null;
    }

    const current = this.mapRepositoryRow(currentRow);
    const currentWebhookSecret =
      typeof currentRow.webhook_secret === "string" && currentRow.webhook_secret.trim().length > 0 ? currentRow.webhook_secret.trim() : null;
    const nextWebhookSecret =
      input.clearWebhookSecret === true
        ? null
        : input.webhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.webhookSecret)
          : currentWebhookSecret;
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const nextEnvVars = input.envVars !== undefined ? normalizeRepositoryEnvVars(input.envVars) : current.envVars;

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
      envVars: nextEnvVars,
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecretConfigured: Boolean(nextWebhookSecret),
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        UPDATE repositories
        SET
          name = $2,
          url = $3,
          default_branch = $4,
          env_vars = $5::jsonb,
          webhook_url = $6,
          webhook_enabled = $7,
          webhook_secret = $8,
          webhook_last_attempt_at = $9,
          webhook_last_status = $10,
          webhook_last_error = $11,
          created_at = $12,
          updated_at = $13
        WHERE id = $1
      `,
      [
        repositoryId,
        next.name,
        next.url,
        next.defaultBranch,
        JSON.stringify(next.envVars),
        next.webhookUrl,
        next.webhookEnabled,
        nextWebhookSecret,
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
          env_vars = $5::jsonb,
          webhook_url = $6,
          webhook_enabled = $7,
          webhook_secret = $8,
          webhook_last_attempt_at = $9,
          webhook_last_status = $10,
          webhook_last_error = $11,
          created_at = $12,
          updated_at = $13
        WHERE id = $1
      `,
      [
        repositoryId,
        next.name,
        next.url,
        next.defaultBranch,
        JSON.stringify(next.envVars),
        next.webhookUrl,
        next.webhookEnabled,
        webhookSecret,
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
