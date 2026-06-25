import type { Repository, Task, TaskChangeProposal, TaskMessage, TaskRun } from "@agentswarm/shared-types";

const DEFAULT_TEXT_LIMIT = 4_000;

export const clampLimit = (value: unknown, fallback: number, max: number): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, numeric));
};

export const truncateText = (value: string | null | undefined, limit = DEFAULT_TEXT_LIMIT): { text: string | null; truncated: boolean } => {
  if (value == null) {
    return { text: null, truncated: false };
  }
  if (value.length <= limit) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, limit), truncated: true };
};

export const compactRepository = (repository: Repository) => ({
  id: repository.id,
  name: repository.name,
  url: repository.url,
  defaultBranch: repository.defaultBranch,
  webhookEnabled: repository.webhookEnabled,
  createdAt: repository.createdAt,
  updatedAt: repository.updatedAt
});

export const compactTask = (task: Task) => ({
  id: task.id,
  title: task.title,
  repoId: task.repoId,
  repoName: task.repoName,
  ...(task.githubPrNumber ? { githubPrNumber: task.githubPrNumber } : {}),
  taskType: task.taskType,
  status: task.status,
  workflowStatus: task.workflowStatus,
  executionStatus: task.executionStatus,
  executionAction: task.executionAction,
  reviewReason: task.reviewReason,
  pinned: task.pinned,
  hasPendingCheckpoint: task.hasPendingCheckpoint,
  autoApplyCheckpoints: task.autoApplyCheckpoints,
  branchName: task.branchName,
  baseBranch: task.baseBranch,
  branchStrategy: task.branchStrategy,
  updatedAt: task.updatedAt,
  createdAt: task.createdAt
});

export const detailTask = (task: Task) => {
  const result = truncateText(task.resultMarkdown, 6_000);
  return {
    ...compactTask(task),
    prompt: truncateText(task.prompt, 4_000),
    resultMarkdown: result,
    errorMessage: task.errorMessage,
    provider: task.provider,
    providerProfile: task.providerProfile,
    modelOverride: task.modelOverride,
    codexCredentialSource: task.codexCredentialSource,
    deadline: task.deadline,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    lastAction: task.lastAction
  };
};

export const compactMessage = (message: TaskMessage) => ({
  id: message.id,
  role: message.role,
  action: message.action,
  queueState: message.queueState,
  queueSource: message.queueSource,
  createdAt: message.createdAt,
  content: truncateText(message.content, 3_000),
  attachmentCount: message.attachments?.length ?? 0
});

export const compactRun = (run: TaskRun) => ({
  id: run.id,
  action: run.action,
  status: run.status,
  provider: run.provider,
  providerProfile: run.providerProfile,
  modelOverride: run.modelOverride,
  branchName: run.branchName,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  changeOutcome: run.changeOutcome ?? null,
  errorMessage: run.errorMessage,
  summary: truncateText(run.summary, 3_000)
});

export const compactCheckpoint = (proposal: TaskChangeProposal) => ({
  id: proposal.id,
  sourceType: proposal.sourceType,
  sourceId: proposal.sourceId,
  status: proposal.status,
  createdAt: proposal.createdAt,
  resolvedAt: proposal.resolvedAt,
  revertedAt: proposal.revertedAt,
  diffStat: proposal.diffStat,
  changedFiles: proposal.changedFiles.slice(0, 50),
  changedFilesTruncated: proposal.changedFiles.length > 50,
  diffTruncated: proposal.diffTruncated
});
