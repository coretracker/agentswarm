import { nanoid } from "nanoid";
import type Redis from "ioredis";
import {
  getQueuedStatusForAction,
  getSuccessfulStatusForAction,
  isQueuedTaskStatus,
  type CreateTaskInput,
  type Repository,
  type Task,
  type TaskAction,
  type TaskQueueMode,
  type TaskReasoningEffort,
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
const TASK_IDS_KEY = "agentswarm:task_ids";
const TASK_QUEUE_KEY = "agentswarm:queue";
const MAX_LOG_LINES = 400;

const nowIso = (): string => new Date().toISOString();
type QueueReason = "manual" | "auto";

const getInitialAction = (task: { taskType: Task["taskType"]; planningMode: Task["planningMode"]; planMarkdown: string | null }): TaskAction => {
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
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
    };
    const status = legacyTask.status as string;
    const normalizedTask: Task = {
      ...legacyTask,
      queueMode: legacyTask.queueMode ?? legacyTask.mode ?? "manual",
      taskType: legacyTask.taskType ?? "plan",
      provider: normalizeProvider(legacyTask.provider),
      providerProfile: normalizeProviderProfile(legacyTask.providerProfile, legacyTask.reasoningEffort),
      modelOverride: normalizeModelOverride(legacyTask.modelOverride, legacyTask.model),
      repoDefaultBranch: legacyTask.repoDefaultBranch ?? legacyTask.baseBranch,
      branchStrategy: legacyTask.branchStrategy ?? "feature_branch",
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

  async createTask(input: CreateTaskInput, repository: Repository): Promise<Task> {
    const timestamp = nowIso();
    const taskType = input.taskType ?? "plan";
    const complexity = classifyTaskComplexity(input.title, input.requirements);
    const planningMode = taskType === "plan" && input.skipPlan ? "direct-build" : "plan-first";
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
          : planningMode === "direct-build"
            ? "build"
            : "plan";
    const task: Task = {
      id: nanoid(),
      title: input.title,
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
      branchName: branchStrategy === "work_on_branch" && taskType === "plan"
        ? baseBranch
        : null,
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

    return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return;
    }

    const timestamped = `[${new Date().toISOString()}] ${line}`;
    await this.redis
      .multi()
      .rpush(this.taskLogKey(taskId), timestamped)
      .ltrim(this.taskLogKey(taskId), -MAX_LOG_LINES, -1)
      .exec();
    await this.eventBus.publish({
      type: "task:log",
      payload: {
        taskId,
        line: timestamped,
        timestamp: new Date().toISOString()
      }
    });
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
      latestIterationInput: action === "iterate" ? iterateInput ?? "" : task.latestIterationInput,
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
      latestIterationInput: action === "iterate" ? iterateInput ?? "" : task.latestIterationInput,
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

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getStoredTask(taskId);
    if (!task) {
      return false;
    }

    await this.rewriteQueueWithoutTask(taskId);
    await this.redis
      .multi()
      .del(this.taskKey(taskId))
      .del(this.taskLogKey(taskId))
      .srem(TASK_IDS_KEY, taskId)
      .exec();
    await this.eventBus.publish({ type: "task:deleted", payload: { id: taskId } });
    return true;
  }
}
