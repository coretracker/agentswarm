import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Repository } from "@agentswarm/shared-types";
import type { GitHubOutboundJob, GitHubOutboundQueueStore } from "./github-outbound-queue-store.js";
import { GitHubOutboundService } from "./github-outbound-service.js";

class InMemoryQueueStore implements GitHubOutboundQueueStore {
  jobs = new Map<string, GitHubOutboundJob>();
  due = new Set<string>();
  deadLetters: Array<{ id: string; reason: string }> = [];
  idempotency = new Set<string>();
  repoNotBefore = new Map<string, number>();

  async enqueueJob(job: Omit<GitHubOutboundJob, "id" | "attempt" | "createdAt">): Promise<boolean> {
    if (this.idempotency.has(job.idempotencyKey)) {
      return false;
    }
    this.idempotency.add(job.idempotencyKey);
    const queued: GitHubOutboundJob = {
      ...job,
      id: `${job.idempotencyKey}:${Math.random()}`,
      attempt: 1,
      createdAt: new Date().toISOString()
    };
    this.jobs.set(queued.id, queued);
    this.due.add(queued.id);
    return true;
  }

  async listDueJobIds(_now: number, limit: number): Promise<string[]> {
    return [...this.due].slice(0, limit);
  }

  async getJob(jobId: string): Promise<GitHubOutboundJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    this.due.delete(jobId);
  }

  async schedule(job: GitHubOutboundJob, _delayMs: number, incrementAttempt: boolean): Promise<void> {
    this.jobs.set(job.id, {
      ...job,
      attempt: incrementAttempt ? job.attempt + 1 : job.attempt
    });
    this.due.add(job.id);
  }

  async moveToDeadLetter(job: GitHubOutboundJob, reason: string): Promise<void> {
    this.deadLetters.push({ id: job.id, reason });
    this.jobs.delete(job.id);
    this.due.delete(job.id);
  }

  async getRepoNotBefore(repositoryId: string): Promise<number | null> {
    return this.repoNotBefore.get(repositoryId) ?? null;
  }

  async setRepoNotBefore(repositoryId: string, timestampMs: number): Promise<void> {
    this.repoNotBefore.set(repositoryId, timestampMs);
  }
}

const repo = (): Repository => ({
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
});

describe("GitHubOutboundService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("deduplicates by idempotency key", async () => {
    const queue = new InMemoryQueueStore();
    const service = new GitHubOutboundService(
      queue,
      { getRepository: async () => repo() } as never,
      { getRuntimeCredentials: async () => ({ githubToken: "token" }) } as never
    );

    const first = await service.enqueueSummaryComment({
      repositoryId: "repo-1",
      issueNumber: 20,
      body: "Summary",
      idempotencyKey: "same-key"
    });
    const second = await service.enqueueSummaryComment({
      repositoryId: "repo-1",
      issueNumber: 20,
      body: "Summary",
      idempotencyKey: "same-key"
    });

    assert.equal(first, true);
    assert.equal(second, false);
  });

  it("retries failed jobs and dead-letters after max attempts", async () => {
    const queue = new InMemoryQueueStore();
    const service = new GitHubOutboundService(
      queue,
      { getRepository: async () => repo() } as never,
      { getRuntimeCredentials: async () => ({ githubToken: "token" }) } as never
    );

    await service.enqueueSummaryComment({
      repositoryId: "repo-1",
      issueNumber: 20,
      body: "Summary",
      idempotencyKey: "retry-key"
    });

    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

    for (let index = 0; index < 4; index += 1) {
      await (service as unknown as { processDueJobs: () => Promise<void> }).processDueJobs();
    }

    assert.equal(queue.jobs.size, 0);
    assert.equal(queue.deadLetters.length, 1);
    assert.match(queue.deadLetters[0]?.reason ?? "", /GitHub API error 500/i);
  });

  it("rate-guards by repository to avoid burst spam", async () => {
    const queue = new InMemoryQueueStore();
    const service = new GitHubOutboundService(
      queue,
      { getRepository: async () => repo() } as never,
      { getRuntimeCredentials: async () => ({ githubToken: "token" }) } as never
    );

    await service.enqueueSummaryComment({
      repositoryId: "repo-1",
      issueNumber: 20,
      body: "one",
      idempotencyKey: "k1"
    });
    await service.enqueueSummaryComment({
      repositoryId: "repo-1",
      issueNumber: 20,
      body: "two",
      idempotencyKey: "k2"
    });

    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response("ok", { status: 201 });
    }) as typeof fetch;

    await (service as unknown as { processDueJobs: () => Promise<void> }).processDueJobs();
    assert.equal(callCount, 1);

    await (service as unknown as { processDueJobs: () => Promise<void> }).processDueJobs();
    assert.equal(callCount, 1);

    queue.repoNotBefore.set("repo-1", Date.now() - 1);
    await (service as unknown as { processDueJobs: () => Promise<void> }).processDueJobs();
    assert.equal(callCount, 2);
  });
});
