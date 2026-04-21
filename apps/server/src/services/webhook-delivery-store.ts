import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

const WEBHOOK_QUEUE_KEY = "agentswarm:webhook_delivery_queue";
const WEBHOOK_JOB_KEY_PREFIX = "agentswarm:webhook_delivery:";
const WEBHOOK_LAST_TASK_STATUS_KEY_PREFIX = "agentswarm:webhook_task_status:";

export type WebhookEventType = "created" | "updated" | "deleted" | "pushed" | "merged";

export interface WebhookJob {
  id: string;
  repositoryId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  attempt: number;
}

export interface WebhookDeliveryStore {
  enqueueJob(job: Omit<WebhookJob, "id" | "attempt">): Promise<void>;
  getLastTaskStatus(taskId: string): Promise<string | null>;
  setLastTaskStatus(taskId: string, status: string): Promise<void>;
  clearLastTaskStatus(taskId: string): Promise<void>;
  listDueJobIds(now: number, limit: number): Promise<string[]>;
  getJob(deliveryId: string): Promise<WebhookJob | null>;
  deleteJob(deliveryId: string): Promise<void>;
  scheduleRetry(job: WebhookJob, delayMs: number): Promise<void>;
}

export class RedisWebhookDeliveryStore implements WebhookDeliveryStore {
  constructor(private readonly redis: Redis) {}

  private statusKey(taskId: string): string {
    return `${WEBHOOK_LAST_TASK_STATUS_KEY_PREFIX}${taskId}`;
  }

  private jobKey(deliveryId: string): string {
    return `${WEBHOOK_JOB_KEY_PREFIX}${deliveryId}`;
  }

  async enqueueJob(job: Omit<WebhookJob, "id" | "attempt">): Promise<void> {
    const queued: WebhookJob = {
      id: randomUUID(),
      repositoryId: job.repositoryId,
      eventType: job.eventType,
      payload: job.payload,
      attempt: 1
    };
    await this.redis.multi().set(this.jobKey(queued.id), JSON.stringify(queued)).zadd(WEBHOOK_QUEUE_KEY, Date.now(), queued.id).exec();
  }

  async getLastTaskStatus(taskId: string): Promise<string | null> {
    return this.redis.get(this.statusKey(taskId));
  }

  async setLastTaskStatus(taskId: string, status: string): Promise<void> {
    await this.redis.set(this.statusKey(taskId), status);
  }

  async clearLastTaskStatus(taskId: string): Promise<void> {
    await this.redis.del(this.statusKey(taskId));
  }

  async listDueJobIds(now: number, limit: number): Promise<string[]> {
    return this.redis.zrangebyscore(WEBHOOK_QUEUE_KEY, 0, now, "LIMIT", 0, limit);
  }

  async getJob(deliveryId: string): Promise<WebhookJob | null> {
    const raw = await this.redis.get(this.jobKey(deliveryId));
    if (!raw) {
      return null;
    }

    try {
      const job = JSON.parse(raw) as WebhookJob;
      if (
        typeof job.id === "string" &&
        typeof job.repositoryId === "string" &&
        (job.eventType === "created" ||
          job.eventType === "updated" ||
          job.eventType === "deleted" ||
          job.eventType === "pushed" ||
          job.eventType === "merged") &&
        typeof job.attempt === "number" &&
        job.payload &&
        typeof job.payload === "object"
      ) {
        return job;
      }
    } catch {
      // Ignore invalid payloads.
    }

    return null;
  }

  async deleteJob(deliveryId: string): Promise<void> {
    await this.redis.multi().zrem(WEBHOOK_QUEUE_KEY, deliveryId).del(this.jobKey(deliveryId)).exec();
  }

  async scheduleRetry(job: WebhookJob, delayMs: number): Promise<void> {
    const next: WebhookJob = {
      ...job,
      attempt: job.attempt + 1
    };
    await this.redis
      .multi()
      .set(this.jobKey(job.id), JSON.stringify(next))
      .zadd(WEBHOOK_QUEUE_KEY, Date.now() + delayMs, job.id)
      .exec();
  }
}
