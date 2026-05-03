import type Redis from "ioredis";

export interface SlackTaskThreadRecord {
  taskId: string;
  channelId: string;
  threadTs: string;
  rootMessageTs: string;
  lastKnownStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

const TASK_THREAD_KEY_PREFIX = "agentswarm:slack:task-thread:";
const THREAD_TASK_KEY_PREFIX = "agentswarm:slack:thread-task:";
const nowIso = (): string => new Date().toISOString();

export class SlackThreadStore {
  constructor(private readonly redis: Redis) {}

  private taskKey(taskId: string): string {
    return `${TASK_THREAD_KEY_PREFIX}${taskId.trim()}`;
  }

  private threadKey(channelId: string, threadTs: string): string {
    return `${THREAD_TASK_KEY_PREFIX}${channelId.trim()}:${threadTs.trim()}`;
  }

  async getByTaskId(taskId: string): Promise<SlackTaskThreadRecord | null> {
    const key = this.taskKey(taskId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as SlackTaskThreadRecord;
    } catch {
      return null;
    }
  }

  async getByThread(channelId: string, threadTs: string): Promise<SlackTaskThreadRecord | null> {
    const rawTaskId = await this.redis.get(this.threadKey(channelId, threadTs));
    if (!rawTaskId) {
      return null;
    }
    return this.getByTaskId(rawTaskId);
  }

  async set(record: SlackTaskThreadRecord): Promise<void> {
    const normalized: SlackTaskThreadRecord = {
      ...record,
      taskId: record.taskId.trim(),
      channelId: record.channelId.trim(),
      threadTs: record.threadTs.trim(),
      rootMessageTs: record.rootMessageTs.trim(),
      lastKnownStatus: record.lastKnownStatus?.trim() || null,
      updatedAt: nowIso(),
      createdAt: record.createdAt?.trim() || nowIso()
    };

    await this.redis.set(this.taskKey(normalized.taskId), JSON.stringify(normalized));
    await this.redis.set(this.threadKey(normalized.channelId, normalized.threadTs), normalized.taskId);
  }

  async updateStatus(taskId: string, lastKnownStatus: string | null): Promise<void> {
    const current = await this.getByTaskId(taskId);
    if (!current) {
      return;
    }

    await this.set({
      ...current,
      lastKnownStatus
    });
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    const current = await this.getByTaskId(taskId);
    if (current) {
      await this.redis.del(this.threadKey(current.channelId, current.threadTs));
    }
    await this.redis.del(this.taskKey(taskId));
  }
}
