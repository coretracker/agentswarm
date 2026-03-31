import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { CreateRepositoryInput, Repository, UpdateRepositoryInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { HttpError } from "../lib/http-error.js";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";

const nowIso = (): string => new Date().toISOString();
type StoredRepository = Omit<Repository, "webhookSecretConfigured"> & {
  webhookSecret: string | null;
  webhookSecretConfigured?: boolean;
} & Record<string, unknown>;

interface RepositoryWebhookTarget {
  repository: Repository;
  webhookUrl: string;
  webhookSecret: string;
}

export class RepositoryStore {
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
    return {
      ...repository,
      name: String(repository.name ?? "").trim(),
      url: String(repository.url ?? "").trim(),
      defaultBranch: String(repository.defaultBranch ?? "").trim() || "develop",
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
