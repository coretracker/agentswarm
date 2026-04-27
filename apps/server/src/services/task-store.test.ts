import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateTaskInput, Repository } from "@agentswarm/shared-types";
import { RedisTaskStore } from "./task-store.js";

class FakeRedis {
  private readonly kv = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();
  private readonly sets = new Map<string, Set<string>>();

  private getList(key: string): string[] {
    let current = this.lists.get(key);
    if (!current) {
      current = [];
      this.lists.set(key, current);
    }
    return current;
  }

  private getSet(key: string): Set<string> {
    let current = this.sets.get(key);
    if (!current) {
      current = new Set<string>();
      this.sets.set(key, current);
    }
    return current;
  }

  private normalizeIndex(length: number, index: number): number {
    return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
  }

  async set(key: string, value: string): Promise<"OK"> {
    this.kv.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.getList(key);
    const normalizedStart = this.normalizeIndex(list.length, start);
    const normalizedStop = stop < 0 ? list.length + stop : Math.min(stop, list.length - 1);
    if (normalizedStop < normalizedStart) {
      return [];
    }
    return list.slice(normalizedStart, normalizedStop + 1);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.getList(key);
    list.push(...values);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
    const list = this.getList(key);
    const normalizedStart = this.normalizeIndex(list.length, start);
    const normalizedStop = stop < 0 ? list.length + stop : Math.min(stop, list.length - 1);
    const next = normalizedStop < normalizedStart ? [] : list.slice(normalizedStart, normalizedStop + 1);
    this.lists.set(key, next);
    return "OK";
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.getSet(key);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return [...this.getSet(key)];
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      deleted += Number(this.kv.delete(key));
      deleted += Number(this.lists.delete(key));
      deleted += Number(this.sets.delete(key));
    }
    return deleted;
  }

  multi(): {
    set: (key: string, value: string) => unknown;
    rpush: (key: string, ...values: string[]) => unknown;
    ltrim: (key: string, start: number, stop: number) => unknown;
    sadd: (key: string, ...members: string[]) => unknown;
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
      rpush: (key: string, ...values: string[]) => {
        operations.push(() => {
          this.getList(key).push(...values);
        });
        return chain;
      },
      ltrim: (key: string, start: number, stop: number) => {
        operations.push(() => {
          const list = this.getList(key);
          const normalizedStart = this.normalizeIndex(list.length, start);
          const normalizedStop = stop < 0 ? list.length + stop : Math.min(stop, list.length - 1);
          this.lists.set(key, normalizedStop < normalizedStart ? [] : list.slice(normalizedStart, normalizedStop + 1));
        });
        return chain;
      },
      sadd: (key: string, ...members: string[]) => {
        operations.push(() => {
          const set = this.getSet(key);
          for (const member of members) {
            set.add(member);
          }
        });
        return chain;
      },
      del: (...keys: string[]) => {
        operations.push(() => {
          for (const key of keys) {
            this.kv.delete(key);
            this.lists.delete(key);
            this.sets.delete(key);
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

  pipeline() {
    return this.multi();
  }
}

const repository: Repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/example/repo.git",
  defaultBranch: "main",
  envVars: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const createTaskInput: CreateTaskInput = {
  title: "Persist context",
  repoId: repository.id,
  prompt: "Initial prompt",
  taskType: "build"
};

describe("TaskStore.appendMessage", () => {
  it("persists user messages", async () => {
    const redis = new FakeRedis();
    const publishedEvents: unknown[] = [];
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async (event: unknown) => {
        publishedEvents.push(event);
      }
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");
    await taskStore.appendMessage(task.id, {
      role: "user",
      action: "ask",
      content: "What changed?"
    });

    const messages = await taskStore.listMessages(task.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.content, "What changed?");
    assert.equal(messages[1]?.action, "ask");
    assert.equal(publishedEvents.length, 3);
  });
});
