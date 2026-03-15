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
  type TaskQueueMode,
  type TaskReasoningEffort,
  type TaskRun,
  type TaskStatus
} from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import {
  normalizeModelOverride,
  normalizeProvider,
  normalizeProviderProfile
} from "../lib/provider-config.js";
import {
  buildExecutionSummaryFromPlan,
  buildExecutionSummaryFromRequirements,
  classifyTaskComplexity,
  extractReviewVerdict
} from "../lib/task-intelligence.js";

const TASK_KEY_PREFIX = "agentswarm:task:";
const TASK_LOG_KEY_PREFIX = "agentswarm:task_logs:";
const TASK_MESSAGE_KEY_PREFIX = "agentswarm:task_messages:";
const TASK_RUN_KEY_PREFIX = "agentswarm:task_run:";
const TASK_RUN_LOG_KEY_PREFIX = "agentswarm:task_run_logs:";
const TASK_RUN_IDS_KEY_PREFIX = "agentswarm:task_run_ids:";
const TASK_IDS_KEY = "agentswarm:task_ids";
const TASK_QUEUE_KEY = "agentswarm:queue";
const MAX_LOG_LINES = 400;
const MAX_MESSAGES = 200;

const nowIso = (): string => new Date().toISOString();
type QueueReason = "manual" | "auto";

const getInitialAction = (task: { taskType: Task["taskType"]; planningMode: Task["planningMode"]; planMarkdown: string | null }): TaskAction => {
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  if (task.taskType === "build") {
    return "build";
  }

  return task.planMarkdown || task.planningMode === "direct-build" ? "build" : "plan";
};

export interface QueueEntry {
  taskId: string;
  reason: QueueReason;
  action: TaskAction;
  iterateInput?: string;
}

export class TaskStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private normalizeTask(task: Task): Task {
    const legacyTask = task as Task & {
      mode?: TaskQueueMode;
      queueMode?: TaskQueueMode;
      taskType?: Task["taskType"];
      repoDefaultBranch?: string;
      resultMarkdown?: string | null;
      reviewVerdict?: Task["reviewVerdict"];
      provider?: Task["provider"];
      providerProfile?: Task["providerProfile"];
      modelOverride?: string | null;
      model?: string | null;
      reasoningEffort?: TaskReasoningEffort | null;
      builtPlanRunIds?: string[];
      currentPlanRunId?: string | null;
    };
    const status = legacyTask.status as string;
    const normalizedTask: Task = {
      ...legacyTask,
      pinned: legacyTask.pinned ?? false,
      queueMode: legacyTask.queueMode ?? legacyTask.mode ?? "manual",
      taskType: legacyTask.taskType ?? "plan",
      provider: normalizeProvider(legacyTask.provider),
      providerProfile: normalizeProviderProfile(legacyTask.providerProfile, legacyTask.reasoningEffort),
      modelOverride: normalizeModelOverride(legacyTask.modelOverride, legacyTask.model),
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
      currentPlanRunId: legacyTask.currentPlanRunId ?? null,
      builtPlanRunIds: Array.isArray(legacyTask.builtPlanRunIds) ? legacyTask.builtPlanRunIds : [],
      workspaceBaseRef: legacyTask.workspaceBaseRef ?? null,
      resultMarkdown: legacyTask.resultMarkdown ?? null,
      reviewVerdict: legacyTask.reviewVerdict ?? null
    };
    const fallbackAction = normalizedTask.lastAction ?? getInitialAction(normalizedTask);

    if (status === "queued") {
      return { ...normalizedTask, status: getQueuedStatusForAction(fallbackAction) };
    }

    if (status === "spawning" || status === "running") {
      return { ...normalizedTask, status: fallbackAction === "build" ? "building" : "planning" };
    }

    if (status === "succeeded") {
      return { ...normalizedTask, status: getSuccessfulStatusForAction(fallbackAction) };
    }

    if (
      status === "plan_queued" ||
      status === "planning" ||
      status === "planned" ||
      status === "build_queued" ||
      status === "building" ||
      status === "review_queued" ||
      status === "reviewing" ||
      status === "ask_queued" ||
      status === "asking" ||
      status === "review" ||
      status === "answered" ||
      status === "accepted" ||
      status === "archived" ||
      status === "cancelled" ||
      status === "failed"
    ) {
      return normalizedTask;
    }

