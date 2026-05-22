import type { RealtimeEvent, Task, TaskStatus } from "@agentswarm/shared-types";
import type { RepositoryStore } from "./repository-store.js";
import type { GitHubOutboundService } from "./github-outbound-service.js";

const STATUS_LABELS = ["as:queued", "as:in-progress", "as:blocked", "as:done"] as const;
type StatusLabel = (typeof STATUS_LABELS)[number];

type Milestone =
  | { label: "as:in-progress"; comment: "Work started." }
  | { label: "as:done"; comment: "Work completed." }
  | { label: "as:blocked"; comment: `Work stopped: ${string}.` };

const findGitHubIssueNumber = (task: Task): number | null => {
  const firstLine = task.prompt.split("\n")[0]?.trim() ?? "";
  const issueMatch = firstLine.match(/GitHub issue #(\d+)/i);
  if (issueMatch) {
    return Number(issueMatch[1]);
  }
  const prMatch = firstLine.match(/pull request #(\d+)/i);
  if (prMatch) {
    return Number(prMatch[1]);
  }
  return null;
};

const isQueuedStatus = (status: TaskStatus): boolean => status === "build_queued" || status === "ask_queued";
const isInProgressStatus = (status: TaskStatus): boolean => status === "preparing_workspace" || status === "building" || status === "asking";
const isDoneStatus = (status: TaskStatus): boolean =>
  status === "done" || status === "completed" || status === "answered" || status === "accepted";

const toMilestone = (status: TaskStatus): Milestone | null => {
  if (isInProgressStatus(status)) {
    return { label: "as:in-progress", comment: "Work started." };
  }
  if (isDoneStatus(status)) {
    return { label: "as:done", comment: "Work completed." };
  }
  if (status === "failed") {
    return { label: "as:blocked", comment: "Work stopped: task failed." };
  }
  if (status === "cancelled") {
    return { label: "as:blocked", comment: "Work stopped: task cancelled." };
  }
  return null;
};

const statusRank = (status: TaskStatus): number => {
  if (isQueuedStatus(status)) {
    return 1;
  }
  if (isInProgressStatus(status)) {
    return 2;
  }
  if (isDoneStatus(status)) {
    return 3;
  }
  if (status === "failed" || status === "cancelled") {
    return 4;
  }
  return 0;
};

export class GitHubStatusSyncService {
  private readonly lastStatusByTaskId = new Map<string, TaskStatus>();

  constructor(
    private readonly repositoryStore: RepositoryStore,
    private readonly githubOutboundService: GitHubOutboundService,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === "task:created") {
      this.lastStatusByTaskId.set(event.payload.id, event.payload.status);
      return;
    }

    if (event.type !== "task:updated") {
      return;
    }

    const task = event.payload;
    const previousStatus = this.lastStatusByTaskId.get(task.id) ?? null;
    this.lastStatusByTaskId.set(task.id, task.status);
    if (!GitHubStatusSyncService.isMeaningfulStatusTransition(previousStatus, task.status)) {
      return;
    }

    const issueNumber = findGitHubIssueNumber(task);
    if (!issueNumber) {
      return;
    }

    const repository = await this.repositoryStore.getRepository(task.repoId);
    if (!repository || repository.syncStatusEnabled !== true) {
      return;
    }

    const milestone = toMilestone(task.status);
    if (!milestone) {
      return;
    }

    const idPrefix = `${task.id}:${task.status}:${this.now().slice(0, 10)}`;
    await this.githubOutboundService.enqueueLabelUpdate({
      repositoryId: task.repoId,
      issueNumber,
      add: [milestone.label],
      remove: STATUS_LABELS.filter((entry) => entry !== milestone.label),
      idempotencyKey: `status-label:${idPrefix}`
    });
    await this.githubOutboundService.enqueueSummaryComment({
      repositoryId: task.repoId,
      issueNumber,
      body: milestone.comment,
      idempotencyKey: `status-comment:${idPrefix}`
    });
  }

  static isMeaningfulStatusTransition(previousStatus: TaskStatus | null, nextStatus: TaskStatus): boolean {
    if (!previousStatus || previousStatus === nextStatus) {
      return false;
    }
    return statusRank(previousStatus) !== statusRank(nextStatus);
  }
}
