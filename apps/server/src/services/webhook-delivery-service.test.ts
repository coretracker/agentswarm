import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RealtimeEvent, Repository, Task } from "@agentswarm/shared-types";
import { RedisWebhookDeliveryStore } from "./webhook-delivery-store.js";
import { WebhookDeliveryService } from "./webhook-delivery-service.js";

class FakeRedis {
  private readonly kv = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();

  private getZset(key: string): Map<string, number> {
    let current = this.zsets.get(key);
    if (!current) {
      current = new Map<string, number>();
      this.zsets.set(key, current);
    }
    return current;
  }

  async set(key: string, value: string): Promise<"OK"> {
    this.kv.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.kv.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.getZset(key).set(member, score);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    const zset = this.getZset(key);
    const existed = zset.delete(member);
    return existed ? 1 : 0;
  }

  async zrangebyscore(
    key: string,
    min: number,
    max: number,
    _limitKeyword?: string,
    offset?: number,
    count?: number
  ): Promise<string[]> {
    const parsedOffset = Number.isFinite(offset) ? Number(offset) : 0;
    const parsedCount = Number.isFinite(count) ? Number(count) : Number.MAX_SAFE_INTEGER;
    return [...this.getZset(key).entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(parsedOffset, parsedOffset + parsedCount)
      .map(([member]) => member);
  }

  multi(): {
    set: (key: string, value: string) => unknown;
    zadd: (key: string, score: number, member: string) => unknown;
    zrem: (key: string, member: string) => unknown;
    del: (...keys: string[]) => unknown;
    exec: () => Promise<unknown[]>;
  } {
    const operations: Array<() => void> = [];
    const chain = {
      set: (key: string, value: string) => {
        operations.push(() => {
          this.kv.set(key, value);
        });
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        operations.push(() => {
          this.getZset(key).set(member, score);
        });
        return chain;
      },
      zrem: (key: string, member: string) => {
        operations.push(() => {
          this.getZset(key).delete(member);
        });
        return chain;
      },
      del: (...keys: string[]) => {
        operations.push(() => {
          for (const key of keys) {
            this.kv.delete(key);
          }
        });
        return chain;
      },
      exec: async () => {
        for (const operation of operations) {
          operation();
        }
        return [] as unknown[];
      }
    };
    return chain;
  }
}

const baseTask = (): Task => ({
  id: "task-1",
  title: "Example task",
  pinned: false,
  hasPendingCheckpoint: false,
  ownerUserId: "user-1",
  repoId: "repo-1",
  repoName: "Repo",
  repoUrl: "https://github.com/example/repo.git",
  repoDefaultBranch: "main",
  taskType: "build",
  provider: "codex",
  providerProfile: "medium",
  modelOverride: null,
  baseBranch: "main",
  branchStrategy: "feature_branch",
  complexity: "normal",
  branchName: "agentswarm/task-1",
  workspaceBaseRef: null,
  prompt: "Do it",
  resultMarkdown: null,
  executionSummary: "Do it",
  branchDiff: null,
  lastAction: "build",
  status: "build_queued",
  logs: [],
  enqueued: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  errorMessage: null
});

const baseRepository = (): Repository => ({
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/example/repo.git",
  defaultBranch: "main",
  webhookUrl: "https://example.com/webhook",
  webhookEnabled: true,
  webhookSecretConfigured: true,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
});

describe("WebhookDeliveryService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("delivers created events and records successful delivery", async () => {
    const redis = new FakeRedis();
    const deliveryResults: Array<{ status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }> = [];
    const repositoryStore = {
      getRepositoryWebhookTarget: async () => ({
        repository: baseRepository(),
        webhookUrl: "https://example.com/webhook",
        webhookSecret: "super-secret"
      }),
      recordWebhookDeliveryResult: async (
        _repoId: string,
        input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
      ) => {
        deliveryResults.push(input);
        return baseRepository();
      }
    };
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const store = new RedisWebhookDeliveryStore(redis as never);
    const event: RealtimeEvent = { type: "task:created", payload: baseTask() };
    const service = new WebhookDeliveryService(store, repositoryStore as never);
    await service.handleRealtimeEvent(event);
    await (service as unknown as { processDueJobs: () => Promise<void> }).processDueJobs();

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, "https://example.com/webhook");
    const headers = fetchCalls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["x-agentswarm-event"], "created");
    assert.equal(typeof headers["x-agentswarm-signature"], "string");
    assert.equal(deliveryResults.length, 1);
    assert.equal(deliveryResults[0]?.status, "success");
  });

  it("queues updated events only when status changes", async () => {
    const redis = new FakeRedis();
    const repositoryStore = {
      getRepositoryWebhookTarget: async () => null,
      recordWebhookDeliveryResult: async () => null
    };
    const store = new RedisWebhookDeliveryStore(redis as never);
    const service = new WebhookDeliveryService(store, repositoryStore as never);
    const task = baseTask();

    await service.handleRealtimeEvent({ type: "task:created", payload: task });
    await service.handleRealtimeEvent({ type: "task:updated", payload: { ...task, updatedAt: "2026-01-01T00:01:00.000Z" } });
    await service.handleRealtimeEvent({
      type: "task:updated",
      payload: {
        ...task,
        status: "building",
        updatedAt: "2026-01-01T00:02:00.000Z"
      }
    });

    const queued = await redis.zrangebyscore("agentswarm:webhook_delivery_queue", 0, Number.MAX_SAFE_INTEGER);
    assert.equal(queued.length, 2);
  });
});
