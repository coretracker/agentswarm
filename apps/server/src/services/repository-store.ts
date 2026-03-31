import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { CreateRepositoryInput, Repository, UpdateRepositoryInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";

const nowIso = (): string => new Date().toISOString();
type StoredRepository = Repository & Record<string, unknown>;

export class RepositoryStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private repoKey(repoId: string): string {
    return `${REPO_KEY_PREFIX}${repoId}`;
  }

  private normalizeRepository(repository: StoredRepository): Repository {
    return {
      id: repository.id,
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt
    };
  }

  async createRepository(input: CreateRepositoryInput): Promise<Repository> {
    const timestamp = nowIso();
    const name = input.name.trim();

    const repository: Repository = {
      id: nanoid(),
      name,
      url: input.url.trim(),
      defaultBranch: input.defaultBranch?.trim() || "develop",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.redis
      .multi()
      .set(this.repoKey(repository.id), JSON.stringify(repository))
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
    const raw = await this.redis.get(this.repoKey(repositoryId));
    if (!raw) {
      return null;
    }

    return this.normalizeRepository(JSON.parse(raw) as StoredRepository);
  }

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const current = await this.getRepository(repositoryId);
    if (!current) {
      return null;
    }

    const next: Repository = {
      ...current,
      name: input.name?.trim() || current.name,
      url: input.url?.trim() || current.url,
      defaultBranch: input.defaultBranch?.trim() || current.defaultBranch,
      updatedAt: nowIso()
    };

    await this.redis.set(this.repoKey(repositoryId), JSON.stringify(next));
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
