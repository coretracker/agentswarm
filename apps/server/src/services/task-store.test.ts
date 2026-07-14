import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateTaskInput, Repository } from "@verft/shared-types";
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
    get: (key: string) => unknown;
    rpush: (key: string, ...values: string[]) => unknown;
    ltrim: (key: string, start: number, stop: number) => unknown;
    sadd: (key: string, ...members: string[]) => unknown;
    del: (...keys: string[]) => unknown;
    exec: () => Promise<unknown[]>;
  } {
    const operations: Array<() => unknown> = [];
    const chain = {
      set: (key: string, value: string) => {
        operations.push(() => {
          this.kv.set(key, value);
          return "OK";
        });
        return chain;
      },
      get: (key: string) => {
        operations.push(() => this.kv.get(key) ?? null);
        return chain;
      },
      rpush: (key: string, ...values: string[]) => {
        operations.push(() => {
          this.getList(key).push(...values);
          return this.getList(key).length;
        });
        return chain;
      },
      ltrim: (key: string, start: number, stop: number) => {
        operations.push(() => {
          const list = this.getList(key);
          const normalizedStart = this.normalizeIndex(list.length, start);
          const normalizedStop = stop < 0 ? list.length + stop : Math.min(stop, list.length - 1);
          this.lists.set(key, normalizedStop < normalizedStart ? [] : list.slice(normalizedStart, normalizedStop + 1));
          return "OK";
        });
        return chain;
      },
      sadd: (key: string, ...members: string[]) => {
        operations.push(() => {
          const set = this.getSet(key);
          for (const member of members) {
            set.add(member);
          }
          return set.size;
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
          return keys.length;
        });
        return chain;
      },
      exec: async () => {
        return operations.map((operation) => [null, operation()]);
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
  mcpServers: [],
  hostCommands: [],
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

describe("TaskStore pending action messages", () => {
  it("lists, consumes, and deletes pending follow-up messages", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");

    const queuedAsk = await taskStore.appendMessage(task.id, {
      role: "user",
      action: "ask",
      content: "Explain the current diff",
      queueState: "pending",
      queueSource: "user"
    });
    await taskStore.appendMessage(task.id, {
      role: "user",
      action: "build",
      content: "Apply the feedback",
      queueState: "pending",
      queueSource: "user"
    });

    const pendingBeforeConsume = await taskStore.listPendingActionMessages(task.id);
    assert.equal(pendingBeforeConsume.length, 2);
    assert.equal((await taskStore.getNextPendingActionMessage(task.id))?.id, queuedAsk?.id);

    const consumed = await taskStore.consumePendingActionMessage(task.id, queuedAsk!.id);
    assert.equal(consumed?.queueState, null);
    assert.equal((await taskStore.listPendingActionMessages(task.id)).length, 1);

    const remaining = await taskStore.getNextPendingActionMessage(task.id);
    assert.ok(remaining);
    assert.equal(await taskStore.deletePendingActionMessage(task.id, remaining!.id), true);
    assert.equal(await taskStore.hasPendingActionMessage(task.id), false);
  });
});

describe("TaskStore terminal session hydration", () => {
  it("ignores stale persisted terminal flags when no active terminal session exists", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");

    await taskStore.setExecutionState(task.id, "idle", {
      enqueued: false,
      executionAction: null
    });
    await taskStore.patchTask(task.id, {
      activeInteractiveSession: true,
      activeTerminalSessionMode: "terminal"
    });

    const refreshed = await taskStore.getTask(task.id);

    assert.equal(refreshed?.activeInteractiveSession, false);
    assert.equal(refreshed?.activeTerminalSessionMode, null);
    assert.equal(refreshed?.executionStatus, "idle");
    assert.notEqual(refreshed?.executionAction, "terminal");
  });
});

describe("TaskStore.createTask", () => {
  it("creates new build tasks in the build queue", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");

    assert.equal(task.status, "open");
    assert.equal(task.executionStatus, "queued");
    assert.equal(task.executionAction, "build");
    assert.equal(task.startedAt, null);
    assert.equal(task.deadline, null);
  });

  it("creates draft tasks without queueing execution", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask({ ...createTaskInput, draft: true }, repository, "user-1");

    assert.equal(task.status, "draft");
    assert.equal(task.workflowStatus, "backlog");
    assert.equal(task.executionStatus, "idle");
    assert.equal(task.executionAction, null);
    assert.equal(task.startedAt, null);
    assert.equal(task.finishedAt, null);
    assert.deepEqual(await taskStore.listMessages(task.id), []);
  });

  it("normalizes task deadlines", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(
      {
        ...createTaskInput,
        deadline: "2026-06-15T10:30:00+02:00"
      },
      repository,
      "user-1"
    );

    assert.equal(task.deadline, "2026-06-15T08:30:00.000Z");
  });

  it("persists auto-apply checkpoint mode", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(
      {
        ...createTaskInput,
        autoApplyCheckpoints: true
      },
      repository,
      "user-1"
    );

    assert.equal(task.autoApplyCheckpoints, true);
  });

  it("normalizes legacy snippet-source tasks to blank tasks", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");
    await redis.set(
      `verft:task:${task.id}`,
      JSON.stringify({
        ...task,
        taskSource: "snippet",
        snippetId: "snippet-1"
      })
    );

    const refreshed = await taskStore.getTask(task.id);

    assert.equal(refreshed?.taskSource, "blank");
    assert.equal((refreshed as { snippetId?: unknown } | null)?.snippetId, undefined);
  });
});

