import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

const OUTBOUND_QUEUE_KEY = "agentswarm:github_outbound_queue";
const OUTBOUND_JOB_KEY_PREFIX = "agentswarm:github_outbound:";
const OUTBOUND_IDEMPOTENCY_KEY_PREFIX = "agentswarm:github_outbound_idempotency:";
const OUTBOUND_DEAD_LETTER_KEY = "agentswarm:github_outbound_dead_letter";
const OUTBOUND_RATE_GUARD_KEY_PREFIX = "agentswarm:github_outbound_rate_guard:";
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

export type GitHubOutboundJobType = "summary_comment" | "label_update";

export interface GitHubSummaryCommentPayload {
  issueNumber: number;
  body: string;
}

export interface GitHubLabelUpdatePayload {
  issueNumber: number;
  add: string[];
  remove: string[];
}

export interface GitHubOutboundJob {
  id: string;
  repositoryId: string;
  type: GitHubOutboundJobType;
  payload: GitHubSummaryCommentPayload | GitHubLabelUpdatePayload;
  idempotencyKey: string;
  attempt: number;
  createdAt: string;
}

export interface GitHubOutboundDeadLetter {
  job: GitHubOutboundJob;
  failedAt: string;
  reason: string;
}

export interface GitHubOutboundQueueStore {
  enqueueJob(job: Omit<GitHubOutboundJob, "id" | "attempt" | "createdAt">): Promise<boolean>;
  listDueJobIds(now: number, limit: number): Promise<string[]>;
  getJob(jobId: string): Promise<GitHubOutboundJob | null>;
  deleteJob(jobId: string): Promise<void>;
  schedule(job: GitHubOutboundJob, delayMs: number, incrementAttempt: boolean): Promise<void>;
  moveToDeadLetter(job: GitHubOutboundJob, reason: string): Promise<void>;
  getRepoNotBefore(repositoryId: string): Promise<number | null>;
  setRepoNotBefore(repositoryId: string, timestampMs: number): Promise<void>;
}

const nowIso = (): string => new Date().toISOString();

export class RedisGitHubOutboundQueueStore implements GitHubOutboundQueueStore {
  constructor(private readonly redis: Redis) {}

  private jobKey(jobId: string): string {
    return `${OUTBOUND_JOB_KEY_PREFIX}${jobId}`;
  }

  private idempotencyKey(key: string): string {
    return `${OUTBOUND_IDEMPOTENCY_KEY_PREFIX}${key}`;
  }

  private rateGuardKey(repositoryId: string): string {
    return `${OUTBOUND_RATE_GUARD_KEY_PREFIX}${repositoryId}`;
  }

  async enqueueJob(job: Omit<GitHubOutboundJob, "id" | "attempt" | "createdAt">): Promise<boolean> {
    const idemKey = this.idempotencyKey(job.idempotencyKey);
    const existing = await this.redis.get(idemKey);
    if (existing) {
      return false;
    }

    const queued: GitHubOutboundJob = {
      id: randomUUID(),
      repositoryId: job.repositoryId,
      type: job.type,
      payload: job.payload,
      idempotencyKey: job.idempotencyKey,
      attempt: 1,
      createdAt: nowIso()
    };

    await this.redis
      .multi()
      .set(idemKey, "queued", "EX", IDEMPOTENCY_TTL_SECONDS)
      .set(this.jobKey(queued.id), JSON.stringify(queued))
      .zadd(OUTBOUND_QUEUE_KEY, Date.now(), queued.id)
      .exec();

    return true;
  }

  async listDueJobIds(now: number, limit: number): Promise<string[]> {
    return this.redis.zrangebyscore(OUTBOUND_QUEUE_KEY, 0, now, "LIMIT", 0, limit);
  }

  async getJob(jobId: string): Promise<GitHubOutboundJob | null> {
    const raw = await this.redis.get(this.jobKey(jobId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as GitHubOutboundJob;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.repositoryId === "string" &&
        (parsed.type === "summary_comment" || parsed.type === "label_update") &&
        typeof parsed.idempotencyKey === "string" &&
        typeof parsed.attempt === "number" &&
        parsed.payload &&
        typeof parsed.payload === "object"
      ) {
        return parsed;
      }
    } catch {
      // Ignore invalid payloads.
    }

    return null;
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.redis.multi().zrem(OUTBOUND_QUEUE_KEY, jobId).del(this.jobKey(jobId)).exec();
  }

  async schedule(job: GitHubOutboundJob, delayMs: number, incrementAttempt: boolean): Promise<void> {
    const next: GitHubOutboundJob = {
      ...job,
      attempt: incrementAttempt ? job.attempt + 1 : job.attempt
    };

    await this.redis
      .multi()
      .set(this.jobKey(job.id), JSON.stringify(next))
      .zadd(OUTBOUND_QUEUE_KEY, Date.now() + Math.max(1_000, delayMs), job.id)
      .exec();
  }

  async moveToDeadLetter(job: GitHubOutboundJob, reason: string): Promise<void> {
    const payload: GitHubOutboundDeadLetter = {
      job,
      failedAt: nowIso(),
      reason
    };

    await this.redis
      .multi()
      .zrem(OUTBOUND_QUEUE_KEY, job.id)
      .del(this.jobKey(job.id))
      .lpush(OUTBOUND_DEAD_LETTER_KEY, JSON.stringify(payload))
      .ltrim(OUTBOUND_DEAD_LETTER_KEY, 0, 499)
      .exec();
  }

  async getRepoNotBefore(repositoryId: string): Promise<number | null> {
    const raw = await this.redis.get(this.rateGuardKey(repositoryId));
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async setRepoNotBefore(repositoryId: string, timestampMs: number): Promise<void> {
    const ttlSeconds = Math.max(30, Math.ceil((timestampMs - Date.now()) / 1000) + 30);
    await this.redis.set(this.rateGuardKey(repositoryId), String(timestampMs), "EX", ttlSeconds);
  }
}
