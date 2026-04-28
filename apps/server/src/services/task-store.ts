import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import {
  type CodexCredentialSource,
  getQueuedStatusForAction,
  type AgentProvider,
  type CreateTaskInput,
  type ProviderProfile,
  type Repository,
  type Task,
  type TaskAction,
  type TaskMessage,
  type TaskPromptAttachment,
  type TaskReasoningEffort,
  type TaskRun,
  type TaskStartMode,
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
const TASK_CHANGE_PROPOSAL_KEY_PREFIX = "agentswarm:task_change_proposal:";
const TASK_CHANGE_PROPOSAL_IDS_KEY_PREFIX = "agentswarm:task_change_proposal_ids:";
const TASK_PENDING_CHANGE_PROPOSAL_KEY_PREFIX = "agentswarm:task_pending_change_proposal:";
const TASK_ACTIVE_INTERACTIVE_SESSION_KEY_PREFIX = "agentswarm:task_active_interactive_session:";
const TASK_INTERACTIVE_TERMINAL_TRANSCRIPT_KEY_PREFIX = "agentswarm:task_interactive_terminal_transcript:";
const TASK_IDS_KEY = "agentswarm:task_ids";
const MAX_LOG_LINES = 400;
const MAX_MESSAGES = 200;

const nowIso = (): string => new Date().toISOString();

const getInitialAction = (task: { taskType: Task["taskType"] }): TaskAction => (task.taskType === "ask" ? "ask" : "build");

const normalizeLegacyTaskType = (taskType: string | null | undefined): Task["taskType"] => (taskType === "ask" ? "ask" : "build");
const currentTaskStatuses = new Set<TaskStatus>([
  "build_queued",
  "preparing_workspace",
  "building",
  "ask_queued",
  "asking",
  "open",
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

  return {
    ...message,
    action: normalizeTaskMessageAction(message.action),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sessionId !== null || "sessionId" in message ? { sessionId } : {})
  };
};

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
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  branchName: string | null;
}

export type UpdateTaskRunPatch = Partial<
  Pick<
    TaskRun,
    "status" | "finishedAt" | "summary" | "errorMessage" | "branchName" | "changeProposalCheckpointRef" | "changeProposalUntrackedPaths"
  >
>;