describe("TaskStore change proposals", () => {
  it("keeps pending checkpoints hidden from task state when auto-apply mode is enabled", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(
      {
        ...createTaskInput,
        autoApplyCheckpoints: true
      },
      repository,
      "user-1"
    );

    const proposal = await taskStore.createChangeProposal({
      id: "proposal-1",
      taskId: task.id,
      sourceType: "build_run",
      sourceId: "run-1",
      status: "pending",
      fromRef: "abc123",
      toRef: "def456",
      diff: "diff --git a/a.ts b/a.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/a.ts"],
      diffTruncated: false,
      untrackedPathsAtCheckpoint: [],
      createdAt: "2026-06-12T08:00:00.000Z"
    });

    assert.ok(proposal);
    const refreshed = await taskStore.getTask(task.id);
    assert.equal(refreshed?.autoApplyCheckpoints, true);
    assert.equal(refreshed?.hasPendingCheckpoint, false);
  });

  it("keeps applying checkpoints non-blocking while preserving unresolved checkpoint safety", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(
      {
        ...createTaskInput,
        autoApplyCheckpoints: true
      },
      repository,
      "user-1"
    );

    const proposal = await taskStore.createChangeProposal({
      id: "proposal-applying",
      taskId: task.id,
      sourceType: "build_run",
      sourceId: "run-1",
      status: "applying",
      fromRef: "abc123",
      toRef: "def456",
      diff: "diff --git a/a.ts b/a.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/a.ts"],
      diffTruncated: false,
      untrackedPathsAtCheckpoint: [],
      createdAt: "2026-06-12T08:00:00.000Z"
    });

    assert.ok(proposal);
    assert.equal(await taskStore.hasPendingChangeProposal(task.id), false);
    const duplicate = await taskStore.createChangeProposal({
      id: "proposal-duplicate",
      taskId: task.id,
      sourceType: "build_run",
      sourceId: "run-2",
      status: "applying",
      fromRef: "abc123",
      toRef: "def456",
      diff: "diff --git a/b.ts b/b.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/b.ts"],
      diffTruncated: false,
      untrackedPathsAtCheckpoint: [],
      createdAt: "2026-06-12T08:00:01.000Z"
    });
    assert.equal(duplicate, null);

    const refreshed = await taskStore.getTask(task.id);
    assert.equal(refreshed?.hasPendingCheckpoint, false);
  });

  it("surfaces manual recovery when auto-apply is disabled and an applying checkpoint becomes pending", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(
      {
        ...createTaskInput,
        autoApplyCheckpoints: true
      },
      repository,
      "user-1"
    );

    await taskStore.createChangeProposal({
      id: "proposal-recovery",
      taskId: task.id,
      sourceType: "build_run",
      sourceId: "run-1",
      status: "applying",
      fromRef: "abc123",
      toRef: "def456",
      diff: "diff --git a/a.ts b/a.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/a.ts"],
      diffTruncated: false,
      untrackedPathsAtCheckpoint: [],
      createdAt: "2026-06-12T08:00:00.000Z"
    });

    await taskStore.patchTask(task.id, { autoApplyCheckpoints: false, hasPendingCheckpoint: true });
    await taskStore.updateChangeProposalStatus("proposal-recovery", "pending", task.id);

    assert.equal(await taskStore.hasPendingChangeProposal(task.id), true);
    const refreshed = await taskStore.getTask(task.id);
    assert.equal(refreshed?.autoApplyCheckpoints, false);
    assert.equal(refreshed?.hasPendingCheckpoint, true);
  });

  it("records initially applied checkpoints as resolved without pending task state", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");

    const proposal = await taskStore.createChangeProposal({
      id: "proposal-applied",
      taskId: task.id,
      sourceType: "build_run",
      sourceId: "run-1",
      status: "applied",
      fromRef: "abc123",
      toRef: "def456",
      diff: "diff --git a/a.ts b/a.ts",
      diffStat: "1 file changed",
      changedFiles: ["src/a.ts"],
      diffTruncated: false,
      untrackedPathsAtCheckpoint: [],
      createdAt: "2026-06-12T08:00:00.000Z"
    });

    assert.ok(proposal);
    assert.equal(proposal.status, "applied");
    assert.equal(typeof proposal.resolvedAt, "string");
    assert.equal(await taskStore.hasPendingChangeProposal(task.id), false);
    const refreshed = await taskStore.getTask(task.id);
    assert.equal(refreshed?.hasPendingCheckpoint, false);
  });

  it("does not report a pending checkpoint blocker from stale stored task state", async () => {
    const redis = new FakeRedis();
    const taskStore = new RedisTaskStore(redis as never, {
      publish: async () => {}
    } as never);
    const task = await taskStore.createTask(createTaskInput, repository, "user-1");
    await taskStore.patchTask(task.id, {
      hasPendingCheckpoint: true,
      status: "awaiting_review"
    });

    assert.equal(await taskStore.hasPendingChangeProposal(task.id), false);
    const refreshed = await taskStore.getTask(task.id);
    assert.equal(refreshed?.hasPendingCheckpoint, false);
  });
});