    return { ...normalizedTask, status: "failed" };
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
    return {
      ...task,
      logs
    };
  }

  private normalizeRun(run: TaskRun): TaskRun {
    return {
      ...run,
      tokenUsage: run.tokenUsage ?? null
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

  async createTask(input: CreateTaskInput, repository: Repository): Promise<Task> {
    const timestamp = nowIso();
    const taskType = input.taskType ?? "plan";
    const complexity = classifyTaskComplexity(input.title, input.requirements);
    const planningMode = taskType === "build" ? "direct-build" : "plan-first";
    const queueMode = input.queueMode ?? input.mode ?? "manual";
    const baseBranch = input.baseBranch?.trim() || repository.defaultBranch;
    const branchStrategy = input.branchStrategy ?? "feature_branch";
    const provider = normalizeProvider(input.provider);
    const providerProfile = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
    const modelOverride = normalizeModelOverride(input.modelOverride, input.model);
    const initialAction: TaskAction =
      taskType === "review"
        ? "review"
        : taskType === "ask"
          ? "ask"
          : taskType === "build" || planningMode === "direct-build"
            ? "build"
            : "plan";
    const task: Task = {
      id: nanoid(),
      title: input.title,
      pinned: false,
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.url,
      repoPlansDir: repository.plansDir,
      repoDefaultBranch: repository.defaultBranch,
      taskType,
      provider,
      providerProfile,
      modelOverride,
      baseBranch,
      branchStrategy,
      complexity,
      planningMode,
      branchName: branchStrategy === "work_on_branch" && (taskType === "plan" || taskType === "build")
        ? baseBranch
        : null,
      currentPlanRunId: null,
      builtPlanRunIds: [],
      workspaceBaseRef: null,
      requirements: input.requirements,
      planPath: null,
      planMarkdown: null,
      resultMarkdown: null,
      reviewVerdict: null,
      executionSummary: buildExecutionSummaryFromRequirements(input.title, input.requirements),
      branchDiff: null,
      latestIterationInput: null,
      lastAction: initialAction,
      queueMode,
      status: getQueuedStatusForAction(initialAction),
      logs: [],
      enqueued: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      errorMessage: null
    };

    await this.redis.multi().set(this.taskKey(task.id), JSON.stringify(task)).sadd(TASK_IDS_KEY, task.id).exec();
    await this.eventBus.publish({ type: "task:created", payload: task });
    await this.appendMessage(task.id, {
      role: "user",
      action: initialAction,
      content: input.requirements
    });

    return task;
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

    return tasks.sort((a, b) => {
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
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
  }

  async updatePlanArtifacts(taskId: string, planPath: string, planMarkdown: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      planPath,
      planMarkdown,
      resultMarkdown: null,
      reviewVerdict: null,
      executionSummary: buildExecutionSummaryFromPlan(planMarkdown),
      branchDiff: null,
      updatedAt: nowIso(),
      logs: []
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
  }

  async saveManualPlanEdit(taskId: string, planPath: string, planMarkdown: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      planPath,
      planMarkdown,
      resultMarkdown: null,
      reviewVerdict: null,
      executionSummary: buildExecutionSummaryFromPlan(planMarkdown),
      branchDiff: null,
      workspaceBaseRef: null,
      status: "planned",
      lastAction: "plan",
      enqueued: false,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: nowIso(),
      logs: []
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
  }

  async updateResultArtifacts(
    taskId: string,
    resultMarkdown: string,
    reviewVerdict: Task["reviewVerdict"] | null = null
  ): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    const next: Task = {
      ...task,
      resultMarkdown,
      reviewVerdict: task.taskType === "review" ? reviewVerdict ?? extractReviewVerdict(resultMarkdown) : null,
      updatedAt: nowIso(),
      logs: []
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
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
      tokenUsage: null,
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
    patch: Partial<Pick<TaskRun, "status" | "finishedAt" | "summary" | "errorMessage" | "branchName" | "tokenUsage">>
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

  async addBuiltPlanRunId(taskId: string, runId: string): Promise<Task | null> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return null;
    }

    if (task.builtPlanRunIds.includes(runId)) {
      return this.hydrateTask(task);
    }

    const next: Task = {
      ...task,
      builtPlanRunIds: [...task.builtPlanRunIds, runId],
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return this.hydrateTask(next);
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

  async markQueuedForAction(taskId: string, action: TaskAction, iterateInput?: string): Promise<Task | null> {
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
      latestIterationInput: typeof iterateInput === "string" ? iterateInput : task.latestIterationInput,
      branchDiff:
        action === "build"
          ? task.branchDiff
          : action === "review"
            ? task.branchDiff
            : null,
      logs: [],
      updatedAt: nowIso()
    };

    await this.redis.set(this.taskKey(taskId), JSON.stringify(next));
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
  }

  async enqueueTask(taskId: string, reason: QueueReason, action: TaskAction, iterateInput?: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task || (isQueuedTaskStatus(task.status) && task.enqueued)) {
      return false;
    }

    const next: Task = {
      ...task,
      enqueued: true,
      lastAction: action,
      latestIterationInput: typeof iterateInput === "string" ? iterateInput : task.latestIterationInput,
      logs: [],
      updatedAt: nowIso()
    };

    const queueEntry: QueueEntry = { taskId, reason, action, iterateInput };

    await this.redis
      .multi()
      .set(this.taskKey(taskId), JSON.stringify(next))
      .rpush(TASK_QUEUE_KEY, JSON.stringify(queueEntry))
      .exec();

    await this.eventBus.publish({ type: "task:updated", payload: next });
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
        (parsed.action === "plan" ||
          parsed.action === "build" ||
          parsed.action === "iterate" ||
          parsed.action === "review" ||
          parsed.action === "ask")
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
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
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
    await this.eventBus.publish({ type: "task:updated", payload: next });
    return next;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return false;
    }

    await this.rewriteQueueWithoutTask(taskId);
    const runIds = await this.redis.lrange(this.taskRunIdsKey(taskId), 0, -1);
    const pipeline = this.redis
      .multi()
      .del(this.taskKey(taskId))
      .del(this.taskLogKey(taskId))
      .del(this.taskMessageKey(taskId))
      .del(this.taskRunIdsKey(taskId))
      .srem(TASK_IDS_KEY, taskId);
    for (const runId of runIds) {
      pipeline.del(this.taskRunKey(runId)).del(this.taskRunLogKey(runId));
    }
    await pipeline.exec();
    await this.eventBus.publish({ type: "task:deleted", payload: { id: taskId } });
    return true;
  }
}
