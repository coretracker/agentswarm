import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import {
  type CodexCredentialSource,
  getTaskExecutionAction,
  getTaskExecutionStatus,
  getTaskReviewReason,
  getTaskWorkflowStatus,
  getQueuedStatusForAction,
  type AgentProvider,
  type CreateTaskInput,
  type ProviderProfile,
  type Repository,
  type Task,
  type TaskAction,
  type TaskExecutionAction,
  type TaskExecutionStatus,
  type TaskMessage,
  type TaskPromptAttachment,
  type TaskReasoningEffort,
  type TaskRun,
  type TaskGitOperation,
  type TaskGitOperationFailureCode,
  type TaskGitOperationStatus,
  type TaskGitOperationType,
  type TaskWorkflowStatus,
  type TaskStatus,
  type TaskChangeProposal,
  type TaskChangeProposalStatus,
  type TaskInteractiveTerminalTranscript,
  type TaskTerminalSessionMode
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import {
  normalizeModelOverride,
  normalizeProvider,
  normalizeProviderProfile
} from "../lib/provider-config.js";
import { parseJsonColumn, type PostgresQueryable, withPostgresTransaction } from "../lib/postgres.js";
import { normalizeTaskPromptAttachment } from "../lib/task-prompt-attachments.js";
import {
  normalizeTaskLifecycleStatus,
  reconcileTaskStatusWithPendingCheckpoint
} from "../lib/task-status.js";
import { buildExecutionSummaryFromPrompt, classifyTaskComplexity } from "../lib/task-intelligence.js";

function resolveTaskTitleForCreate(input: CreateTaskInput): string {
  return (input.title ?? "").trim();
}

const TASK_KEY_PREFIX = "agentswarm:task:";
const TASK_LOG_KEY_PREFIX = "agentswarm:task_logs:";
const TASK_MESSAGE_KEY_PREFIX = "agentswarm:task_messages:";
const TASK_RUN_KEY_PREFIX = "agentswarm:task_run:";
const TASK_RUN_LOG_KEY_PREFIX = "agentswarm:task_run_logs:";
const TASK_RUN_IDS_KEY_PREFIX = "agentswarm:task_run_ids:";
const TASK_GIT_OPERATION_KEY_PREFIX = "agentswarm:task_git_operation:";
const TASK_GIT_OPERATION_IDS_KEY_PREFIX = "agentswarm:task_git_operation_ids:";
const TASK_CHANGE_PROPOSAL_KEY_PREFIX = "agentswarm:task_change_proposal:";
const TASK_CHANGE_PROPOSAL_IDS_KEY_PREFIX = "agentswarm:task_change_proposal_ids:";
const TASK_PENDING_CHANGE_PROPOSAL_KEY_PREFIX = "agentswarm:task_pending_change_proposal:";
const TASK_ACTIVE_INTERACTIVE_SESSION_KEY_PREFIX = "agentswarm:task_active_interactive_session:";
const TASK_INTERACTIVE_TERMINAL_TRANSCRIPT_KEY_PREFIX = "agentswarm:task_interactive_terminal_transcript:";
const TASK_IDS_KEY = "agentswarm:task_ids";
const MAX_LOG_LINES = 400;
const MAX_MESSAGES = 200;
const DEFAULT_HISTORY_PAGE_LIMIT = 25;
const MAX_HISTORY_PAGE_LIMIT = 100;
const LEGACY_START_MODE_FIELD = "start" + "Mode";

const nowIso = (): string => new Date().toISOString();
const POSTGRES_DEADLOCK_ERROR_CODE = "40P01";
const POSTGRES_SERIALIZATION_ERROR_CODE = "40001";

const normalizeDeadline = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const isRetryablePostgresError = (error: unknown): boolean => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = String((error as { code?: string }).code ?? "");
  return code === POSTGRES_DEADLOCK_ERROR_CODE || code === POSTGRES_SERIALIZATION_ERROR_CODE;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const clampHistoryPageLimit = (raw: number | null | undefined): number => {
  if (!Number.isFinite(raw)) {
    return DEFAULT_HISTORY_PAGE_LIMIT;
  }
  return Math.max(1, Math.min(MAX_HISTORY_PAGE_LIMIT, Math.floor(raw as number)));
};

const paginateByTimestamp = <T extends { id: string }>(
  input: T[],
  options: ListTaskHistoryPageOptions | undefined,
  getTimestamp: (item: T) => string
): ListTaskHistoryPageResult<T> => {
  const before = options?.before ?? null;
  const beforeId = options?.beforeId ?? null;
  const limit = clampHistoryPageLimit(options?.limit);
  const filtered = before
    ? input.filter((item) => {
        const timestamp = getTimestamp(item);
        return timestamp < before || (timestamp === before && beforeId !== null && item.id < beforeId);
      })
    : input;
  const start = Math.max(0, filtered.length - (limit + 1));
  const pageSlice = filtered.slice(start);
  const hasMore = pageSlice.length > limit;
  const items = hasMore ? pageSlice.slice(1) : pageSlice;
  return { items, hasMore };
};

const getInitialAction = (task: { taskType: Task["taskType"] }): TaskAction => (task.taskType === "ask" ? "ask" : "build");

const normalizeLegacyTaskType = (taskType: string | null | undefined): Task["taskType"] => (taskType === "ask" ? "ask" : "build");
const currentTaskStatuses = new Set<TaskStatus>([
  "draft",
  "build_queued",
  "preparing_workspace",
  "building",
  "ask_queued",
  "asking",
  "open",
  "in_progress",
  "in_review",
  "awaiting_review",
  "done",
  "completed",
  "answered",
  "accepted",
  "archived",
  "cancelled",
  "failed"
]);

const normalizeLegacyTaskAction = (action: string | null | undefined): TaskAction | null => {
  if (!action) {
    return null;
  }

  return action === "ask" ? "ask" : "build";
};

const normalizeTaskMessageAction = (action: string | null | undefined): TaskMessage["action"] => {
  if (action === "build" || action === "ask" || action === "comment") {
    return action;
  }

  return null;
};

const normalizeTaskMessage = (message: TaskMessage): TaskMessage => {
  const rawAttachments = (message as TaskMessage & { attachments?: unknown }).attachments;
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments.map(normalizeTaskPromptAttachment).filter((attachment): attachment is TaskPromptAttachment => attachment !== null)
    : [];
  const sessionId = typeof message.sessionId === "string" && message.sessionId.trim().length > 0 ? message.sessionId : null;
  const queueState = message.queueState === "pending" ? "pending" : null;
  const queueSource = message.queueSource === "github" ? "github" : message.queueSource === "user" ? "user" : null;

  return {
    ...message,
    action: normalizeTaskMessageAction(message.action),
    ...(queueState !== null || "queueState" in message ? { queueState } : {}),
    ...(queueSource !== null || "queueSource" in message ? { queueSource } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sessionId !== null || "sessionId" in message ? { sessionId } : {})
  };
};

const normalizeTaskExecutionStatus = (value: unknown, fallbackTask: Pick<Task, "status" | "activeInteractiveSession">): TaskExecutionStatus => {
  if (
    value === "idle" ||
    value === "queued" ||
    value === "preparing" ||
    value === "running" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return getTaskExecutionStatus(fallbackTask);
};

const normalizeTaskExecutionAction = (
  value: unknown,
  fallbackTask: Pick<Task, "status" | "lastAction" | "activeInteractiveSession" | "activeTerminalSessionMode">
): TaskExecutionAction => {
  if (value === "build" || value === "ask" || value === "interactive" || value === "terminal") {
    return value;
  }

  return getTaskExecutionAction(fallbackTask);
};

const normalizeTaskWorkflowStatus = (
  value: unknown,
  fallbackTask: Pick<Task, "status" | "hasPendingCheckpoint" | "taskType">
): TaskWorkflowStatus => {
  if (fallbackTask.status === "archived") {
    return "archived";
  }

  if (value === "backlog" || value === "ready" || value === "in_progress" || value === "review" || value === "done") {
    return value;
  }

  return getTaskWorkflowStatus(fallbackTask);
};

const withDerivedTaskState = (task: Task): Task => ({
  ...task,
  workflowStatus: normalizeTaskWorkflowStatus(task.workflowStatus, task),
  executionStatus: normalizeTaskExecutionStatus(task.executionStatus, task),
  executionAction: normalizeTaskExecutionAction(task.executionAction, task),
  reviewReason: getTaskReviewReason(task)
});

const getUserVisiblePendingCheckpoint = (
  task: Pick<Task, "hasPendingCheckpoint" | "autoApplyCheckpoints">,
  hasPendingProposal: boolean
): boolean => (task.autoApplyCheckpoints ? false : task.hasPendingCheckpoint || hasPendingProposal);

const normalizeCodexCredentialSource = (value: string | null | undefined): CodexCredentialSource => {
  if (value === "profile" || value === "global") {
    return value;
  }
  return "auto";
};

export interface ListTasksOptions {
  ownerUserId?: string | null;
  view?: "all" | "active" | "archived";
  limit?: number;
}

export interface CreateTaskRunInput {
  action: TaskAction;
  promptMessageId?: string | null;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  branchName: string | null;
}

export interface CreateTaskGitOperationInput {
  taskId: string;
  operationType: TaskGitOperationType;
  status?: TaskGitOperationStatus;
  attemptCount?: number;
  errorCode?: TaskGitOperationFailureCode | null;
  errorMessage?: string | null;
}

export type UpdateTaskGitOperationPatch = Partial<
  Pick<TaskGitOperation, "status" | "finishedAt" | "errorCode" | "errorMessage" | "attemptCount">
>;

export type UpdateTaskRunPatch = Partial<
  Pick<
    TaskRun,
    | "status"
    | "finishedAt"
    | "summary"
    | "changeOutcome"
    | "errorMessage"
    | "branchName"
    | "changeProposalCheckpointRef"
    | "changeProposalUntrackedPaths"
    | "hasRawJson"
    | "timelineEvents"
    | "promptMessageId"
  >
>;

export interface AppendTaskMessageInput {
  role: TaskMessage["role"];
  content: string;
  action?: TaskMessage["action"];
  queueState?: TaskMessage["queueState"];
  queueSource?: TaskMessage["queueSource"];
  attachments?: TaskPromptAttachment[];
  sessionId?: string | null;
}

export interface ListTaskHistoryPageOptions {
  before?: string | null;
  beforeId?: string | null;
  limit?: number;
}

export interface ListTaskHistoryPageResult<T> {
  items: T[];
  hasMore: boolean;
}

export interface TaskPushedEventInput {
  taskId: string;
  branchName: string;
  commitMessage: string | null;
}

export interface TaskMergedEventInput {
  taskId: string;
  sourceBranch: string;
  targetBranch: string;
  commitMessage: string | null;
}

export interface TaskActiveInteractiveSession {
  sessionId: string;
  checkpointRef: string;
  startedAt: string;
  untrackedPathsAtCheckpoint: string[];
  mode: TaskTerminalSessionMode;
}

export type TaskMetadata = Pick<
  Task,
  | "id"
  | "ownerUserId"
  | "status"
  | "executionStatus"
  | "executionAction"
  | "hasPendingCheckpoint"
  | "autoApplyCheckpoints"
  | "activeInteractiveSession"
  | "activeTerminalSessionMode"
  | "provider"
  | "providerProfile"
  | "modelOverride"
  | "codexCredentialSource"
>;

export type CreateTaskChangeProposalInput = Omit<TaskChangeProposal, "resolvedAt" | "revertedAt"> & {
  resolvedAt?: null;
  revertedAt?: null;
};

export type UpdateTaskChangeProposalUpdates = Partial<
  Pick<TaskChangeProposal, "toRef" | "diff" | "diffStat" | "changedFiles" | "diffTruncated">
>;

export interface TaskStore {
  createTask(input: CreateTaskInput, repository: Repository, ownerUserId: string): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  getTaskMetadata(taskId: string): Promise<TaskMetadata | null>;
  listTasks(options?: ListTasksOptions): Promise<Task[]>;
  patchTask(taskId: string, patch: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task | null>;
  updateResultArtifacts(taskId: string, resultMarkdown: string): Promise<Task | null>;
  appendLog(taskId: string, line: string): Promise<void>;
  appendLogForRun(taskId: string, line: string, runId: string | null): Promise<void>;
  listMessages(taskId: string): Promise<TaskMessage[]>;
  listMessagesPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskMessage>>;
  listRuns(taskId: string): Promise<TaskRun[]>;
  listRunsPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskRun>>;
  getRun(runId: string): Promise<TaskRun | null>;
  createRun(taskId: string, input: CreateTaskRunInput): Promise<TaskRun | null>;
  updateRun(runId: string, patch: UpdateTaskRunPatch): Promise<TaskRun | null>;
  createGitOperation(input: CreateTaskGitOperationInput): Promise<TaskGitOperation | null>;
  updateGitOperation(operationId: string, patch: UpdateTaskGitOperationPatch): Promise<TaskGitOperation | null>;
  getLatestGitOperation(taskId: string): Promise<TaskGitOperation | null>;
  appendMessage(taskId: string, input: AppendTaskMessageInput): Promise<TaskMessage | null>;
  updateMessage(taskId: string, messageId: string, content: string): Promise<TaskMessage | null>;
  setMessageAttachments(taskId: string, messageId: string, attachments: TaskPromptAttachment[]): Promise<TaskMessage | null>;
  listPendingActionMessages(taskId: string): Promise<TaskMessage[]>;
  getNextPendingActionMessage(taskId: string): Promise<TaskMessage | null>;
  hasPendingActionMessage(taskId: string): Promise<boolean>;
  consumePendingActionMessage(taskId: string, messageId: string): Promise<TaskMessage | null>;
  deletePendingActionMessage(taskId: string, messageId: string): Promise<boolean>;
  markQueuedForAction(taskId: string, action: TaskAction): Promise<Task | null>;
  setExecutionState(
    taskId: string,
    executionStatus: TaskExecutionStatus,
    extra?: Partial<Omit<Task, "id" | "createdAt" | "status">>
  ): Promise<Task | null>;
  setStatus(taskId: string, status: TaskStatus, extra?: Partial<Task>): Promise<Task | null>;
  archiveTask(taskId: string): Promise<Task | null>;
  deleteTask(taskId: string): Promise<boolean>;
  publishTaskPushedEvent(input: TaskPushedEventInput): Promise<void>;
  publishTaskMergedEvent(input: TaskMergedEventInput): Promise<void>;
  hasPendingChangeProposal(taskId: string): Promise<boolean>;
  getActiveInteractiveSession(taskId: string): Promise<TaskActiveInteractiveSession | null>;
  setActiveInteractiveSession(taskId: string, session: TaskActiveInteractiveSession): Promise<void>;
  clearActiveInteractiveSession(taskId: string): Promise<void>;
  saveInteractiveTerminalTranscript(taskId: string, sessionId: string, content: string, truncated: boolean): Promise<void>;
  getInteractiveTerminalTranscript(taskId: string, sessionId: string): Promise<TaskInteractiveTerminalTranscript | null>;
  listChangeProposals(taskId: string): Promise<TaskChangeProposal[]>;
  listChangeProposalsPage(
    taskId: string,
    options?: ListTaskHistoryPageOptions
  ): Promise<ListTaskHistoryPageResult<TaskChangeProposal>>;
  getChangeProposal(proposalId: string): Promise<TaskChangeProposal | null>;
  getLatestAppliedChangeProposalId(taskId: string): Promise<string | null>;
  createChangeProposal(input: CreateTaskChangeProposalInput): Promise<TaskChangeProposal | null>;
  updateChangeProposalStatus(
    proposalId: string,
    status: TaskChangeProposalStatus,
    taskId: string,
    updates?: UpdateTaskChangeProposalUpdates
  ): Promise<TaskChangeProposal | null>;
  markCheckpointReverted(proposalId: string, taskId: string): Promise<TaskChangeProposal | null>;
}

export class RedisTaskStore implements TaskStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private normalizeTask(task: Task): Task {
    const legacyTask = task as Task & {
      taskType?: string;
      deadline?: string | null;
      ownerUserId?: string | null;
      repoDefaultBranch?: string;
      resultMarkdown?: string | null;
      provider?: Task["provider"];
      providerProfile?: Task["providerProfile"];
      modelOverride?: string | null;
      codexCredentialSource?: Task["codexCredentialSource"];
      model?: string | null;
      reasoningEffort?: TaskReasoningEffort | null;
      lastAction?: string | null;
      executionStatus?: TaskExecutionStatus;
      executionAction?: TaskExecutionAction;
      // Legacy field kept for migration of stored tasks created before the prompt refactor.
      requirements?: string;
      prompt?: string;
      notes?: string;
      taskSource?: Task["taskSource"];
      snippetId?: string;
    };
    const taskWithoutStartMode = { ...legacyTask } as typeof legacyTask & Record<string, unknown>;
    delete taskWithoutStartMode[LEGACY_START_MODE_FIELD];
    const taskSource = legacyTask.taskSource === "snippet" || legacyTask.taskSource === "blank" ? legacyTask.taskSource : "blank";
    const normalizedTask: Task = {
      ...taskWithoutStartMode,
      deadline: normalizeDeadline(legacyTask.deadline),
      pinned: legacyTask.pinned ?? false,
      hasPendingCheckpoint: legacyTask.hasPendingCheckpoint ?? false,
      autoApplyCheckpoints: legacyTask.autoApplyCheckpoints === true,
      activeInteractiveSession: legacyTask.activeInteractiveSession === true,
      activeTerminalSessionMode:
        legacyTask.activeTerminalSessionMode === "git" || legacyTask.activeTerminalSessionMode === "interactive"
          ? legacyTask.activeTerminalSessionMode
          : legacyTask.activeInteractiveSession === true
            ? "interactive"
            : null,
      ownerUserId: typeof legacyTask.ownerUserId === "string" && legacyTask.ownerUserId.trim().length > 0 ? legacyTask.ownerUserId : null,
      taskType: normalizeLegacyTaskType(legacyTask.taskType),
      provider: normalizeProvider(legacyTask.provider),
      providerProfile: normalizeProviderProfile(legacyTask.providerProfile, legacyTask.reasoningEffort),
      modelOverride: normalizeModelOverride(legacyTask.modelOverride, legacyTask.model),
      codexCredentialSource: normalizeCodexCredentialSource(legacyTask.codexCredentialSource),
      taskSource,
      snippetId:
        taskSource === "snippet" && typeof legacyTask.snippetId === "string" && legacyTask.snippetId.trim().length > 0
          ? legacyTask.snippetId.trim()
          : undefined,
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
      workspaceBaseRef: legacyTask.workspaceBaseRef ?? null,
      resultMarkdown: legacyTask.resultMarkdown ?? null,
      lastAction: normalizeLegacyTaskAction(legacyTask.lastAction),
      // Prefer the new prompt field; fall back to legacy requirements for older tasks.
      prompt: (legacyTask.prompt ?? legacyTask.requirements ?? "").trim(),
      notes: (legacyTask.notes ?? "").trim()
    };
    const fallbackAction = normalizedTask.lastAction ?? getInitialAction(normalizedTask);
    const legacyStatus = currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as TaskStatus) : "open";
    return withDerivedTaskState({
      ...normalizedTask,
      status: normalizeTaskLifecycleStatus(
        currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as string) : String(legacyTask.status ?? ""),
        fallbackAction,
        normalizedTask.hasPendingCheckpoint
      ),
      executionStatus: normalizeTaskExecutionStatus(legacyTask.executionStatus, { ...normalizedTask, status: legacyStatus }),
      executionAction: normalizeTaskExecutionAction(legacyTask.executionAction, { ...normalizedTask, status: legacyStatus })
    });
  }

  private taskKey(taskId: string): string {
    return `${TASK_KEY_PREFIX}${taskId}`;
  }

  private taskLogKey(taskId: string): string {
    return `${TASK_LOG_KEY_PREFIX}${taskId}`;
  }

  private taskMessageKey(taskId: string): string {
    return `${TASK_MESSAGE_KEY_PREFIX}${taskId}`;
  }

  private async rewriteTaskMessages(taskId: string, messages: TaskMessage[]): Promise<void> {
    const pipeline = this.redis.multi().del(this.taskMessageKey(taskId));
    if (messages.length > 0) {
      pipeline.rpush(this.taskMessageKey(taskId), ...messages.map((message) => JSON.stringify(message)));
      pipeline.ltrim(this.taskMessageKey(taskId), -MAX_MESSAGES, -1);
    }
    await pipeline.exec();
  }

  private taskRunKey(runId: string): string {
    return `${TASK_RUN_KEY_PREFIX}${runId}`;
  }

  private taskRunLogKey(runId: string): string {
    return `${TASK_RUN_LOG_KEY_PREFIX}${runId}`;
  }

  private taskRunIdsKey(taskId: string): string {
    return `${TASK_RUN_IDS_KEY_PREFIX}${taskId}`;
  }

  private taskGitOperationKey(operationId: string): string {
    return `${TASK_GIT_OPERATION_KEY_PREFIX}${operationId}`;
  }

  private taskGitOperationIdsKey(taskId: string): string {
    return `${TASK_GIT_OPERATION_IDS_KEY_PREFIX}${taskId}`;
  }

  private taskChangeProposalKey(proposalId: string): string {
    return `${TASK_CHANGE_PROPOSAL_KEY_PREFIX}${proposalId}`;
  }

  private taskChangeProposalIdsKey(taskId: string): string {
    return `${TASK_CHANGE_PROPOSAL_IDS_KEY_PREFIX}${taskId}`;
  }

  private taskPendingChangeProposalKey(taskId: string): string {
    return `${TASK_PENDING_CHANGE_PROPOSAL_KEY_PREFIX}${taskId}`;
  }

  private taskActiveInteractiveSessionKey(taskId: string): string {
    return `${TASK_ACTIVE_INTERACTIVE_SESSION_KEY_PREFIX}${taskId}`;
  }

  private taskInteractiveTerminalTranscriptKey(sessionId: string): string {
    return `${TASK_INTERACTIVE_TERMINAL_TRANSCRIPT_KEY_PREFIX}${sessionId}`;
  }

  private async getStoredTask(taskId: string): Promise<Task | null> {
    const raw = await this.redis.get(this.taskKey(taskId));
    if (!raw) {
      return null;
    }

    const task = this.normalizeTask(JSON.parse(raw) as Task);
    return { ...task, logs: [] };
  }

  private async hydrateTask(task: Task): Promise<Task> {
    const logs = await this.redis.lrange(this.taskLogKey(task.id), 0, -1);
    const hydratedTask = {
      ...task,
      logs
    };
    const [proposals, activeInteractiveSession] = await Promise.all([
      this.listChangeProposals(task.id),
      this.getActiveInteractiveSession(task.id)
    ]);
    const hasPendingCheckpoint = getUserVisiblePendingCheckpoint(
      hydratedTask,
      proposals.some((proposal) => proposal.status === "pending")
    );
    return {
      ...this.withPendingCheckpointState({
        ...hydratedTask,
        hasPendingCheckpoint
      }),
      activeInteractiveSession: hydratedTask.activeInteractiveSession === true || activeInteractiveSession !== null,
      activeTerminalSessionMode: activeInteractiveSession?.mode ?? hydratedTask.activeTerminalSessionMode ?? null
    };
  }

  private withPendingCheckpointState(task: Task): Task {
    const hasPendingCheckpoint = task.hasPendingCheckpoint ?? false;
    return withDerivedTaskState({
      ...task,
      hasPendingCheckpoint,
      activeInteractiveSession: task.activeInteractiveSession === true,
      activeTerminalSessionMode:
        task.activeInteractiveSession === true
          ? task.activeTerminalSessionMode === "git"
            ? "git"
            : "interactive"
          : null
    });
  }

  private async publishTaskEvent(type: "task:created" | "task:updated", task: Task): Promise<Task> {
    const payload = this.withPendingCheckpointState(task);
    await this.eventBus.publish({ type, payload });
    return payload;
  }

  private normalizeRun(run: TaskRun): TaskRun {
    return {
      ...run,
      changeOutcome: run.changeOutcome === "changed" || run.changeOutcome === "no_change" ? run.changeOutcome : null,
      changeProposalCheckpointRef: run.changeProposalCheckpointRef ?? null,
      changeProposalUntrackedPaths: Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : null,
      hasRawJson: run.hasRawJson === true,
      timelineEvents: Array.isArray(run.timelineEvents) ? run.timelineEvents : []
    };
  }

  private normalizeGitOperation(operation: TaskGitOperation): TaskGitOperation {
    return {
      ...operation,
      finishedAt: operation.finishedAt ?? null,
      errorCode: operation.errorCode ?? null,
      errorMessage: operation.errorMessage ?? null,
      attemptCount: Math.max(1, Number.isFinite(operation.attemptCount) ? Math.floor(operation.attemptCount) : 1)
    };
  }

  private async getStoredRun(runId: string): Promise<TaskRun | null> {
    const raw = await this.redis.get(this.taskRunKey(runId));
    if (!raw) {
      return null;
    }

    return { ...this.normalizeRun(JSON.parse(raw) as TaskRun), logs: [] };
  }

  private async hydrateRun(run: TaskRun): Promise<TaskRun> {
    const logs = await this.redis.lrange(this.taskRunLogKey(run.id), 0, -1);
    return {
      ...run,
      logs
    };
  }

  private async getStoredGitOperation(operationId: string): Promise<TaskGitOperation | null> {
    const raw = await this.redis.get(this.taskGitOperationKey(operationId));
    if (!raw) {
      return null;
    }
    return this.normalizeGitOperation(JSON.parse(raw) as TaskGitOperation);
  }

  async createTask(input: CreateTaskInput, repository: Repository, ownerUserId: string): Promise<Task> {
    const timestamp = nowIso();
    const title = resolveTaskTitleForCreate(input);
    const taskType = input.taskType ?? "build";
    const promptRaw = (input.prompt ?? "").trim();
    const prompt = promptRaw.length > 0 ? promptRaw : "(No prompt provided.)";
    const notes = (input.notes ?? "").trim();
    const deadline = normalizeDeadline(input.deadline);
    const complexity = classifyTaskComplexity(title, prompt);
    const baseBranch = input.baseBranch?.trim() || repository.defaultBranch;
    const branchStrategy = input.branchStrategy ?? "feature_branch";
    const provider = normalizeProvider(input.provider);
    const providerProfile = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
    const modelOverride = normalizeModelOverride(input.modelOverride, input.model);
    const codexCredentialSource = normalizeCodexCredentialSource(input.codexCredentialSource);
    const autoApplyCheckpoints = input.autoApplyCheckpoints === true;
    const taskSource = "blank";
    const isDraft = input.draft === true;
    const initialAction: TaskAction = taskType === "ask" ? "ask" : "build";
    const initialStatus: TaskStatus = isDraft ? "draft" : "open";
    const task: Task = {
      id: nanoid(),
      title,
      deadline,
      pinned: false,
      hasPendingCheckpoint: false,
      autoApplyCheckpoints,
      activeInteractiveSession: false,
      activeTerminalSessionMode: null,
      ownerUserId,
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.url,
      repoDefaultBranch: repository.defaultBranch,
      taskType,
      provider,
      providerProfile,
      modelOverride,
      codexCredentialSource,
      taskSource,
      baseBranch,
      branchStrategy,
      complexity,
      branchName: branchStrategy === "work_on_branch" ? baseBranch : null,
      workspaceBaseRef: null,
      prompt,
      notes,
      resultMarkdown: null,
      executionSummary: buildExecutionSummaryFromPrompt(title, prompt),
      branchDiff: null,
      lastAction: initialAction,
      status: initialStatus,
      workflowStatus: isDraft ? "backlog" : "ready",
      executionStatus: isDraft ? "idle" : "queued",
      executionAction: isDraft ? null : initialAction,
      reviewReason: null,
      logs: [],
      enqueued: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      errorMessage: null
    };

    await this.redis.multi().set(this.taskKey(task.id), JSON.stringify(task)).sadd(TASK_IDS_KEY, task.id).exec();
    await this.publishTaskEvent("task:created", task);
    if (!isDraft) {
      await this.appendMessage(task.id, {
        role: "user",
        action: initialAction,
        content: prompt.trim().length > 0 ? prompt : "(No prompt provided.)"
      });
    }

    return this.withPendingCheckpointState(task);
  }

  async getTask(taskId: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    return this.hydrateTask(task);
  }

  async getTaskMetadata(taskId: string): Promise<TaskMetadata | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    return {
      id: task.id,
      ownerUserId: task.ownerUserId,
      status: task.status,
      executionStatus: task.executionStatus,
      executionAction: task.executionAction,
      hasPendingCheckpoint: task.hasPendingCheckpoint,
      autoApplyCheckpoints: task.autoApplyCheckpoints,
      activeInteractiveSession: task.activeInteractiveSession,
      activeTerminalSessionMode: task.activeTerminalSessionMode,
      provider: task.provider,
      providerProfile: task.providerProfile,
      modelOverride: task.modelOverride,
      codexCredentialSource: task.codexCredentialSource
    };
  }

  async listTasks(options: ListTasksOptions = {}): Promise<Task[]> {
    const ids = await this.redis.smembers(TASK_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.taskKey(id));
    }

    const result = await pipeline.exec();
    const tasks: Task[] = [];
    const view = options.view ?? "all";
    const ownerUserId = options.ownerUserId?.trim() || null;

    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        const task = this.withPendingCheckpointState({
          ...this.normalizeTask(JSON.parse(raw) as Task),
          logs: []
        });
        if (ownerUserId && task.ownerUserId !== ownerUserId) {
          continue;
        }
        if (view === "active" && task.status === "archived") {
          continue;
        }
        if (view === "archived" && task.status !== "archived") {
          continue;
        }
        tasks.push(task);
      }
    }

    const sortedTasks = tasks.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    if (options.limit != null && Number.isFinite(options.limit)) {
      return sortedTasks.slice(0, Math.max(0, options.limit));
    }

    return sortedTasks;
  }

  async patchTask(
    taskId: string,
    patch: Partial<Omit<Task, "id" | "createdAt">>
  ): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...patch,
      id: task.id,
      createdAt: task.createdAt,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async updateResultArtifacts(
    taskId: string,
    resultMarkdown: string
  ): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      resultMarkdown,
      updatedAt: nowIso(),
      logs: []
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async appendLog(taskId: string, line: string): Promise<void> {
    await this.appendLogForRun(taskId, line, null);
  }

  async appendLogForRun(taskId: string, line: string, runId: string | null): Promise<void> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return;
    }

    const timestamped = `[${new Date().toISOString()}] ${line}`;
    const pipeline = this.redis
      .multi()
      .rpush(this.taskLogKey(taskId), timestamped)
      .ltrim(this.taskLogKey(taskId), -MAX_LOG_LINES, -1);
    if (runId) {
      pipeline.rpush(this.taskRunLogKey(runId), timestamped).ltrim(this.taskRunLogKey(runId), -MAX_LOG_LINES, -1);
    }
    await pipeline.exec();
    await this.eventBus.publish({
      type: "task:log",
      payload: {
        taskId,
        runId,
        line: timestamped,
        timestamp: new Date().toISOString()
      }
    });
  }

  async listMessages(taskId: string): Promise<TaskMessage[]> {
    const page = await this.listMessagesPage(taskId);
    return page.items;
  }

  async listMessagesPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskMessage>> {
    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    const messages = rawMessages.flatMap((raw) => {
      try {
        const parsed = JSON.parse(raw) as TaskMessage;
        return normalizeTaskMessage(parsed);
      } catch {
        return [];
      }
    });
    return paginateByTimestamp(messages, options, (message) => message.createdAt);
  }

  async listRuns(taskId: string): Promise<TaskRun[]> {
    const page = await this.listRunsPage(taskId);
    return page.items;
  }

  async listRunsPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskRun>> {
    const runIds = await this.redis.lrange(this.taskRunIdsKey(taskId), 0, -1);
    if (runIds.length === 0) {
      return { items: [], hasMore: false };
    }

    const runs = await Promise.all(
      runIds.map(async (runId) => {
        const run = await this.getStoredRun(runId);
        return run ? this.hydrateRun(run) : null;
      })
    );

    const sortedRuns = runs.filter((run): run is TaskRun => !!run).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return paginateByTimestamp(sortedRuns, options, (run) => run.startedAt);
  }

  async getRun(runId: string): Promise<TaskRun | null> {
    const run = await this.getStoredRun(runId);
    if (!run) {
      return null;
    }

    return this.hydrateRun(run);
  }

  async createRun(
    taskId: string,
    input: {
      action: TaskAction;
      promptMessageId?: string | null;
      provider: AgentProvider;
      providerProfile: ProviderProfile;
      modelOverride: string | null;
      branchName: string | null;
    }
  ): Promise<TaskRun | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const run: TaskRun = {
      id: nanoid(),
      taskId,
      action: input.action,
      promptMessageId: input.promptMessageId ?? null,
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      branchName: input.branchName,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      summary: null,
      changeOutcome: null,
      errorMessage: null,
      changeProposalCheckpointRef: null,
      changeProposalUntrackedPaths: null,
      hasRawJson: false,
      timelineEvents: [],
      logs: []
    };

    await this.redis
      .multi()
      .set(this.taskRunKey(run.id), JSON.stringify(run))
      .rpush(this.taskRunIdsKey(taskId), run.id)
      .exec();
    await this.eventBus.publish({ type: "task:run_updated", payload: run });
    return run;
  }

  async updateRun(
    runId: string,
    patch: Partial<
      Pick<
        TaskRun,
        | "status"
        | "finishedAt"
        | "summary"
        | "changeOutcome"
        | "errorMessage"
        | "branchName"
        | "changeProposalCheckpointRef"
        | "changeProposalUntrackedPaths"
        | "hasRawJson"
        | "timelineEvents"
      >
    >
  ): Promise<TaskRun | null> {
    const run = await this.getStoredRun(runId);
    if (!run) {
      return null;
    }

    const next: TaskRun = {
      ...run,
      ...patch,
      logs: []
    };

    await this.redis.set(this.taskRunKey(runId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:run_updated", payload: next });
    return next;
  }

  async createGitOperation(input: CreateTaskGitOperationInput): Promise<TaskGitOperation | null> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return null;
    }

    const operation: TaskGitOperation = this.normalizeGitOperation({
      operationId: nanoid(),
      taskId: input.taskId,
      operationType: input.operationType,
      status: input.status ?? "queued",
      startedAt: nowIso(),
      finishedAt: null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      attemptCount: Math.max(1, input.attemptCount ?? 1)
    });

    await this.redis
      .multi()
      .set(this.taskGitOperationKey(operation.operationId), JSON.stringify(operation))
      .rpush(this.taskGitOperationIdsKey(input.taskId), operation.operationId)
      .exec();
    await this.eventBus.publish({ type: "task:git_operation", payload: operation });
    return operation;
  }

  async updateGitOperation(operationId: string, patch: UpdateTaskGitOperationPatch): Promise<TaskGitOperation | null> {
    const operation = await this.getStoredGitOperation(operationId);
    if (!operation) {
      return null;
    }

    const next: TaskGitOperation = this.normalizeGitOperation({
      ...operation,
      ...patch
    });

    await this.redis.set(this.taskGitOperationKey(operationId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:git_operation", payload: next });
    return next;
  }

  async getLatestGitOperation(taskId: string): Promise<TaskGitOperation | null> {
    const operationId = await this.redis.lindex(this.taskGitOperationIdsKey(taskId), -1);
    if (!operationId) {
      return null;
    }
    return this.getStoredGitOperation(operationId);
  }

  async appendMessage(taskId: string, input: AppendTaskMessageInput): Promise<TaskMessage | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const attachments = (input.attachments ?? [])
      .map((attachment) => normalizeTaskPromptAttachment(attachment))
      .filter((attachment): attachment is TaskPromptAttachment => attachment !== null);

    const message: TaskMessage = {
      id: nanoid(),
      taskId,
      role: input.role,
      content: input.content,
      action: input.action ?? null,
      ...(input.queueState !== undefined ? { queueState: input.queueState ?? null } : {}),
      ...(input.queueSource !== undefined ? { queueSource: input.queueSource ?? null } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId ?? null } : {}),
      createdAt: nowIso()
    };

    await this.redis
      .multi()
      .rpush(this.taskMessageKey(taskId), JSON.stringify(message))
      .ltrim(this.taskMessageKey(taskId), -MAX_MESSAGES, -1)
      .exec();
    await this.eventBus.publish({
      type: "task:message",
      payload: message
    });
    return message;
  }

  async listPendingActionMessages(taskId: string): Promise<TaskMessage[]> {
    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    return rawMessages
      .map((raw) => {
        try {
          return normalizeTaskMessage(JSON.parse(raw) as TaskMessage);
        } catch {
          return null;
        }
      })
      .filter((message): message is TaskMessage => message !== null)
      .filter((message) => message.role === "user" && (message.action === "ask" || message.action === "build") && message.queueState === "pending");
  }

  async getNextPendingActionMessage(taskId: string): Promise<TaskMessage | null> {
    const messages = await this.listPendingActionMessages(taskId);
    return messages[0] ?? null;
  }

  async hasPendingActionMessage(taskId: string): Promise<boolean> {
    return (await this.getNextPendingActionMessage(taskId)) !== null;
  }

  async consumePendingActionMessage(taskId: string, messageId: string): Promise<TaskMessage | null> {
    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    if (rawMessages.length === 0) {
      return null;
    }

    let updatedMessage: TaskMessage | null = null;
    const nextMessages = rawMessages.map((raw) => {
      try {
        const message = normalizeTaskMessage(JSON.parse(raw) as TaskMessage);
        if (message.id !== messageId) {
          return message;
        }
        if (message.queueState !== "pending" || message.role !== "user" || (message.action !== "ask" && message.action !== "build")) {
          return message;
        }
        updatedMessage = {
          ...message,
          queueState: null
        };
        return updatedMessage;
      } catch {
        return null;
      }
    });

    if (!updatedMessage) {
      return null;
    }

    await this.rewriteTaskMessages(taskId, nextMessages.filter((message): message is TaskMessage => message !== null));
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async deletePendingActionMessage(taskId: string, messageId: string): Promise<boolean> {
    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    if (rawMessages.length === 0) {
      return false;
    }

    let deleted = false;
    const nextMessages = rawMessages
      .map((raw) => {
        try {
          return normalizeTaskMessage(JSON.parse(raw) as TaskMessage);
        } catch {
          return null;
        }
      })
      .filter((message): message is TaskMessage => {
        if (message === null) {
          return false;
        }
        if (message.id !== messageId) {
          return true;
        }
        if (message.queueState !== "pending" || message.role !== "user" || (message.action !== "ask" && message.action !== "build")) {
          return true;
        }
        deleted = true;
        return false;
      });

    if (!deleted) {
      return false;
    }

    await this.rewriteTaskMessages(taskId, nextMessages);
    await this.eventBus.publish({
      type: "task:message_deleted",
      payload: {
        taskId,
        messageId
      }
    });
    return true;
  }

  async updateMessage(taskId: string, messageId: string, content: string): Promise<TaskMessage | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    if (rawMessages.length === 0) {
      return null;
    }

    let updatedMessage: TaskMessage | null = null;
    const nextRawMessages = rawMessages.map((raw) => {
      try {
        const message = normalizeTaskMessage(JSON.parse(raw) as TaskMessage);
        if (message.id !== messageId) {
          return raw;
        }

        updatedMessage = {
          ...message,
          content
        };
        return JSON.stringify(updatedMessage);
      } catch {
        return raw;
      }
    });

    if (!updatedMessage) {
      return null;
    }

    const pipeline = this.redis.multi().del(this.taskMessageKey(taskId));
    if (nextRawMessages.length > 0) {
      pipeline.rpush(this.taskMessageKey(taskId), ...nextRawMessages);
    }
    await pipeline.exec();
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async setMessageAttachments(taskId: string, messageId: string, attachmentsInput: TaskPromptAttachment[]): Promise<TaskMessage | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const attachments = attachmentsInput
      .map((attachment) => normalizeTaskPromptAttachment(attachment))
      .filter((attachment): attachment is TaskPromptAttachment => attachment !== null);

    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    if (rawMessages.length === 0) {
      return null;
    }

    let updatedMessage: TaskMessage | null = null;
    const nextRawMessages = rawMessages.map((raw) => {
      try {
        const message = normalizeTaskMessage(JSON.parse(raw) as TaskMessage);
        if (message.id !== messageId) {
          return raw;
        }

        const nextMessage: TaskMessage = { ...message };
        if (attachments.length > 0) {
          nextMessage.attachments = attachments;
        } else {
          delete (nextMessage as TaskMessage & { attachments?: TaskPromptAttachment[] }).attachments;
        }
        updatedMessage = nextMessage;
        return JSON.stringify(nextMessage);
      } catch {
        return raw;
      }
    });

    if (!updatedMessage) {
      return null;
    }

    const pipeline = this.redis.multi().del(this.taskMessageKey(taskId));
    if (nextRawMessages.length > 0) {
      pipeline.rpush(this.taskMessageKey(taskId), ...nextRawMessages);
    }
    await pipeline.exec();
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async markQueuedForAction(taskId: string, action: TaskAction): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      executionStatus: "queued",
      executionAction: action,
      enqueued: false,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      lastAction: action,
      branchDiff: action === "build" ? task.branchDiff : null,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async setExecutionState(
    taskId: string,
    executionStatus: TaskExecutionStatus,
    extra: Partial<Omit<Task, "id" | "createdAt" | "status">> = {}
  ): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...extra,
      status: task.status,
      executionStatus,
      executionAction: extra.executionAction ?? task.executionAction,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async setStatus(taskId: string, status: TaskStatus, extra: Partial<Task> = {}): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...extra,
      status,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async archiveTask(taskId: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      status: "archived",
      enqueued: false,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    return this.publishTaskEvent("task:updated", next);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return false;
    }
    const runIds = await this.redis.lrange(this.taskRunIdsKey(taskId), 0, -1);
    const gitOperationIds = await this.redis.lrange(this.taskGitOperationIdsKey(taskId), 0, -1);
    const proposalIds = await this.redis.lrange(this.taskChangeProposalIdsKey(taskId), 0, -1);
    const pipeline = this.redis
      .multi()
      .del(this.taskKey(taskId))
      .del(this.taskLogKey(taskId))
      .del(this.taskMessageKey(taskId))
      .del(this.taskRunIdsKey(taskId))
      .del(this.taskGitOperationIdsKey(taskId))
      .del(this.taskChangeProposalIdsKey(taskId))
      .del(this.taskPendingChangeProposalKey(taskId))
      .del(this.taskActiveInteractiveSessionKey(taskId))
      .srem(TASK_IDS_KEY, taskId);
    for (const runId of runIds) {
      pipeline.del(this.taskRunKey(runId)).del(this.taskRunLogKey(runId));
    }
    for (const operationId of gitOperationIds) {
      pipeline.del(this.taskGitOperationKey(operationId));
    }
    for (const proposalId of proposalIds) {
      pipeline.del(this.taskChangeProposalKey(proposalId));
    }
    await pipeline.exec();
    await this.eventBus.publish({ type: "task:deleted", payload: { id: taskId, repoId: task.repoId, ownerUserId: task.ownerUserId } });
    return true;
  }

  async publishTaskPushedEvent(input: {
    taskId: string;
    branchName: string;
    commitMessage: string | null;
  }): Promise<void> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return;
    }

    await this.eventBus.publish({
      type: "task:pushed",
      payload: {
        taskId: task.id,
        repoId: task.repoId,
        branchName: input.branchName,
        commitMessage: input.commitMessage,
        triggeredAt: nowIso()
      }
    });
  }

  async publishTaskMergedEvent(input: {
    taskId: string;
    sourceBranch: string;
    targetBranch: string;
    commitMessage: string | null;
  }): Promise<void> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return;
    }

    await this.eventBus.publish({
      type: "task:merged",
      payload: {
        taskId: task.id,
        repoId: task.repoId,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        commitMessage: input.commitMessage,
        triggeredAt: nowIso()
      }
    });
  }

  async hasPendingChangeProposal(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    return task?.hasPendingCheckpoint ?? false;
  }

  private normalizeStoredProposal(parsed: TaskChangeProposal): TaskChangeProposal {
    const rawStatus = parsed.status as string;
    const status: TaskChangeProposalStatus =
      rawStatus === "accepted"
        ? "applied"
        : rawStatus === "pending" || rawStatus === "applied" || rawStatus === "rejected" || rawStatus === "reverted"
          ? rawStatus
          : "pending";

    return {
      ...parsed,
      status,
      untrackedPathsAtCheckpoint: Array.isArray(parsed.untrackedPathsAtCheckpoint) ? parsed.untrackedPathsAtCheckpoint : [],
      resolvedAt: parsed.resolvedAt ?? null,
      revertedAt: parsed.revertedAt ?? null
    };
  }

  async getActiveInteractiveSession(
    taskId: string
  ): Promise<{ sessionId: string; checkpointRef: string; startedAt: string; untrackedPathsAtCheckpoint: string[]; mode: TaskTerminalSessionMode } | null> {
    const raw = await this.redis.get(this.taskActiveInteractiveSessionKey(taskId));
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as {
        sessionId?: string;
        checkpointRef?: string;
        startedAt?: string;
        untrackedPathsAtCheckpoint?: string[];
        mode?: TaskTerminalSessionMode;
      };
      if (typeof parsed.sessionId === "string" && typeof parsed.checkpointRef === "string" && typeof parsed.startedAt === "string") {
        return {
          sessionId: parsed.sessionId,
          checkpointRef: parsed.checkpointRef,
          startedAt: parsed.startedAt,
          untrackedPathsAtCheckpoint: Array.isArray(parsed.untrackedPathsAtCheckpoint) ? parsed.untrackedPathsAtCheckpoint : [],
          mode: parsed.mode === "git" ? "git" : "interactive"
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async setActiveInteractiveSession(
    taskId: string,
    session: { sessionId: string; checkpointRef: string; startedAt: string; untrackedPathsAtCheckpoint: string[]; mode: TaskTerminalSessionMode }
  ): Promise<void> {
    const task = await this.getStoredTask(taskId);
    const nextTask = task
      ? { ...task, activeInteractiveSession: true, activeTerminalSessionMode: session.mode, logs: [] }
      : null;
    const pipeline = this.redis.multi().set(this.taskActiveInteractiveSessionKey(taskId), JSON.stringify(session));
    if (nextTask) {
      pipeline.set(this.taskKey(taskId), JSON.stringify(nextTask));
    }
    await pipeline.exec();
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
  }

  async clearActiveInteractiveSession(taskId: string): Promise<void> {
    const task = await this.getStoredTask(taskId);
    const nextTask = task ? { ...task, activeInteractiveSession: false, activeTerminalSessionMode: null, logs: [] } : null;
    const pipeline = this.redis.multi().del(this.taskActiveInteractiveSessionKey(taskId));
    if (nextTask) {
      pipeline.set(this.taskKey(taskId), JSON.stringify(nextTask));
    }
    await pipeline.exec();
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
  }

  async saveInteractiveTerminalTranscript(
    taskId: string,
    sessionId: string,
    content: string,
    truncated: boolean
  ): Promise<void> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return;
    }

    const transcript: TaskInteractiveTerminalTranscript = {
      taskId,
      sessionId,
      content,
      truncated
    };
    await this.redis.set(this.taskInteractiveTerminalTranscriptKey(sessionId), JSON.stringify(transcript));
  }

  async getInteractiveTerminalTranscript(taskId: string, sessionId: string): Promise<TaskInteractiveTerminalTranscript | null> {
    const raw = await this.redis.get(this.taskInteractiveTerminalTranscriptKey(sessionId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as TaskInteractiveTerminalTranscript;
      if (
        parsed &&
        parsed.taskId === taskId &&
        parsed.sessionId === sessionId &&
        typeof parsed.content === "string" &&
        typeof parsed.truncated === "boolean"
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  async listChangeProposals(taskId: string): Promise<TaskChangeProposal[]> {
    const page = await this.listChangeProposalsPage(taskId);
    return page.items;
  }

  async listChangeProposalsPage(
    taskId: string,
    options?: ListTaskHistoryPageOptions
  ): Promise<ListTaskHistoryPageResult<TaskChangeProposal>> {
    const ids = await this.redis.lrange(this.taskChangeProposalIdsKey(taskId), 0, -1);
    if (ids.length === 0) {
      return { items: [], hasMore: false };
    }
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.taskChangeProposalKey(id));
    }
    const proposals: TaskChangeProposal[] = [];
    const result = await pipeline.exec();
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw !== "string") {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as TaskChangeProposal;
        proposals.push(this.normalizeStoredProposal(parsed));
      } catch {
        /* skip */
      }
    }
    const sortedProposals = proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return paginateByTimestamp(sortedProposals, options, (proposal) => proposal.createdAt);
  }

  async getChangeProposal(proposalId: string): Promise<TaskChangeProposal | null> {
    const raw = await this.redis.get(this.taskChangeProposalKey(proposalId));
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as TaskChangeProposal;
      return this.normalizeStoredProposal(parsed);
    } catch {
      return null;
    }
  }

  /** Among applied checkpoints, the one that was applied most recently (revert must unwind this one first). */
  async getLatestAppliedChangeProposalId(taskId: string): Promise<string | null> {
    const proposals = await this.listChangeProposals(taskId);
    const applied = proposals.filter((p) => p.status === "applied");
    if (applied.length === 0) {
      return null;
    }
    const rank = (p: TaskChangeProposal): string => `${p.resolvedAt ?? p.createdAt}\0${p.id}`;
    let best = applied[0]!;
    for (let i = 1; i < applied.length; i++) {
      const p = applied[i]!;
      if (rank(p) > rank(best)) {
        best = p;
      }
    }
    return best.id;
  }

  /**
   * Creates a pending checkpoint. Fails if the task already has another pending checkpoint.
   * Diff and metadata are persisted for later apply/reject/revert.
   */
  async createChangeProposal(input: Omit<TaskChangeProposal, "resolvedAt" | "revertedAt"> & { resolvedAt?: null; revertedAt?: null }): Promise<TaskChangeProposal | null> {
    const existingList = await this.listChangeProposals(input.taskId);
    if (existingList.some((p) => p.status === "pending")) {
      return null;
    }

    const proposal: TaskChangeProposal = {
      ...input,
      untrackedPathsAtCheckpoint: Array.isArray(input.untrackedPathsAtCheckpoint) ? input.untrackedPathsAtCheckpoint : [],
      resolvedAt: null,
      revertedAt: null
    };
    const task = await this.getStoredTask(input.taskId);
    const nextTask = task ? { ...task, hasPendingCheckpoint: task.autoApplyCheckpoints ? false : true, logs: [] } : null;
    const pipeline = this.redis
      .multi()
      .set(this.taskChangeProposalKey(proposal.id), JSON.stringify(proposal))
      .rpush(this.taskChangeProposalIdsKey(input.taskId), proposal.id);
    if (nextTask) {
      pipeline.set(this.taskKey(input.taskId), JSON.stringify(nextTask));
    }
    await pipeline.exec();

    await this.eventBus.publish({ type: "task:change_proposal", payload: proposal });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return proposal;
  }

  async updateChangeProposalStatus(
    proposalId: string,
    status: TaskChangeProposalStatus,
    taskId: string,
    updates?: UpdateTaskChangeProposalUpdates
  ): Promise<TaskChangeProposal | null> {
    const existing = await this.getChangeProposal(proposalId);
    if (!existing || existing.taskId !== taskId) {
      return null;
    }

    const next: TaskChangeProposal = {
      ...existing,
      ...updates,
      status,
      resolvedAt: status === "pending" ? null : nowIso(),
      /** Re-applying after revert clears this so the row is "applied" again. */
      revertedAt: status === "applied" ? null : (existing.revertedAt ?? null)
    };

    const task = await this.getStoredTask(taskId);
    const nextHasPendingCheckpoint = task
      ? getUserVisiblePendingCheckpoint(
          task,
          next.status === "pending" ? true : existing.status === "pending" ? false : false
        )
      : next.status === "pending";
    const nextTask = task ? { ...task, hasPendingCheckpoint: nextHasPendingCheckpoint, logs: [] } : null;
    const pipeline = this.redis.multi().set(this.taskChangeProposalKey(proposalId), JSON.stringify(next));
    if (nextTask) {
      pipeline.set(this.taskKey(taskId), JSON.stringify(nextTask));
    }
    await pipeline.exec();

    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return next;
  }

  async markCheckpointReverted(proposalId: string, taskId: string): Promise<TaskChangeProposal | null> {
    const existing = await this.getChangeProposal(proposalId);
    if (!existing || existing.taskId !== taskId || existing.status !== "applied") {
      return null;
    }

    const next: TaskChangeProposal = {
      ...existing,
      status: "reverted",
      revertedAt: nowIso()
    };

    const task = await this.getStoredTask(taskId);
    const nextTask = task ? { ...task, logs: [] } : null;
    const pipeline = this.redis.multi().set(this.taskChangeProposalKey(proposalId), JSON.stringify(next));
    if (nextTask) {
      pipeline.set(this.taskKey(taskId), JSON.stringify(nextTask));
    }
    await pipeline.exec();
    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return next;
  }
}

