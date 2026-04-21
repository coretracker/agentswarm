import { createHmac } from "node:crypto";
import type { RealtimeEvent, Repository, Task } from "@agentswarm/shared-types";
import type { RepositoryStore } from "./repository-store.js";
import type { WebhookDeliveryStore, WebhookEventType, WebhookJob } from "./webhook-delivery-store.js";

const WEBHOOK_PROCESS_INTERVAL_MS = 1_000;
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 900_000];
const WEBHOOK_BATCH_SIZE = 20;

interface WebhookEnvelope {
  deliveryId: string;
  eventType: WebhookEventType;
  sentAt: string;
  repository: {
    id: string;
    name: string;
    url: string;
    defaultBranch: string;
  };
  payload: Record<string, unknown>;
}

const nowIso = (): string => new Date().toISOString();

export class WebhookDeliveryService {
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly webhookDeliveryStore: WebhookDeliveryStore,
    private readonly repositoryStore: RepositoryStore
  ) {}

  private selectTaskPayload(task: Task): Record<string, unknown> {
    return {
      id: task.id,
      repoId: task.repoId,
      title: task.title,
      taskType: task.taskType,
      status: task.status,
      branchName: task.branchName,
      baseBranch: task.baseBranch,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      finishedAt: task.finishedAt
    };
  }

  async handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === "task:created") {
      await this.webhookDeliveryStore.enqueueJob({
        repositoryId: event.payload.repoId,
        eventType: "created",
        payload: { task: this.selectTaskPayload(event.payload) }
      });
      await this.webhookDeliveryStore.setLastTaskStatus(event.payload.id, event.payload.status);
      return;
    }

    if (event.type === "task:updated") {
      const lastStatus = await this.webhookDeliveryStore.getLastTaskStatus(event.payload.id);
      if (lastStatus !== event.payload.status) {
        await this.webhookDeliveryStore.enqueueJob({
          repositoryId: event.payload.repoId,
          eventType: "updated",
          payload: {
            previousStatus: lastStatus,
            currentStatus: event.payload.status,
            task: this.selectTaskPayload(event.payload)
          }
        });
      }
      await this.webhookDeliveryStore.setLastTaskStatus(event.payload.id, event.payload.status);
      return;
    }

    if (event.type === "task:deleted") {
      await this.webhookDeliveryStore.enqueueJob({
        repositoryId: event.payload.repoId,
        eventType: "deleted",
        payload: {
          taskId: event.payload.id,
          repoId: event.payload.repoId
        }
      });
      await this.webhookDeliveryStore.clearLastTaskStatus(event.payload.id);
      return;
    }

    if (event.type === "task:pushed") {
      await this.webhookDeliveryStore.enqueueJob({
        repositoryId: event.payload.repoId,
        eventType: "pushed",
        payload: {
          taskId: event.payload.taskId,
          repoId: event.payload.repoId,
          branchName: event.payload.branchName,
          commitMessage: event.payload.commitMessage,
          triggeredAt: event.payload.triggeredAt
        }
      });
      return;
    }

    if (event.type === "task:merged") {
      await this.webhookDeliveryStore.enqueueJob({
        repositoryId: event.payload.repoId,
        eventType: "merged",
        payload: {
          taskId: event.payload.taskId,
          repoId: event.payload.repoId,
          sourceBranch: event.payload.sourceBranch,
          targetBranch: event.payload.targetBranch,
          commitMessage: event.payload.commitMessage,
          triggeredAt: event.payload.triggeredAt
        }
      });
    }
  }

  start(): void {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      void this.processDueJobs();
    }, WEBHOOK_PROCESS_INTERVAL_MS);
  }

  stop(): void {
    if (!this.interval) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  private buildEnvelope(job: WebhookJob, repository: Repository, sentAt: string): WebhookEnvelope {
    return {
      deliveryId: job.id,
      eventType: job.eventType,
      sentAt,
      repository: {
        id: repository.id,
        name: repository.name,
        url: repository.url,
        defaultBranch: repository.defaultBranch
      },
      payload: job.payload
    };
  }

  private async deliver(job: WebhookJob): Promise<void> {
    const target = await this.repositoryStore.getRepositoryWebhookTarget(job.repositoryId);
    if (!target) {
      return;
    }

    const sentAt = nowIso();
    const envelope = this.buildEnvelope(job, target.repository, sentAt);
    const body = JSON.stringify(envelope);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", target.webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const response = await fetch(target.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentswarm-event": job.eventType,
        "x-agentswarm-delivery-id": job.id,
        "x-agentswarm-timestamp": timestamp,
        "x-agentswarm-signature": `sha256=${signature}`
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with HTTP ${response.status}`);
    }

    await this.repositoryStore.recordWebhookDeliveryResult(job.repositoryId, {
      status: "success",
      attemptedAt: sentAt
    });
  }

  private async processDueJobs(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      const dueIds = await this.webhookDeliveryStore.listDueJobIds(Date.now(), WEBHOOK_BATCH_SIZE);
      if (dueIds.length === 0) {
        return;
      }

      for (const deliveryId of dueIds) {
        const job = await this.webhookDeliveryStore.getJob(deliveryId);
        if (!job) {
          await this.webhookDeliveryStore.deleteJob(deliveryId);
          continue;
        }

        try {
          await this.deliver(job);
          await this.webhookDeliveryStore.deleteJob(deliveryId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Webhook delivery failed.";
          await this.repositoryStore.recordWebhookDeliveryResult(job.repositoryId, {
            status: "failed",
            attemptedAt: nowIso(),
            errorMessage: detail
          });

          const retryDelay = WEBHOOK_RETRY_DELAYS_MS[job.attempt - 1];
          if (retryDelay === undefined) {
            await this.webhookDeliveryStore.deleteJob(deliveryId);
            continue;
          }

          await this.webhookDeliveryStore.scheduleRetry(job, retryDelay);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
