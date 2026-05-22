import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RealtimeEvent, Repository, Task } from "@agentswarm/shared-types";
import type { RepositoryStore } from "./repository-store.js";
import { GitHubStatusSyncService } from "./github-status-sync-service.js";

class MockRepositoryStore implements Pick<RepositoryStore, "getRepository"> {
  constructor(private readonly repository: Repository | null) {}
  async getRepository(): Promise<Repository | null> {
    return this.repository;
  }
}

class MockGitHubOutboundService {
  comments: Array<{ repositoryId: string; issueNumber: number; body: string; idempotencyKey: string }> = [];
  labels: Array<{ repositoryId: string; issueNumber: number; add?: string[]; remove?: string[]; idempotencyKey: string }> = [];

  async enqueueSummaryComment(input: { repositoryId: string; issueNumber: number; body: string; idempotencyKey: string }): Promise<boolean> {
    this.comments.push(input);
    return true;
  }

  async enqueueLabelUpdate(input: {
    repositoryId: string;
    issueNumber: number;
    add?: string[];
    remove?: string[];
    idempotencyKey: string;
  }): Promise<boolean> {
    this.labels.push(input);
    return true;
  }
}

const buildTask = (status: Task["status"]): Task => ({
  id: "task-1",
  title: "Issue #22",
  pinned: false,
  hasPendingCheckpoint: false,
  activeInteractiveSession: false,
  activeTerminalSessionMode: null,
  ownerUserId: "user-1",
  creatorName: "Dev",
  repoId: "repo-1",
  repoName: "Repo",
  repoUrl: "https://github.com/acme/repo",
  repoDefaultBranch: "main",
  taskType: "build",
  provider: "codex",
  providerProfile: "medium",
  modelOverride: null,
  codexCredentialSource: "auto",
  baseBranch: "main",
  branchStrategy: "feature_branch",
  complexity: "normal",
  branchName: null,
  workspaceBaseRef: null,
  prompt: "Imported from GitHub issue #22: Test issue\n\nIssue URL: https://github.com/acme/repo/issues/22",
  notes: "",
  resultMarkdown: null,
  executionSummary: "",
  branchDiff: null,
  pullCount: 0,
  pushCount: 0,
  lastAction: "build",
  status,
  logs: [],
  enqueued: false,
  createdAt: "2026-05-22T00:00:00.000Z",
  updatedAt: "2026-05-22T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  errorMessage: null
});

describe("GitHubStatusSyncService", () => {
  it("posts milestone updates when sync_status_enabled is true", async () => {
    const repository: Repository = {
      id: "repo-1",
      name: "Repo",
      url: "https://github.com/acme/repo",
      defaultBranch: "main",
      syncStatusEnabled: true,
      envVars: [],
      webhookUrl: null,
      webhookEnabled: false,
      webhookSecretConfigured: false,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z"
    };
    const outbound = new MockGitHubOutboundService();
    const service = new GitHubStatusSyncService(new MockRepositoryStore(repository) as unknown as RepositoryStore, outbound as never, () =>
      "2026-05-22T12:00:00.000Z"
    );

    const createdEvent: RealtimeEvent = { type: "task:created", payload: buildTask("build_queued") };
    const startedEvent: RealtimeEvent = { type: "task:updated", payload: buildTask("building") };
    const doneEvent: RealtimeEvent = { type: "task:updated", payload: buildTask("done") };

    await service.handleRealtimeEvent(createdEvent);
    await service.handleRealtimeEvent(startedEvent);
    await service.handleRealtimeEvent(doneEvent);

    assert.equal(outbound.labels.length, 2);
    assert.equal(outbound.comments.length, 2);
    assert.deepEqual(outbound.labels[0]?.add, ["as:in-progress"]);
    assert.deepEqual(outbound.labels[1]?.add, ["as:done"]);
    assert.equal(outbound.comments[0]?.body, "Work started.");
    assert.equal(outbound.comments[1]?.body, "Work completed.");
  });

  it("does not post when sync_status_enabled is false", async () => {
    const repository: Repository = {
      id: "repo-1",
      name: "Repo",
      url: "https://github.com/acme/repo",
      defaultBranch: "main",
      syncStatusEnabled: false,
      envVars: [],
      webhookUrl: null,
      webhookEnabled: false,
      webhookSecretConfigured: false,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z"
    };
    const outbound = new MockGitHubOutboundService();
    const service = new GitHubStatusSyncService(new MockRepositoryStore(repository) as unknown as RepositoryStore, outbound as never);

    await service.handleRealtimeEvent({ type: "task:created", payload: buildTask("build_queued") });
    await service.handleRealtimeEvent({ type: "task:updated", payload: buildTask("building") });

    assert.equal(outbound.labels.length, 0);
    assert.equal(outbound.comments.length, 0);
  });
});
