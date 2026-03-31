import { nanoid } from "nanoid";
import type Redis from "ioredis";
import {
  getQueuedStatusForAction,
  getSuccessfulStatusForAction,
  isQueuedTaskStatus,
  type AgentProvider,
  type CreateTaskInput,
  type ProviderProfile,
  type Repository,
  type Task,
  type TaskAction,
  type TaskMessage,
  type TaskReasoningEffort,
  type TaskRun,
  type TaskStartMode,
  type TaskStatus,
  type TaskChangeProposal,
  type TaskChangeProposalStatus
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import {
  normalizeModelOverride,
  normalizeProvider,
  normalizeProviderProfile
} from "../lib/provider-config.js";
import { buildExecutionSummaryFromPrompt, classifyTaskComplexity } from "../lib/task-intelligence.js";

/** When creating with Interactive prep, make the task title identifiable without duplicating markers. */
function resolveTaskTitleForCreate(input: CreateTaskInput): string {
  const raw = (input.title ?? "").trim();
  const startMode = input.startMode ?? "run_now";
  if (startMode !== "prepare_workspace" || !raw) {
    return raw;
  }
  if (/\(interactive\)\s*$/i.test(raw)) {
    return raw;
  }
  if (/^interactive(\s|·)/i.test(raw)) {
    return raw;
  }
  return `${raw} (Interactive)`;
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
const TASK_IDS_KEY = "agentswarm:task_ids";
const TASK_QUEUE_KEY = "agentswarm:queue";
const MAX_LOG_LINES = 400;
const MAX_MESSAGES = 200;

const nowIso = (): string => new Date().toISOString();
type QueueReason = "manual" | "auto";

const getInitialAction = (task: { taskType: Task["taskType"] }): TaskAction => (task.taskType === "ask" ? "ask" : "build");

const normalizeLegacyTaskType = (taskType: string | null | undefined): Task["taskType"] => (taskType === "ask" ? "ask" : "build");
const currentTaskStatuses = new Set<TaskStatus>([
  "build_queued",
  "preparing_workspace",
  "building",
  "ask_queued",
  "asking",
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

const normalizeLegacyTaskStatus = (status: string, fallbackAction: TaskAction): TaskStatus => {
  if (currentTaskStatuses.has(status as TaskStatus)) {
    return status as TaskStatus;
  }

  if (status === "queued" || status.endsWith("_queued")) {
    return getQueuedStatusForAction(fallbackAction);
  }

  if (status === "spawning" || status === "running" || status.endsWith("ing")) {
    return fallbackAction === "ask" ? "asking" : "building";
  }

  if (status === "succeeded" || status.endsWith("ed")) {
    return getSuccessfulStatusForAction(fallbackAction);
  }

  if (!status.includes("_")) {
    return getSuccessfulStatusForAction(fallbackAction);
  }

  return "failed";
};

export interface QueueEntry {
  taskId: string;
  reason: QueueReason;
  action: TaskAction;
  input?: string;
}

export class TaskStore {
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
      ownerUserId: typeof legacyTask.ownerUserId === "string" && legacyTask.ownerUserId.trim().length > 0 ? legacyTask.ownerUserId : null,
      taskType: normalizeLegacyTaskType(legacyTask.taskType),
      provider: normalizeProvider(legacyTask.provider),
      providerProfile: normalizeProviderProfile(legacyTask.providerProfile, legacyTask.reasoningEffort),
      modelOverride: normalizeModelOverride(legacyTask.modelOverride, legacyTask.model),
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
      status: normalizeLegacyTaskStatus(legacyTask.status as string, fallbackAction)
    };
  }

  private async rewriteQueueWithoutTask(taskId: string): Promise<void> {
    const rawEntries = await this.redis.lrange(TASK_QUEUE_KEY, 0, -1);
    const filteredEntries = rawEntries.filter((raw) => {
      try {
        const entry = JSON.parse(raw) as QueueEntry;
        return entry.taskId !== taskId;
      } catch {
        return true;
      }
    });

    const pipeline = this.redis.multi().del(TASK_QUEUE_KEY);
    if (filteredEntries.length > 0) {
      pipeline.rpush(TASK_QUEUE_KEY, ...filteredEntries);
    }
    await pipeline.exec();
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
    return this.withPendingCheckpointState({
      ...task,
      logs
    });
  }

  private async withPendingCheckpointState(task: Task): Promise<Task> {
    const proposals = await this.listChangeProposals(task.id);
    return {
      ...task,
      hasPendingCheckpoint: proposals.some((proposal) => proposal.status === "pending")
    };
  }

  private async publishTaskEvent(type: "task:created" | "task:updated", task: Task): Promise<Task> {
    const payload = await this.withPendingCheckpointState(task);
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
    const initialAction: TaskAction = taskType === "ask" ? "ask" : "build";
    const initialStatus: TaskStatus =
      startMode === "prepare_workspace" ? "preparing_workspace" : getQueuedStatusForAction(initialAction);
    const task: Task = {
      id: nanoid(),
      title,
      pinned: false,
      hasPendingCheckpoint: false,
      ownerUserId,
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.url,
      repoDefaultBranch: repository.defaultBranch,
      taskType,
      provider,
      providerProfile,
      modelOverride,
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

  async listTasks(): Promise<Task[]> {
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

    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        const task = this.normalizeTask(JSON.parse(raw) as Task);
        tasks.push({ ...task, logs: [] });
      }
    }

    const hydratedTasks = await Promise.all(tasks.map((task) => this.withPendingCheckpointState(task)));

    return hydratedTasks.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
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
        return parsed;
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

  async appendMessage(
    taskId: string,
    input: {
      role: TaskMessage["role"];
      content: string;
      action?: TaskMessage["action"];
    }
  ): Promise<TaskMessage | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const message: TaskMessage = {
      id: nanoid(),
      taskId,
      role: input.role,
      content: input.content,
      action: input.action ?? null,
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
        const message = JSON.parse(raw) as TaskMessage;
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

  async markQueuedForAction(taskId: string, action: TaskAction): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    await this.rewriteQueueWithoutTask(taskId);

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

  async enqueueTask(taskId: string, reason: QueueReason, action: TaskAction, input?: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task || (isQueuedTaskStatus(task.status) && task.enqueued)) {
      return false;
    }

    const next: Task = {
      ...task,
      enqueued: true,
      lastAction: action,
      logs: [],
      updatedAt: nowIso()
    };

    const queueEntry: QueueEntry = { taskId, reason, action, input };

    await this.redis
      .multi()
      .set(this.taskKey(taskId), JSON.stringify(next))
      .rpush(TASK_QUEUE_KEY, JSON.stringify(queueEntry))
      .exec();

    await this.publishTaskEvent("task:updated", next);
    return true;
  }

  async dequeueTask(): Promise<QueueEntry | null> {
    const raw = await this.redis.lpop(TASK_QUEUE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as QueueEntry;
      if (
        typeof parsed.taskId === "string" &&
        (parsed.reason === "manual" || parsed.reason === "auto") &&
        (parsed.action === "build" || parsed.action === "ask")
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
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

    await this.rewriteQueueWithoutTask(taskId);

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

    await this.rewriteQueueWithoutTask(taskId);
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
    const proposals = await this.listChangeProposals(taskId);
    return proposals.some((p) => p.status === "pending");
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
  ): Promise<{ sessionId: string; checkpointRef: string; startedAt: string; untrackedPathsAtCheckpoint: string[] } | null> {
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
      };
      if (typeof parsed.sessionId === "string" && typeof parsed.checkpointRef === "string" && typeof parsed.startedAt === "string") {
        return {
          sessionId: parsed.sessionId,
          checkpointRef: parsed.checkpointRef,
          startedAt: parsed.startedAt,
          untrackedPathsAtCheckpoint: Array.isArray(parsed.untrackedPathsAtCheckpoint) ? parsed.untrackedPathsAtCheckpoint : []
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async setActiveInteractiveSession(
    taskId: string,
    session: { sessionId: string; checkpointRef: string; startedAt: string; untrackedPathsAtCheckpoint: string[] }
  ): Promise<void> {
    await this.redis.set(this.taskActiveInteractiveSessionKey(taskId), JSON.stringify(session));
  }

  async clearActiveInteractiveSession(taskId: string): Promise<void> {
    await this.redis.del(this.taskActiveInteractiveSessionKey(taskId));
  }

  async listChangeProposals(taskId: string): Promise<TaskChangeProposal[]> {
    const ids = await this.redis.lrange(this.taskChangeProposalIdsKey(taskId), 0, -1);
    if (ids.length === 0) {
      return [];
    }
    const proposals: TaskChangeProposal[] = [];
    for (const id of ids) {
      const raw = await this.redis.get(this.taskChangeProposalKey(id));
      if (!raw) {
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

    await this.redis
      .multi()
      .set(this.taskChangeProposalKey(proposal.id), JSON.stringify(proposal))
      .rpush(this.taskChangeProposalIdsKey(input.taskId), proposal.id)
      .exec();

    await this.eventBus.publish({ type: "task:change_proposal", payload: proposal });
    const task = await this.getStoredTask(input.taskId);
    if (task) {
      await this.publishTaskEvent("task:updated", task);
    }
    return proposal;
  }

  async updateChangeProposalStatus(
    proposalId: string,
    status: TaskChangeProposalStatus,
    taskId: string
  ): Promise<TaskChangeProposal | null> {
    const existing = await this.getChangeProposal(proposalId);
    if (!existing || existing.taskId !== taskId) {
      return null;
    }

    const next: TaskChangeProposal = {
      ...existing,
      status,
      resolvedAt: status === "pending" ? null : nowIso(),
      /** Re-applying after revert clears this so the row is "applied" again. */
      revertedAt: status === "applied" ? null : (existing.revertedAt ?? null)
    };

    await this.redis.set(this.taskChangeProposalKey(proposalId), JSON.stringify(next));

    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    const task = await this.getStoredTask(taskId);
    if (task) {
      await this.publishTaskEvent("task:updated", task);
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

    await this.redis.set(this.taskChangeProposalKey(proposalId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:change_proposal", payload: next });
    const task = await this.getStoredTask(taskId);
    if (task) {
      await this.publishTaskEvent("task:updated", task);
    }
    return next;
  }
}
