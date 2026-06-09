import type Redis from "ioredis";
import type { TaskAction, TaskExecutionInput, TaskPromptAttachment } from "@agentswarm/shared-types";
import { normalizeTaskPromptAttachment } from "../lib/task-prompt-attachments.js";

const TASK_QUEUE_KEY = "agentswarm:queue";

export type QueueReason = "manual" | "auto";

const normalizeQueueEntryInput = (input: unknown): TaskExecutionInput | undefined => {
  if (typeof input === "string") {
    return {
      content: input
    };
  }

  if (!input || typeof input !== "object") {
    return undefined;
  }

  const value = input as Partial<TaskExecutionInput> & { attachments?: unknown };
  if (typeof value.content !== "string") {
    return undefined;
  }

  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(normalizeTaskPromptAttachment).filter((attachment): attachment is TaskPromptAttachment => attachment !== null)
    : [];

  return {
    content: value.content,
    ...(attachments.length > 0 ? { attachments } : {})
  };
};

export interface QueueEntry {
  taskId: string;
  reason: QueueReason;
  action: TaskAction;
  input?: TaskExecutionInput;
}

export interface TaskQueueStore {
  replaceTask(entry: QueueEntry): Promise<void>;
  dequeueTask(): Promise<QueueEntry | null>;
  removeTask(taskId: string): Promise<void>;
}

export class RedisTaskQueueStore implements TaskQueueStore {
  constructor(private readonly redis: Redis) {}

  private async rewriteQueue(rawEntries: string[]): Promise<void> {
    const pipeline = this.redis.multi().del(TASK_QUEUE_KEY);
    if (rawEntries.length > 0) {
      pipeline.rpush(TASK_QUEUE_KEY, ...rawEntries);
    }
    await pipeline.exec();
  }

  async removeTask(taskId: string): Promise<void> {
    const rawEntries = await this.redis.lrange(TASK_QUEUE_KEY, 0, -1);
    const filteredEntries = rawEntries.filter((raw) => {
      try {
        const entry = JSON.parse(raw) as QueueEntry;
        return entry.taskId !== taskId;
      } catch {
        return true;
      }
    });

    await this.rewriteQueue(filteredEntries);
  }

  async replaceTask(entry: QueueEntry): Promise<void> {
    const rawEntries = await this.redis.lrange(TASK_QUEUE_KEY, 0, -1);
    const filteredEntries = rawEntries.filter((raw) => {
      try {
        const queuedEntry = JSON.parse(raw) as QueueEntry;
        return queuedEntry.taskId !== entry.taskId;
      } catch {
        return true;
      }
    });

    filteredEntries.push(
      JSON.stringify({
        ...entry,
        input: normalizeQueueEntryInput(entry.input)
      } satisfies QueueEntry)
    );
    await this.rewriteQueue(filteredEntries);
  }

  async dequeueTask(): Promise<QueueEntry | null> {
    const raw = await this.redis.lpop(TASK_QUEUE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as QueueEntry;
      if (
        typeof parsed.taskId === "string" &&
        (parsed.reason === "manual" || parsed.reason === "auto") &&
        (parsed.action === "build" || parsed.action === "ask")
      ) {
        return {
          ...parsed,
          input: normalizeQueueEntryInput(parsed.input)
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