export class PostgresTaskStore implements TaskStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus
  ) {}

  private normalizeTask(task: Task): Task {
    const legacyTask = task as Task & {
      taskType?: string;
      deadline?: string | null;
      ownerUserId?: string | null;
      repoDefaultBranch?: string;
      resultMarkdown?: string | null;
      provider?: Task["provider"];
      providerProfile?: Task["providerProfile"];
      modelOverride?: string | null;
      codexCredentialSource?: Task["codexCredentialSource"];
      model?: string | null;
      reasoningEffort?: TaskReasoningEffort | null;
      lastAction?: string | null;
      executionStatus?: TaskExecutionStatus;
      executionAction?: TaskExecutionAction;
      requirements?: string;
      prompt?: string;
      notes?: string;
      taskSource?: Task["taskSource"];
      snippetId?: string;
    };
    const taskWithoutStartMode = { ...legacyTask } as typeof legacyTask & Record<string, unknown>;
    delete taskWithoutStartMode[LEGACY_START_MODE_FIELD];
    const taskSource = legacyTask.taskSource === "snippet" || legacyTask.taskSource === "blank" ? legacyTask.taskSource : "blank";
    const normalizedTask: Task = {
      ...taskWithoutStartMode,
      deadline: normalizeDeadline(legacyTask.deadline),
      pinned: legacyTask.pinned ?? false,
      hasPendingCheckpoint: legacyTask.hasPendingCheckpoint ?? false,
      autoApplyCheckpoints: legacyTask.autoApplyCheckpoints === true,
      activeInteractiveSession: legacyTask.activeInteractiveSession === true,
      activeTerminalSessionMode:
        legacyTask.activeTerminalSessionMode === "git" || legacyTask.activeTerminalSessionMode === "interactive"
          ? legacyTask.activeTerminalSessionMode
          : legacyTask.activeInteractiveSession === true
            ? "interactive"
            : null,
      ownerUserId: typeof legacyTask.ownerUserId === "string" && legacyTask.ownerUserId.trim().length > 0 ? legacyTask.ownerUserId : null,
      taskType: normalizeLegacyTaskType(legacyTask.taskType),
      provider: normalizeProvider(legacyTask.provider),
      providerProfile: normalizeProviderProfile(legacyTask.providerProfile, legacyTask.reasoningEffort),
      modelOverride: normalizeModelOverride(legacyTask.modelOverride, legacyTask.model),
      codexCredentialSource: normalizeCodexCredentialSource(legacyTask.codexCredentialSource),
      taskSource,
      snippetId:
        taskSource === "snippet" && typeof legacyTask.snippetId === "string" && legacyTask.snippetId.trim().length > 0
          ? legacyTask.snippetId.trim()
          : undefined,
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
      workspaceBaseRef: legacyTask.workspaceBaseRef ?? null,
      resultMarkdown: legacyTask.resultMarkdown ?? null,
      lastAction: normalizeLegacyTaskAction(legacyTask.lastAction),
      prompt: (legacyTask.prompt ?? legacyTask.requirements ?? "").trim(),
      notes: (legacyTask.notes ?? "").trim()
    };
    const fallbackAction = normalizedTask.lastAction ?? getInitialAction(normalizedTask);
    const legacyStatus = currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as TaskStatus) : "open";
    return withDerivedTaskState({
      ...normalizedTask,
      status: normalizeTaskLifecycleStatus(
        currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as string) : String(legacyTask.status ?? ""),
        fallbackAction,
        normalizedTask.hasPendingCheckpoint
      ),
      executionStatus: normalizeTaskExecutionStatus(legacyTask.executionStatus, { ...normalizedTask, status: legacyStatus }),
      executionAction: normalizeTaskExecutionAction(legacyTask.executionAction, { ...normalizedTask, status: legacyStatus })
    });
  }

  private withPendingCheckpointState(task: Task): Task {
    const hasPendingCheckpoint = task.hasPendingCheckpoint ?? false;
    return withDerivedTaskState({
      ...task,
      hasPendingCheckpoint,
      activeInteractiveSession: task.activeInteractiveSession === true,
      activeTerminalSessionMode:
        task.activeInteractiveSession === true
          ? task.activeTerminalSessionMode === "git"
            ? "git"
            : "interactive"
          : null
    });
  }

  private async publishTaskEvent(type: "task:created" | "task:updated", task: Task): Promise<Task> {
    const payload = this.withPendingCheckpointState(task);
    await this.eventBus.publish({ type, payload });
    return payload;
  }

  private normalizeRun(run: TaskRun): TaskRun {
    return {
      ...run,
      changeOutcome: run.changeOutcome === "changed" || run.changeOutcome === "no_change" ? run.changeOutcome : null,
      changeProposalCheckpointRef: run.changeProposalCheckpointRef ?? null,
      changeProposalUntrackedPaths: Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : null
    };
  }

  private normalizeGitOperation(operation: TaskGitOperation): TaskGitOperation {
    return {
      ...operation,
      finishedAt: operation.finishedAt ?? null,
      errorCode: operation.errorCode ?? null,
      errorMessage: operation.errorMessage ?? null,
      attemptCount: Math.max(1, Number.isFinite(operation.attemptCount) ? Math.floor(operation.attemptCount) : 1)
    };
  }

  private normalizeStoredProposal(parsed: TaskChangeProposal): TaskChangeProposal {
    const rawStatus = parsed.status as string;
    const status: TaskChangeProposalStatus =
      rawStatus === "accepted"
        ? "applied"
        : rawStatus === "pending" || rawStatus === "applied" || rawStatus === "rejected" || rawStatus === "reverted"
          ? rawStatus
          : "pending";

    return {
      ...parsed,
      status,
      untrackedPathsAtCheckpoint: Array.isArray(parsed.untrackedPathsAtCheckpoint) ? parsed.untrackedPathsAtCheckpoint : [],
      resolvedAt: parsed.resolvedAt ?? null,
      revertedAt: parsed.revertedAt ?? null
    };
  }

  private async storeTask(task: Task, db: PostgresQueryable = this.pool): Promise<void> {
    await db.query(
      `
        INSERT INTO tasks (id, owner_user_id, status, pinned, created_at, task_data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (id) DO UPDATE
        SET
          owner_user_id = EXCLUDED.owner_user_id,
          status = EXCLUDED.status,
          pinned = EXCLUDED.pinned,
          created_at = EXCLUDED.created_at,
          task_data = EXCLUDED.task_data
      `,
      [task.id, task.ownerUserId, task.status, task.pinned, task.createdAt, JSON.stringify({ ...task, logs: [] })]
    );
  }

  private mapTaskRow(row: Record<string, unknown>): Task {
    const task = this.normalizeTask(parseJsonColumn<Task>(row.task_data));
    return { ...task, logs: [] };
  }

  private async getStoredTask(taskId: string, db: PostgresQueryable = this.pool): Promise<Task | null> {
    const result = await db.query("SELECT task_data FROM tasks WHERE id = $1", [taskId]);
    const row = result.rows[0];
    return row ? this.mapTaskRow(row) : null;
  }

  private async loadTaskLogs(taskId: string, db: PostgresQueryable = this.pool): Promise<string[]> {
    const result = await db.query<{ line: string }>(
      "SELECT line FROM task_logs WHERE task_id = $1 ORDER BY log_id ASC",
      [taskId]
    );
    return result.rows.map((row) => row.line);
  }

  private async trimTaskLogs(taskId: string, db: PostgresQueryable = this.pool): Promise<void> {
    await db.query(
      `
        DELETE FROM task_logs
        WHERE log_id IN (
          SELECT log_id
          FROM task_logs
          WHERE task_id = $1
          ORDER BY log_id DESC
          OFFSET $2
        )
      `,
      [taskId, MAX_LOG_LINES]
    );
  }

  private async trimTaskLogsBestEffort(taskId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.trimTaskLogs(taskId);
        return;
      } catch (error) {
        if (!isRetryablePostgresError(error) || attempt === 2) {
          console.warn("Failed to trim task logs", {
            taskId,
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error)
          });
          return;
        }
        await sleep(20 * (attempt + 1));
      }
    }
  }

  private async hydrateTask(task: Task): Promise<Task> {
    const logs = await this.loadTaskLogs(task.id);
    const hydratedTask = {
      ...task,
      logs
    };
    const [proposals, activeInteractiveSession] = await Promise.all([
      this.listChangeProposals(task.id),
      this.getActiveInteractiveSession(task.id)
    ]);
    const hasPendingCheckpoint = getUserVisiblePendingCheckpoint(
      hydratedTask,
      proposals.some((proposal) => proposal.status === "pending")
    );
    return {
      ...this.withPendingCheckpointState({
        ...hydratedTask,
        hasPendingCheckpoint
      }),
      activeInteractiveSession: hydratedTask.activeInteractiveSession === true || activeInteractiveSession !== null,
      activeTerminalSessionMode: activeInteractiveSession?.mode ?? hydratedTask.activeTerminalSessionMode ?? null
    };
  }

  private mapRunRow(row: Record<string, unknown>): TaskRun {
    return { ...this.normalizeRun(parseJsonColumn<TaskRun>(row.run_data)), logs: [] };
  }

  private mapGitOperationRow(row: Record<string, unknown>): TaskGitOperation {
    return this.normalizeGitOperation(parseJsonColumn<TaskGitOperation>(row.operation_data));
  }

  private async getStoredRun(runId: string, db: PostgresQueryable = this.pool): Promise<TaskRun | null> {
    const result = await db.query("SELECT run_data FROM task_runs WHERE id = $1", [runId]);
    const row = result.rows[0];
    return row ? this.mapRunRow(row) : null;
  }

  private async getStoredGitOperation(operationId: string, db: PostgresQueryable = this.pool): Promise<TaskGitOperation | null> {
    const result = await db.query("SELECT operation_data FROM task_git_operations WHERE id = $1", [operationId]);
    const row = result.rows[0];
    return row ? this.mapGitOperationRow(row) : null;
  }

  private async loadRunLogs(runId: string, db: PostgresQueryable = this.pool): Promise<string[]> {
    const result = await db.query<{ line: string }>(
      "SELECT line FROM task_run_logs WHERE run_id = $1 ORDER BY log_id ASC",
      [runId]
    );
    return result.rows.map((row) => row.line);
  }

  private async trimRunLogs(runId: string, db: PostgresQueryable = this.pool): Promise<void> {
    await db.query(
      `
        DELETE FROM task_run_logs
        WHERE log_id IN (
          SELECT log_id
          FROM task_run_logs
          WHERE run_id = $1
          ORDER BY log_id DESC
          OFFSET $2
        )
      `,
      [runId, MAX_LOG_LINES]
    );
  }

  private async trimRunLogsBestEffort(runId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.trimRunLogs(runId);
        return;
      } catch (error) {
        if (!isRetryablePostgresError(error) || attempt === 2) {
          console.warn("Failed to trim run logs", {
            runId,
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error)
          });
          return;
        }
        await sleep(20 * (attempt + 1));
      }
    }
  }

  private async hydrateRun(run: TaskRun): Promise<TaskRun> {
    const logs = await this.loadRunLogs(run.id);
    return {
      ...run,
      logs
    };
  }

  private async trimMessages(taskId: string, db: PostgresQueryable = this.pool): Promise<void> {
    await db.query(
      `
        DELETE FROM task_messages
        WHERE position IN (
          SELECT position
          FROM task_messages
          WHERE task_id = $1
          ORDER BY position DESC
          OFFSET $2
        )
      `,
      [taskId, MAX_MESSAGES]
    );
  }

  async createTask(input: CreateTaskInput, repository: Repository, ownerUserId: string): Promise<Task> {
    const timestamp = nowIso();
    const title = resolveTaskTitleForCreate(input);
    const taskType = input.taskType ?? "build";
    const promptRaw = (input.prompt ?? "").trim();
    const prompt = promptRaw.length > 0 ? promptRaw : "(No prompt provided.)";
    const notes = (input.notes ?? "").trim();
    const deadline = normalizeDeadline(input.deadline);
    const complexity = classifyTaskComplexity(title, prompt);
    const baseBranch = input.baseBranch?.trim() || repository.defaultBranch;
    const branchStrategy = input.branchStrategy ?? "feature_branch";
    const provider = normalizeProvider(input.provider);
    const providerProfile = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
    const modelOverride = normalizeModelOverride(input.modelOverride, input.model);
    const codexCredentialSource = normalizeCodexCredentialSource(input.codexCredentialSource);
    const autoApplyCheckpoints = input.autoApplyCheckpoints === true;
    const taskSource = "blank";
    const isDraft = input.draft === true;
    const initialAction: TaskAction = taskType === "ask" ? "ask" : "build";
    const initialStatus: TaskStatus = isDraft ? "draft" : "open";
    const task: Task = {
      id: nanoid(),
      title,
      deadline,
      pinned: false,
      hasPendingCheckpoint: false,
      autoApplyCheckpoints,
      activeInteractiveSession: false,
      activeTerminalSessionMode: null,
      ownerUserId,
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.url,
      repoDefaultBranch: repository.defaultBranch,
      taskType,
      provider,
      providerProfile,
      modelOverride,
      codexCredentialSource,
      taskSource,
      baseBranch,
      branchStrategy,
      complexity,
      branchName: branchStrategy === "work_on_branch" ? baseBranch : null,
      workspaceBaseRef: null,
      prompt,
      notes,
      resultMarkdown: null,
      executionSummary: buildExecutionSummaryFromPrompt(title, prompt),
      branchDiff: null,
      lastAction: initialAction,
      status: initialStatus,
      workflowStatus: isDraft ? "backlog" : "ready",
      executionStatus: isDraft ? "idle" : "queued",
      executionAction: isDraft ? null : initialAction,
      reviewReason: null,
      logs: [],
      enqueued: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      errorMessage: null
    };

    await this.storeTask(task);
    await this.publishTaskEvent("task:created", task);
    if (!isDraft) {
      await this.appendMessage(task.id, {
        role: "user",
        action: initialAction,
        content: prompt.trim().length > 0 ? prompt : "(No prompt provided.)"
      });
    }

    return this.withPendingCheckpointState(task);
  }

  async getTask(taskId: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    return this.hydrateTask(task);
  }

  async getTaskMetadata(taskId: string): Promise<TaskMetadata | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    return {
      id: task.id,
      ownerUserId: task.ownerUserId,
      status: task.status,
      executionStatus: task.executionStatus,
      executionAction: task.executionAction,
      hasPendingCheckpoint: task.hasPendingCheckpoint,
      autoApplyCheckpoints: task.autoApplyCheckpoints,
      activeInteractiveSession: task.activeInteractiveSession,
      activeTerminalSessionMode: task.activeTerminalSessionMode,
      provider: task.provider,
      providerProfile: task.providerProfile,
      modelOverride: task.modelOverride,
      codexCredentialSource: task.codexCredentialSource
    };
  }

  async listTasks(options: ListTasksOptions = {}): Promise<Task[]> {
    const values: Array<string | number> = [];
    const clauses: string[] = [];
    const ownerUserId = options.ownerUserId?.trim() || null;
    const view = options.view ?? "all";

    if (ownerUserId) {
      values.push(ownerUserId);
      clauses.push(`owner_user_id = $${values.length}`);
    }
    if (view === "active") {
      values.push("archived");
      clauses.push(`status <> $${values.length}`);
    } else if (view === "archived") {
      values.push("archived");
      clauses.push(`status = $${values.length}`);
    }

    let sql = "SELECT task_data FROM tasks";
    if (clauses.length > 0) {
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }
    sql += " ORDER BY pinned DESC, created_at DESC";
    if (options.limit != null && Number.isFinite(options.limit)) {
      values.push(Math.max(0, options.limit));
      sql += ` LIMIT $${values.length}`;
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map((row) =>
      this.withPendingCheckpointState({
        ...this.mapTaskRow(row),
        logs: []
      })
    );
  }

  async patchTask(taskId: string, patch: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...patch,
      id: task.id,
      createdAt: task.createdAt,
      logs: [],
      updatedAt: nowIso()
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async updateResultArtifacts(taskId: string, resultMarkdown: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      resultMarkdown,
      updatedAt: nowIso(),
      logs: []
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async appendLog(taskId: string, line: string): Promise<void> {
    await this.appendLogForRun(taskId, line, null);
  }

  async appendLogForRun(taskId: string, line: string, runId: string | null): Promise<void> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return;
    }

    const timestamped = `[${new Date().toISOString()}] ${line}`;
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query("INSERT INTO task_logs (task_id, line) VALUES ($1, $2)", [taskId, timestamped]);
      if (runId) {
        const run = await this.getStoredRun(runId, client);
        if (run) {
          await client.query("INSERT INTO task_run_logs (run_id, line) VALUES ($1, $2)", [runId, timestamped]);
        }
      }
    });

    await this.trimTaskLogsBestEffort(taskId);
    if (runId) {
      await this.trimRunLogsBestEffort(runId);
    }

    try {
      await this.eventBus.publish({
        type: "task:log",
        payload: {
          taskId,
          runId,
          line: timestamped,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.warn("Failed to publish task log event", {
        taskId,
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async listMessages(taskId: string): Promise<TaskMessage[]> {
    const page = await this.listMessagesPage(taskId);
    return page.items;
  }

  async listMessagesPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskMessage>> {
    const limit = clampHistoryPageLimit(options?.limit);
    const values: unknown[] = [taskId];
    let whereSql = "WHERE task_id = $1";
    if (options?.before) {
      values.push(options.before);
      if (options.beforeId) {
        values.push(options.beforeId);
        whereSql += ` AND (created_at < $${values.length - 1} OR (created_at = $${values.length - 1} AND message_id < $${values.length}))`;
      } else {
        whereSql += ` AND created_at < $${values.length}`;
      }
    }
    values.push(limit + 1);
    const result = await this.pool.query(
      `SELECT message_data FROM task_messages ${whereSql} ORDER BY created_at DESC, message_id DESC LIMIT $${values.length}`,
      values
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const items = rows
      .flatMap((row) => {
        try {
          const parsed = parseJsonColumn<TaskMessage>(row.message_data);
          return normalizeTaskMessage(parsed);
        } catch {
          return [];
        }
      })
      .reverse();
    return { items, hasMore };
  }

  async listRuns(taskId: string): Promise<TaskRun[]> {
    const page = await this.listRunsPage(taskId);
    return page.items;
  }

  async listRunsPage(taskId: string, options?: ListTaskHistoryPageOptions): Promise<ListTaskHistoryPageResult<TaskRun>> {
    const limit = clampHistoryPageLimit(options?.limit);
    const values: unknown[] = [taskId];
    let whereSql = "WHERE task_id = $1";
    if (options?.before) {
      values.push(options.before);
      if (options.beforeId) {
        values.push(options.beforeId);
        whereSql += ` AND (started_at < $${values.length - 1} OR (started_at = $${values.length - 1} AND id < $${values.length}))`;
      } else {
        whereSql += ` AND started_at < $${values.length}`;
      }
    }
    values.push(limit + 1);
    const result = await this.pool.query(
      `SELECT run_data FROM task_runs ${whereSql} ORDER BY started_at DESC, id DESC LIMIT $${values.length}`,
      values
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const runs = await Promise.all(
      rows.map(async (row) => {
        const run = this.mapRunRow(row);
        return this.hydrateRun(run);
      })
    );
    return { items: runs.reverse(), hasMore };
  }

  async getRun(runId: string): Promise<TaskRun | null> {
    const run = await this.getStoredRun(runId);
    if (!run) {
      return null;
    }

    return this.hydrateRun(run);
  }

  async createRun(taskId: string, input: CreateTaskRunInput): Promise<TaskRun | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const run: TaskRun = {
      id: nanoid(),
      taskId,
      action: input.action,
      promptMessageId: input.promptMessageId ?? null,
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      branchName: input.branchName,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      summary: null,
      changeOutcome: null,
      errorMessage: null,
      changeProposalCheckpointRef: null,
      changeProposalUntrackedPaths: null,
      hasRawJson: false,
      timelineEvents: [],
      logs: []
    };

    await this.pool.query(
      "INSERT INTO task_runs (id, task_id, started_at, run_data) VALUES ($1, $2, $3, $4::jsonb)",
      [run.id, taskId, run.startedAt, JSON.stringify({ ...run, logs: [] })]
    );
    await this.eventBus.publish({ type: "task:run_updated", payload: run });
    return run;
  }

  async updateRun(runId: string, patch: UpdateTaskRunPatch): Promise<TaskRun | null> {
    const run = await this.getStoredRun(runId);
    if (!run) {
      return null;
    }

    const next: TaskRun = {
      ...run,
      ...patch,
      logs: []
    };

    await this.pool.query(
      "UPDATE task_runs SET started_at = $2, run_data = $3::jsonb WHERE id = $1",
      [runId, next.startedAt, JSON.stringify({ ...next, logs: [] })]
    );
    await this.eventBus.publish({ type: "task:run_updated", payload: next });
    return next;
  }

  async createGitOperation(input: CreateTaskGitOperationInput): Promise<TaskGitOperation | null> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return null;
    }

    const operation: TaskGitOperation = this.normalizeGitOperation({
      operationId: nanoid(),
      taskId: input.taskId,
      operationType: input.operationType,
      status: input.status ?? "queued",
      startedAt: nowIso(),
      finishedAt: null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      attemptCount: Math.max(1, input.attemptCount ?? 1)
    });

    await this.pool.query(
      "INSERT INTO task_git_operations (id, task_id, started_at, operation_data) VALUES ($1, $2, $3, $4::jsonb)",
      [operation.operationId, operation.taskId, operation.startedAt, JSON.stringify(operation)]
    );
    await this.eventBus.publish({ type: "task:git_operation", payload: operation });
    return operation;
  }

  async updateGitOperation(operationId: string, patch: UpdateTaskGitOperationPatch): Promise<TaskGitOperation | null> {
    const operation = await this.getStoredGitOperation(operationId);
    if (!operation) {
      return null;
    }

    const next: TaskGitOperation = this.normalizeGitOperation({
      ...operation,
      ...patch
    });

    await this.pool.query(
      "UPDATE task_git_operations SET started_at = $2, operation_data = $3::jsonb WHERE id = $1",
      [operationId, next.startedAt, JSON.stringify(next)]
    );
    await this.eventBus.publish({ type: "task:git_operation", payload: next });
    return next;
  }

  async getLatestGitOperation(taskId: string): Promise<TaskGitOperation | null> {
    const result = await this.pool.query(
      "SELECT operation_data FROM task_git_operations WHERE task_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1",
      [taskId]
    );
    const row = result.rows[0];
    return row ? this.mapGitOperationRow(row) : null;
  }

  async appendMessage(taskId: string, input: AppendTaskMessageInput): Promise<TaskMessage | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const attachments = (input.attachments ?? [])
      .map((attachment) => normalizeTaskPromptAttachment(attachment))
      .filter((attachment): attachment is TaskPromptAttachment => attachment !== null);

    const message: TaskMessage = {
      id: nanoid(),
      taskId,
      role: input.role,
      content: input.content,
      action: input.action ?? null,
      ...(input.queueState !== undefined ? { queueState: input.queueState ?? null } : {}),
      ...(input.queueSource !== undefined ? { queueSource: input.queueSource ?? null } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId ?? null } : {}),
      createdAt: nowIso()
    };

    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO task_messages (message_id, task_id, created_at, message_data)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        [message.id, taskId, message.createdAt, JSON.stringify(message)]
      );
      await this.trimMessages(taskId, client);
    });
    await this.eventBus.publish({
      type: "task:message",
      payload: message
    });
    return message;
  }

  async listPendingActionMessages(taskId: string): Promise<TaskMessage[]> {
    const result = await this.pool.query(
      `
        SELECT message_data
        FROM task_messages
        WHERE task_id = $1
        ORDER BY created_at ASC, message_id ASC
      `,
      [taskId]
    );
    return result.rows
      .map((row) => normalizeTaskMessage(parseJsonColumn<TaskMessage>(row.message_data)))
      .filter((message) => message.role === "user" && (message.action === "ask" || message.action === "build") && message.queueState === "pending");
  }

  async getNextPendingActionMessage(taskId: string): Promise<TaskMessage | null> {
    const messages = await this.listPendingActionMessages(taskId);
    return messages[0] ?? null;
  }

  async hasPendingActionMessage(taskId: string): Promise<boolean> {
    return (await this.getNextPendingActionMessage(taskId)) !== null;
  }

  async consumePendingActionMessage(taskId: string, messageId: string): Promise<TaskMessage | null> {
    const result = await this.pool.query(
      "SELECT message_data FROM task_messages WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const message = normalizeTaskMessage(parseJsonColumn<TaskMessage>(row.message_data));
    if (message.queueState !== "pending" || message.role !== "user" || (message.action !== "ask" && message.action !== "build")) {
      return null;
    }

    const updatedMessage: TaskMessage = {
      ...message,
      queueState: null
    };

    await this.pool.query(
      "UPDATE task_messages SET message_data = $3::jsonb WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId, JSON.stringify(updatedMessage)]
    );
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async deletePendingActionMessage(taskId: string, messageId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT message_data FROM task_messages WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId]
    );
    const row = result.rows[0];
    if (!row) {
      return false;
    }

    const message = normalizeTaskMessage(parseJsonColumn<TaskMessage>(row.message_data));
    if (message.queueState !== "pending" || message.role !== "user" || (message.action !== "ask" && message.action !== "build")) {
      return false;
    }

    await this.pool.query(
      "DELETE FROM task_messages WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId]
    );
    await this.eventBus.publish({
      type: "task:message_deleted",
      payload: {
        taskId,
        messageId
      }
    });
    return true;
  }

  async updateMessage(taskId: string, messageId: string, content: string): Promise<TaskMessage | null> {
    const result = await this.pool.query(
      "SELECT message_data FROM task_messages WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const message = normalizeTaskMessage(parseJsonColumn<TaskMessage>(row.message_data));
    const updatedMessage: TaskMessage = {
      ...message,
      content
    };

    await this.pool.query(
      "UPDATE task_messages SET message_data = $3::jsonb WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId, JSON.stringify(updatedMessage)]
    );
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async setMessageAttachments(taskId: string, messageId: string, attachmentsInput: TaskPromptAttachment[]): Promise<TaskMessage | null> {
    const result = await this.pool.query(
      "SELECT message_data FROM task_messages WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const message = normalizeTaskMessage(parseJsonColumn<TaskMessage>(row.message_data));
    const attachments = attachmentsInput
      .map((attachment) => normalizeTaskPromptAttachment(attachment))
      .filter((attachment): attachment is TaskPromptAttachment => attachment !== null);
    const updatedMessage: TaskMessage = {
      ...message,
      ...(attachments.length > 0 ? { attachments } : {})
    };
    if (attachments.length === 0) {
      delete (updatedMessage as TaskMessage & { attachments?: TaskPromptAttachment[] }).attachments;
    }

    await this.pool.query(
      "UPDATE task_messages SET message_data = $3::jsonb WHERE task_id = $1 AND message_id = $2",
      [taskId, messageId, JSON.stringify(updatedMessage)]
    );
    await this.eventBus.publish({
      type: "task:message_updated",
      payload: updatedMessage
    });
    return updatedMessage;
  }

  async markQueuedForAction(taskId: string, action: TaskAction): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      executionStatus: "queued",
      executionAction: action,
      enqueued: false,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      lastAction: action,
      branchDiff: action === "build" ? task.branchDiff : null,
      logs: [],
      updatedAt: nowIso()
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async setExecutionState(
    taskId: string,
    executionStatus: TaskExecutionStatus,
    extra: Partial<Omit<Task, "id" | "createdAt" | "status">> = {}
  ): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...extra,
      status: task.status,
      executionStatus,
      executionAction: extra.executionAction ?? task.executionAction,
      logs: [],
      updatedAt: nowIso()
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async setStatus(taskId: string, status: TaskStatus, extra: Partial<Task> = {}): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      ...extra,
      status,
      logs: [],
      updatedAt: nowIso()
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async archiveTask(taskId: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      status: "archived",
      enqueued: false,
      logs: [],
      updatedAt: nowIso()
    };

    await this.storeTask(next);
    return this.publishTaskEvent("task:updated", next);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return false;
    }

    await this.pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
    await this.eventBus.publish({ type: "task:deleted", payload: { id: taskId, repoId: task.repoId, ownerUserId: task.ownerUserId } });
    return true;
  }

  async publishTaskPushedEvent(input: TaskPushedEventInput): Promise<void> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return;
    }

    await this.eventBus.publish({
      type: "task:pushed",
      payload: {
        taskId: task.id,
        repoId: task.repoId,
        branchName: input.branchName,
        commitMessage: input.commitMessage,
        triggeredAt: nowIso()
      }
    });
  }

  async publishTaskMergedEvent(input: TaskMergedEventInput): Promise<void> {
    const task = await this.getStoredTask(input.taskId);
    if (!task) {
      return;
    }

    await this.eventBus.publish({
      type: "task:merged",
      payload: {
        taskId: task.id,
        repoId: task.repoId,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        commitMessage: input.commitMessage,
        triggeredAt: nowIso()
      }
    });
  }

  async hasPendingChangeProposal(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    return task?.hasPendingCheckpoint ?? false;
  }

  async getActiveInteractiveSession(taskId: string): Promise<TaskActiveInteractiveSession | null> {
    const result = await this.pool.query("SELECT session_data FROM task_active_interactive_sessions WHERE task_id = $1", [taskId]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    try {
      const parsed = parseJsonColumn<{
        sessionId?: string;
        checkpointRef?: string;
        startedAt?: string;
        untrackedPathsAtCheckpoint?: string[];
        mode?: TaskTerminalSessionMode;
      }>(row.session_data);
      if (typeof parsed.sessionId === "string" && typeof parsed.checkpointRef === "string" && typeof parsed.startedAt === "string") {
        return {
          sessionId: parsed.sessionId,
          checkpointRef: parsed.checkpointRef,
          startedAt: parsed.startedAt,
          untrackedPathsAtCheckpoint: Array.isArray(parsed.untrackedPathsAtCheckpoint) ? parsed.untrackedPathsAtCheckpoint : [],
          mode: parsed.mode === "git" ? "git" : "interactive"
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async setActiveInteractiveSession(taskId: string, session: TaskActiveInteractiveSession): Promise<void> {
    const task = await this.getStoredTask(taskId);
    const nextTask = task
      ? { ...task, activeInteractiveSession: true, activeTerminalSessionMode: session.mode, logs: [] }
      : null;

    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO task_active_interactive_sessions (task_id, session_data)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (task_id) DO UPDATE
          SET session_data = EXCLUDED.session_data
        `,
        [taskId, JSON.stringify(session)]
      );
      if (nextTask) {
        await this.storeTask(nextTask, client);
      }
    });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
  }

  async clearActiveInteractiveSession(taskId: string): Promise<void> {
    const task = await this.getStoredTask(taskId);
    const nextTask = task ? { ...task, activeInteractiveSession: false, activeTerminalSessionMode: null, logs: [] } : null;
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM task_active_interactive_sessions WHERE task_id = $1", [taskId]);
      if (nextTask) {
        await this.storeTask(nextTask, client);
      }
    });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
  }

  async saveInteractiveTerminalTranscript(taskId: string, sessionId: string, content: string, truncated: boolean): Promise<void> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return;
    }

    const transcript: TaskInteractiveTerminalTranscript = {
      taskId,
      sessionId,
      content,
      truncated
    };
    await this.pool.query(
      `
        INSERT INTO task_interactive_terminal_transcripts (session_id, task_id, transcript_data)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (session_id) DO UPDATE
        SET task_id = EXCLUDED.task_id, transcript_data = EXCLUDED.transcript_data
      `,
      [sessionId, taskId, JSON.stringify(transcript)]
    );
  }

  async getInteractiveTerminalTranscript(taskId: string, sessionId: string): Promise<TaskInteractiveTerminalTranscript | null> {
    const result = await this.pool.query(
      "SELECT transcript_data FROM task_interactive_terminal_transcripts WHERE session_id = $1 AND task_id = $2",
      [sessionId, taskId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    try {
      const parsed = parseJsonColumn<TaskInteractiveTerminalTranscript>(row.transcript_data);
      if (
        parsed &&
        parsed.taskId === taskId &&
        parsed.sessionId === sessionId &&
        typeof parsed.content === "string" &&
        typeof parsed.truncated === "boolean"
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  async listChangeProposals(taskId: string): Promise<TaskChangeProposal[]> {
    const page = await this.listChangeProposalsPage(taskId);
    return page.items;
  }

  async listChangeProposalsPage(
    taskId: string,
    options?: ListTaskHistoryPageOptions
  ): Promise<ListTaskHistoryPageResult<TaskChangeProposal>> {
    const limit = clampHistoryPageLimit(options?.limit);
    const values: unknown[] = [taskId];
    let whereSql = "WHERE task_id = $1";
    if (options?.before) {
      values.push(options.before);
      if (options.beforeId) {
        values.push(options.beforeId);
        whereSql += ` AND (created_at < $${values.length - 1} OR (created_at = $${values.length - 1} AND id < $${values.length}))`;
      } else {
        whereSql += ` AND created_at < $${values.length}`;
      }
    }
    values.push(limit + 1);
    const result = await this.pool.query(
      `SELECT proposal_data FROM task_change_proposals ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const proposals: TaskChangeProposal[] = [];
    for (const row of rows) {
      try {
        proposals.push(this.normalizeStoredProposal(parseJsonColumn<TaskChangeProposal>(row.proposal_data)));
      } catch {
        /* skip */
      }
    }
    return { items: proposals.reverse(), hasMore };
  }

  async getChangeProposal(proposalId: string): Promise<TaskChangeProposal | null> {
    const result = await this.pool.query("SELECT proposal_data FROM task_change_proposals WHERE id = $1", [proposalId]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    try {
      return this.normalizeStoredProposal(parseJsonColumn<TaskChangeProposal>(row.proposal_data));
    } catch {
      return null;
    }
  }

  async getLatestAppliedChangeProposalId(taskId: string): Promise<string | null> {
    const proposals = await this.listChangeProposals(taskId);
    const applied = proposals.filter((proposal) => proposal.status === "applied");
    if (applied.length === 0) {
      return null;
    }
    const rank = (proposal: TaskChangeProposal): string => `${proposal.resolvedAt ?? proposal.createdAt}\0${proposal.id}`;
    let best = applied[0]!;
    for (let index = 1; index < applied.length; index += 1) {
      const proposal = applied[index]!;
      if (rank(proposal) > rank(best)) {
        best = proposal;
      }
    }
    return best.id;
  }

  async createChangeProposal(input: CreateTaskChangeProposalInput): Promise<TaskChangeProposal | null> {
    const existingList = await this.listChangeProposals(input.taskId);
    if (existingList.some((proposal) => proposal.status === "pending")) {
      return null;
    }

    const proposal: TaskChangeProposal = {
      ...input,
      untrackedPathsAtCheckpoint: Array.isArray(input.untrackedPathsAtCheckpoint) ? input.untrackedPathsAtCheckpoint : [],
      resolvedAt: null,
      revertedAt: null
    };
    const task = await this.getStoredTask(input.taskId);
    const nextTask = task ? { ...task, hasPendingCheckpoint: task.autoApplyCheckpoints ? false : true, logs: [] } : null;

    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO task_change_proposals (id, task_id, status, created_at, resolved_at, proposal_data)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [proposal.id, proposal.taskId, proposal.status, proposal.createdAt, proposal.resolvedAt, JSON.stringify(proposal)]
      );
      if (nextTask) {
        await this.storeTask(nextTask, client);
      }
    });

    await this.eventBus.publish({ type: "task:change_proposal", payload: proposal });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return proposal;
  }

  async updateChangeProposalStatus(
    proposalId: string,
    status: TaskChangeProposalStatus,
    taskId: string,
    updates?: UpdateTaskChangeProposalUpdates
  ): Promise<TaskChangeProposal | null> {
    const existing = await this.getChangeProposal(proposalId);
    if (!existing || existing.taskId !== taskId) {
      return null;
    }

    const next: TaskChangeProposal = {
      ...existing,
      ...updates,
      status,
      resolvedAt: status === "pending" ? null : nowIso(),
      revertedAt: status === "applied" ? null : (existing.revertedAt ?? null)
    };

    const task = await this.getStoredTask(taskId);
    const nextHasPendingCheckpoint = task
      ? getUserVisiblePendingCheckpoint(
          task,
          next.status === "pending" ? true : existing.status === "pending" ? false : false
        )
      : next.status === "pending";
    const nextTask = task ? { ...task, hasPendingCheckpoint: nextHasPendingCheckpoint, logs: [] } : null;

    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `
          UPDATE task_change_proposals
          SET
            status = $2,
            resolved_at = $3,
            proposal_data = $4::jsonb
          WHERE id = $1
        `,
        [proposalId, next.status, next.resolvedAt, JSON.stringify(next)]
      );
      if (nextTask) {
        await this.storeTask(nextTask, client);
      }
    });

    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return next;
  }

  async markCheckpointReverted(proposalId: string, taskId: string): Promise<TaskChangeProposal | null> {
    const existing = await this.getChangeProposal(proposalId);
    if (!existing || existing.taskId !== taskId || existing.status !== "applied") {
      return null;
    }

    const next: TaskChangeProposal = {
      ...existing,
      status: "reverted",
      revertedAt: nowIso()
    };

    const task = await this.getStoredTask(taskId);
    const nextTask = task ? { ...task, logs: [] } : null;
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `
          UPDATE task_change_proposals
          SET
            status = $2,
            resolved_at = $3,
            proposal_data = $4::jsonb
          WHERE id = $1
        `,
        [proposalId, next.status, next.resolvedAt, JSON.stringify(next)]
      );
      if (nextTask) {
        await this.storeTask(nextTask, client);
      }
    });
    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    if (nextTask) {
      await this.publishTaskEvent("task:updated", nextTask);
    }
    return next;
  }
}