export interface AppendTaskMessageInput {
  role: TaskMessage["role"];
  content: string;
  action?: TaskMessage["action"];
  attachments?: TaskPromptAttachment[];
  sessionId?: string | null;
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
  | "hasPendingCheckpoint"
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
  listRuns(taskId: string): Promise<TaskRun[]>;
  getRun(runId: string): Promise<TaskRun | null>;
  createRun(taskId: string, input: CreateTaskRunInput): Promise<TaskRun | null>;
  updateRun(runId: string, patch: UpdateTaskRunPatch): Promise<TaskRun | null>;
  appendMessage(taskId: string, input: AppendTaskMessageInput): Promise<TaskMessage | null>;
  updateMessage(taskId: string, messageId: string, content: string): Promise<TaskMessage | null>;
  setMessageAttachments(taskId: string, messageId: string, attachments: TaskPromptAttachment[]): Promise<TaskMessage | null>;
  markQueuedForAction(taskId: string, action: TaskAction): Promise<Task | null>;
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
      // Legacy field kept for migration of stored tasks created before the prompt refactor.
      requirements?: string;
      prompt?: string;
    };
    const normalizedTask: Task = {
      ...legacyTask,
      pinned: legacyTask.pinned ?? false,
      hasPendingCheckpoint: legacyTask.hasPendingCheckpoint ?? false,
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
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
      workspaceBaseRef: legacyTask.workspaceBaseRef ?? null,
      resultMarkdown: legacyTask.resultMarkdown ?? null,
      lastAction: normalizeLegacyTaskAction(legacyTask.lastAction),
      // Prefer the new prompt field; fall back to legacy requirements for older tasks.
      prompt: (legacyTask.prompt ?? legacyTask.requirements ?? "").trim()
    };
    const fallbackAction = normalizedTask.lastAction ?? getInitialAction(normalizedTask);
    return {
      ...normalizedTask,
      status: normalizeTaskLifecycleStatus(
        currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as string) : String(legacyTask.status ?? ""),
        fallbackAction,
        normalizedTask.hasPendingCheckpoint
      )
    };
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

  private taskRunKey(runId: string): string {
    return `${TASK_RUN_KEY_PREFIX}${runId}`;
  }

  private taskRunLogKey(runId: string): string {
    return `${TASK_RUN_LOG_KEY_PREFIX}${runId}`;
  }

  private taskRunIdsKey(taskId: string): string {
    return `${TASK_RUN_IDS_KEY_PREFIX}${taskId}`;
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
    const hasPendingCheckpoint = hydratedTask.hasPendingCheckpoint || proposals.some((proposal) => proposal.status === "pending");
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
    return {
      ...task,
      status: reconcileTaskStatusWithPendingCheckpoint(task.status, hasPendingCheckpoint),
      hasPendingCheckpoint,
      activeInteractiveSession: task.activeInteractiveSession === true,
      activeTerminalSessionMode:
        task.activeInteractiveSession === true
          ? task.activeTerminalSessionMode === "git"
            ? "git"
            : "interactive"
          : null
    };
  }

  private async publishTaskEvent(type: "task:created" | "task:updated", task: Task): Promise<Task> {
    const payload = this.withPendingCheckpointState(task);
    await this.eventBus.publish({ type, payload });
    return payload;
  }

  private normalizeRun(run: TaskRun): TaskRun {
    return {
      ...run,
      changeProposalCheckpointRef: run.changeProposalCheckpointRef ?? null,
      changeProposalUntrackedPaths: Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : null
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

  async createTask(input: CreateTaskInput, repository: Repository, ownerUserId: string): Promise<Task> {
    const timestamp = nowIso();
    const title = resolveTaskTitleForCreate(input);
    const taskType = input.taskType ?? "build";
    const promptRaw = (input.prompt ?? "").trim();
    const startMode: TaskStartMode = input.startMode ?? "run_now";
    const prompt =
      promptRaw.length > 0 ? promptRaw : startMode === "prepare_workspace" ? "" : "(No prompt provided.)";
    const complexity = classifyTaskComplexity(title, prompt);
    const baseBranch = input.baseBranch?.trim() || repository.defaultBranch;
    const branchStrategy = input.branchStrategy ?? "feature_branch";
    const provider = normalizeProvider(input.provider);
    const providerProfile = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
    const modelOverride = normalizeModelOverride(input.modelOverride, input.model);
    const codexCredentialSource = normalizeCodexCredentialSource(input.codexCredentialSource);
    const initialAction: TaskAction = taskType === "ask" ? "ask" : "build";
    const initialStatus: TaskStatus =
      startMode === "prepare_workspace" ? "preparing_workspace" : getQueuedStatusForAction(initialAction);
    const task: Task = {
      id: nanoid(),
      title,
      pinned: false,
      hasPendingCheckpoint: false,
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
      baseBranch,
      branchStrategy,
      complexity,
      branchName: branchStrategy === "work_on_branch" ? baseBranch : null,
      workspaceBaseRef: null,
      prompt,
      resultMarkdown: null,
      executionSummary: buildExecutionSummaryFromPrompt(title, prompt),
      branchDiff: null,
      lastAction: initialAction,
      status: initialStatus,
      logs: [],
      enqueued: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: startMode === "prepare_workspace" ? timestamp : null,
      finishedAt: null,
      errorMessage: null
    };

    await this.redis.multi().set(this.taskKey(task.id), JSON.stringify(task)).sadd(TASK_IDS_KEY, task.id).exec();
    await this.publishTaskEvent("task:created", task);
    if (startMode !== "prepare_workspace" || prompt.trim().length > 0) {
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
      hasPendingCheckpoint: task.hasPendingCheckpoint,
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
    const rawMessages = await this.redis.lrange(this.taskMessageKey(taskId), 0, -1);
    return rawMessages.flatMap((raw) => {
      try {
        const parsed = JSON.parse(raw) as TaskMessage;
        return normalizeTaskMessage(parsed);
      } catch {
        return [];
      }
    });
  }

  async listRuns(taskId: string): Promise<TaskRun[]> {
    const runIds = await this.redis.lrange(this.taskRunIdsKey(taskId), 0, -1);
    if (runIds.length === 0) {
      return [];
    }

    const runs = await Promise.all(
      runIds.map(async (runId) => {
        const run = await this.getStoredRun(runId);
        return run ? this.hydrateRun(run) : null;
      })
    );

    return runs.filter((run): run is TaskRun => !!run).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
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
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      branchName: input.branchName,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      summary: null,
      errorMessage: null,
      changeProposalCheckpointRef: null,
      changeProposalUntrackedPaths: null,
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
        | "errorMessage"
        | "branchName"
        | "changeProposalCheckpointRef"
        | "changeProposalUntrackedPaths"
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
      status: getQueuedStatusForAction(action),
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
    const proposalIds = await this.redis.lrange(this.taskChangeProposalIdsKey(taskId), 0, -1);
    const pipeline = this.redis
      .multi()
      .del(this.taskKey(taskId))
      .del(this.taskLogKey(taskId))
      .del(this.taskMessageKey(taskId))
      .del(this.taskRunIdsKey(taskId))
      .del(this.taskChangeProposalIdsKey(taskId))
      .del(this.taskPendingChangeProposalKey(taskId))
      .del(this.taskActiveInteractiveSessionKey(taskId))
      .srem(TASK_IDS_KEY, taskId);
    for (const runId of runIds) {
      pipeline.del(this.taskRunKey(runId)).del(this.taskRunLogKey(runId));
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
    const ids = await this.redis.lrange(this.taskChangeProposalIdsKey(taskId), 0, -1);
    if (ids.length === 0) {
      return [];
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
    return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    const nextTask = task ? { ...task, hasPendingCheckpoint: true, logs: [] } : null;
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
    const nextHasPendingCheckpoint = next.status === "pending" ? true : existing.status === "pending" ? false : (task?.hasPendingCheckpoint ?? false);
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
      requirements?: string;
      prompt?: string;
    };
    const normalizedTask: Task = {
      ...legacyTask,
      pinned: legacyTask.pinned ?? false,
      hasPendingCheckpoint: legacyTask.hasPendingCheckpoint ?? false,
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
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
      workspaceBaseRef: legacyTask.workspaceBaseRef ?? null,
      resultMarkdown: legacyTask.resultMarkdown ?? null,
      lastAction: normalizeLegacyTaskAction(legacyTask.lastAction),
      prompt: (legacyTask.prompt ?? legacyTask.requirements ?? "").trim()
    };
    const fallbackAction = normalizedTask.lastAction ?? getInitialAction(normalizedTask);
    return {
      ...normalizedTask,
      status: normalizeTaskLifecycleStatus(
        currentTaskStatuses.has(legacyTask.status as TaskStatus) ? (legacyTask.status as string) : String(legacyTask.status ?? ""),
        fallbackAction,
        normalizedTask.hasPendingCheckpoint
      )
    };
  }

  private withPendingCheckpointState(task: Task): Task {
    const hasPendingCheckpoint = task.hasPendingCheckpoint ?? false;
    return {
      ...task,
      status: reconcileTaskStatusWithPendingCheckpoint(task.status, hasPendingCheckpoint),
      hasPendingCheckpoint,
      activeInteractiveSession: task.activeInteractiveSession === true,
      activeTerminalSessionMode:
        task.activeInteractiveSession === true
          ? task.activeTerminalSessionMode === "git"
            ? "git"
            : "interactive"
          : null
    };
  }

  private async publishTaskEvent(type: "task:created" | "task:updated", task: Task): Promise<Task> {
    const payload = this.withPendingCheckpointState(task);
    await this.eventBus.publish({ type, payload });
    return payload;
  }

  private normalizeRun(run: TaskRun): TaskRun {
    return {
      ...run,
      changeProposalCheckpointRef: run.changeProposalCheckpointRef ?? null,
      changeProposalUntrackedPaths: Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : null
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
    const hasPendingCheckpoint = hydratedTask.hasPendingCheckpoint || proposals.some((proposal) => proposal.status === "pending");
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

  private async getStoredRun(runId: string, db: PostgresQueryable = this.pool): Promise<TaskRun | null> {
    const result = await db.query("SELECT run_data FROM task_runs WHERE id = $1", [runId]);
    const row = result.rows[0];
    return row ? this.mapRunRow(row) : null;
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
    const startMode: TaskStartMode = input.startMode ?? "run_now";
    const prompt =
      promptRaw.length > 0 ? promptRaw : startMode === "prepare_workspace" ? "" : "(No prompt provided.)";
    const complexity = classifyTaskComplexity(title, prompt);
    const baseBranch = input.baseBranch?.trim() || repository.defaultBranch;
    const branchStrategy = input.branchStrategy ?? "feature_branch";
    const provider = normalizeProvider(input.provider);
    const providerProfile = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
    const modelOverride = normalizeModelOverride(input.modelOverride, input.model);
    const codexCredentialSource = normalizeCodexCredentialSource(input.codexCredentialSource);
    const initialAction: TaskAction = taskType === "ask" ? "ask" : "build";
    const initialStatus: TaskStatus =
      startMode === "prepare_workspace" ? "preparing_workspace" : getQueuedStatusForAction(initialAction);
    const task: Task = {
      id: nanoid(),
      title,
      pinned: false,
      hasPendingCheckpoint: false,
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
      baseBranch,
      branchStrategy,
      complexity,
      branchName: branchStrategy === "work_on_branch" ? baseBranch : null,
      workspaceBaseRef: null,
      prompt,
      resultMarkdown: null,
      executionSummary: buildExecutionSummaryFromPrompt(title, prompt),
      branchDiff: null,
      lastAction: initialAction,
      status: initialStatus,
      logs: [],
      enqueued: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: startMode === "prepare_workspace" ? timestamp : null,
      finishedAt: null,
      errorMessage: null
    };

    await this.storeTask(task);
    await this.publishTaskEvent("task:created", task);
    if (startMode !== "prepare_workspace" || prompt.trim().length > 0) {
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
      hasPendingCheckpoint: task.hasPendingCheckpoint,
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
      await this.trimTaskLogs(taskId, client);
      if (runId) {
        const run = await this.getStoredRun(runId, client);
        if (run) {
          await client.query("INSERT INTO task_run_logs (run_id, line) VALUES ($1, $2)", [runId, timestamped]);
          await this.trimRunLogs(runId, client);
        }
      }
    });
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
    const result = await this.pool.query("SELECT message_data FROM task_messages WHERE task_id = $1 ORDER BY position ASC", [taskId]);
    return result.rows.flatMap((row) => {
      try {
        const parsed = parseJsonColumn<TaskMessage>(row.message_data);
        return normalizeTaskMessage(parsed);
      } catch {
        return [];
      }
    });
  }

  async listRuns(taskId: string): Promise<TaskRun[]> {
    const result = await this.pool.query("SELECT run_data FROM task_runs WHERE task_id = $1 ORDER BY started_at ASC, id ASC", [taskId]);
    const runs = await Promise.all(
      result.rows.map(async (row) => {
        const run = this.mapRunRow(row);
        return this.hydrateRun(run);
      })
    );
    return runs;
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
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      branchName: input.branchName,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      summary: null,
      errorMessage: null,
      changeProposalCheckpointRef: null,
      changeProposalUntrackedPaths: null,
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
      status: getQueuedStatusForAction(action),
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
    const result = await this.pool.query(
      "SELECT proposal_data FROM task_change_proposals WHERE task_id = $1 ORDER BY created_at ASC, id ASC",
      [taskId]
    );
    const proposals: TaskChangeProposal[] = [];
    for (const row of result.rows) {
      try {
        proposals.push(this.normalizeStoredProposal(parseJsonColumn<TaskChangeProposal>(row.proposal_data)));
      } catch {
        /* skip */
      }
    }
    return proposals;
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
    const nextTask = task ? { ...task, hasPendingCheckpoint: true, logs: [] } : null;

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
    const nextHasPendingCheckpoint =
      next.status === "pending" ? true : existing.status === "pending" ? false : (task?.hasPendingCheckpoint ?? false);
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
