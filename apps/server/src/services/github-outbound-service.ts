import type { Repository } from "@agentswarm/shared-types";
import type { RepositoryStore } from "./repository-store.js";
import type { SettingsStore } from "./settings-store.js";
import type {
  GitHubLabelUpdatePayload,
  GitHubOutboundJob,
  GitHubOutboundQueueStore,
  GitHubSummaryCommentPayload
} from "./github-outbound-queue-store.js";

const GITHUB_API_URL = "https://api.github.com";
const PROCESS_INTERVAL_MS = 1_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];
const PER_REPO_MIN_SPACING_MS = 2_500;

const parseGitHubRepository = (repoUrl: string): { owner: string; repo: string } => {
  const httpsMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  }

  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }

  throw new Error("Repository URL is not a github.com repository.");
};

const normalizeLabelList = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));

const isSummaryCommentPayload = (payload: GitHubOutboundJob["payload"]): payload is GitHubSummaryCommentPayload =>
  typeof (payload as GitHubSummaryCommentPayload).issueNumber === "number" && typeof (payload as GitHubSummaryCommentPayload).body === "string";

const isLabelUpdatePayload = (payload: GitHubOutboundJob["payload"]): payload is GitHubLabelUpdatePayload =>
  typeof (payload as GitHubLabelUpdatePayload).issueNumber === "number" &&
  Array.isArray((payload as GitHubLabelUpdatePayload).add) &&
  Array.isArray((payload as GitHubLabelUpdatePayload).remove);

export class GitHubOutboundService {
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly queueStore: GitHubOutboundQueueStore,
    private readonly repositoryStore: RepositoryStore,
    private readonly settingsStore: SettingsStore
  ) {}

  async enqueueSummaryComment(input: {
    repositoryId: string;
    issueNumber: number;
    body: string;
    idempotencyKey: string;
  }): Promise<boolean> {
    return this.queueStore.enqueueJob({
      repositoryId: input.repositoryId,
      type: "summary_comment",
      payload: {
        issueNumber: input.issueNumber,
        body: input.body
      },
      idempotencyKey: input.idempotencyKey
    });
  }

  async enqueueLabelUpdate(input: {
    repositoryId: string;
    issueNumber: number;
    add?: string[];
    remove?: string[];
    idempotencyKey: string;
  }): Promise<boolean> {
    return this.queueStore.enqueueJob({
      repositoryId: input.repositoryId,
      type: "label_update",
      payload: {
        issueNumber: input.issueNumber,
        add: normalizeLabelList(input.add ?? []),
        remove: normalizeLabelList(input.remove ?? [])
      },
      idempotencyKey: input.idempotencyKey
    });
  }

  start(): void {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      void this.processDueJobs();
    }, PROCESS_INTERVAL_MS);
  }

  stop(): void {
    if (!this.interval) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  private async getGitHubToken(): Promise<string> {
    const creds = await this.settingsStore.getRuntimeCredentials();
    if (!creds.githubToken) {
      throw new Error("GitHub token is not configured.");
    }
    return creds.githubToken;
  }

  private async fetchRepositoryOrThrow(repositoryId: string): Promise<Repository> {
    const repository = await this.repositoryStore.getRepository(repositoryId);
    if (!repository) {
      throw new Error("Repository not found.");
    }
    return repository;
  }

  private async callGitHubApi(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getGitHubToken();
    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AgentSwarm",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text || response.statusText}`);
    }

    return response;
  }

  private async postSummaryComment(repository: Repository, payload: GitHubSummaryCommentPayload): Promise<void> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const body = payload.body.trim();
    if (!body) {
      throw new Error("Summary comment body is empty.");
    }

    await this.callGitHubApi(`/repos/${owner}/${repo}/issues/${payload.issueNumber}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });
  }

  private async updateLabels(repository: Repository, payload: GitHubLabelUpdatePayload): Promise<void> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const issuePath = `/repos/${owner}/${repo}/issues/${payload.issueNumber}`;

    const issueResponse = await this.callGitHubApi(issuePath, { method: "GET" });
    const issueData = (await issueResponse.json()) as { labels?: Array<{ name?: string }> };
    const existing = new Set((issueData.labels ?? []).map((label) => (label.name ?? "").trim()).filter(Boolean));

    for (const label of payload.remove) {
      existing.delete(label);
    }
    for (const label of payload.add) {
      existing.add(label);
    }

    await this.callGitHubApi(issuePath, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: [...existing] })
    });
  }

  private async deliver(job: GitHubOutboundJob): Promise<void> {
    const repository = await this.fetchRepositoryOrThrow(job.repositoryId);

    if (job.type === "summary_comment") {
      if (!isSummaryCommentPayload(job.payload)) {
        throw new Error("Invalid summary_comment payload.");
      }
      await this.postSummaryComment(repository, job.payload);
      return;
    }

    if (job.type === "label_update") {
      if (!isLabelUpdatePayload(job.payload)) {
        throw new Error("Invalid label_update payload.");
      }
      await this.updateLabels(repository, {
        issueNumber: job.payload.issueNumber,
        add: normalizeLabelList(job.payload.add),
        remove: normalizeLabelList(job.payload.remove)
      });
      return;
    }

    throw new Error("Unsupported outbound job type.");
  }

  private async processDueJobs(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;
    try {
      const dueIds = await this.queueStore.listDueJobIds(Date.now(), BATCH_SIZE);
      if (dueIds.length === 0) {
        return;
      }

      for (const jobId of dueIds) {
        const job = await this.queueStore.getJob(jobId);
        if (!job) {
          await this.queueStore.deleteJob(jobId);
          continue;
        }

        const repoNotBefore = await this.queueStore.getRepoNotBefore(job.repositoryId);
        const now = Date.now();
        if (repoNotBefore !== null && repoNotBefore > now) {
          await this.queueStore.schedule(job, repoNotBefore - now, false);
          continue;
        }

        try {
          await this.deliver(job);
          await this.queueStore.deleteJob(job.id);
          await this.queueStore.setRepoNotBefore(job.repositoryId, Date.now() + PER_REPO_MIN_SPACING_MS);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "GitHub outbound delivery failed.";
          if (job.attempt >= MAX_ATTEMPTS) {
            await this.queueStore.moveToDeadLetter(job, reason);
            continue;
          }

          const retryDelay = RETRY_DELAYS_MS[Math.max(0, job.attempt - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
          await this.queueStore.schedule(job, retryDelay, true);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
