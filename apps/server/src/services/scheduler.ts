import {
  isActiveTaskStatus,
  isQueuedTaskStatus,
  type TaskAction,
  type TaskPlanningMode,
  type TaskType
} from "@agentswarm/shared-types";
import { TaskStore, type QueueEntry } from "./task-store.js";
import { SettingsStore } from "./settings-store.js";
import { CancelledTaskError, SpawnerService } from "./spawner.js";

const defaultActionForTask = (task: { taskType: TaskType; planMarkdown: string | null; planningMode: TaskPlanningMode }): TaskAction => {
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

export class SchedulerService {
  private activeTaskIds = new Set<string>();
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly settingsStore: SettingsStore,
    private readonly spawner: SpawnerService
  ) {}

  async bootstrap(): Promise<void> {
    await this.enqueueEligibleAutoTasks();
    this.interval = setInterval(() => {
      void this.drainQueue();
    }, 1000);
    await this.drainQueue();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async onTaskCreated(taskId: string): Promise<void> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return;
    }

    if (task.queueMode === "auto" && isQueuedTaskStatus(task.status)) {
      const action = defaultActionForTask(task);
      await this.taskStore.markQueuedForAction(task.id, action);
      await this.taskStore.enqueueTask(task.id, "auto", action);
      await this.drainQueue();
    }
  }

  async onSettingsChanged(): Promise<void> {
    await this.enqueueEligibleAutoTasks();
    await this.drainQueue();
  }

  async triggerAction(taskId: string, action: TaskAction, iterateInput?: string): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return false;
    }

    if (isActiveTaskStatus(task.status) || task.status === "accepted") {
      return false;
    }

    await this.taskStore.markQueuedForAction(taskId, action, iterateInput);
    await this.taskStore.enqueueTask(taskId, "manual", action, iterateInput);
    await this.drainQueue();

    return true;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return false;
    }

    if (!isQueuedTaskStatus(task.status) && !isActiveTaskStatus(task.status)) {
      return false;
    }

    const finishedAt = new Date().toISOString();

    await this.taskStore.setStatus(taskId, "cancelled", {
      finishedAt,
      enqueued: false,
      errorMessage: "Cancelled by user"
    });

    if (isQueuedTaskStatus(task.status)) {
      await this.taskStore.appendLog(taskId, "Scheduler: queued task cancelled by user.");
      await this.drainQueue();
      return true;
    }

    await this.taskStore.appendLog(taskId, "Scheduler: cancellation requested by user.");
    await this.spawner.cancelTask(taskId);
    return true;
  }

  private async enqueueEligibleAutoTasks(): Promise<void> {
    const tasks = await this.taskStore.listTasks();
    for (const task of tasks) {
      if (task.queueMode === "auto" && isQueuedTaskStatus(task.status) && !task.enqueued) {
        const action = defaultActionForTask(task);
        await this.taskStore.markQueuedForAction(task.id, action);
        await this.taskStore.enqueueTask(task.id, "auto", action);
      }
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;

    try {
      const settings = await this.settingsStore.getSettings();
      while (this.activeTaskIds.size < settings.maxAgents) {
        const queueEntry = await this.taskStore.dequeueTask();
        if (!queueEntry) {
          break;
        }

        const task = await this.taskStore.getTask(queueEntry.taskId);
        if (!task) {
          continue;
        }

        if (!isQueuedTaskStatus(task.status)) {
          continue;
        }

        await this.taskStore.patchTask(task.id, {
          enqueued: false,
          lastAction: queueEntry.action,
          latestIterationInput: typeof queueEntry.iterateInput === "string" ? queueEntry.iterateInput : task.latestIterationInput
        });
        this.activeTaskIds.add(task.id);

        void this.executeTask(queueEntry);
      }
    } finally {
      this.draining = false;
    }
  }

  private async executeTask(queueEntry: QueueEntry): Promise<void> {
    const taskId = queueEntry.taskId;
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        return;
      }

      await this.spawner.runTask(task, queueEntry.action, queueEntry.iterateInput);
      await this.maybeContinueAutoFlow(taskId, queueEntry.action);
    } catch (error) {
      const task = await this.taskStore.getTask(taskId);
      if (error instanceof CancelledTaskError || task?.status === "cancelled") {
        await this.taskStore.setStatus(taskId, "cancelled", {
          finishedAt: task?.finishedAt ?? new Date().toISOString(),
          errorMessage: "Cancelled by user",
          enqueued: false
        });
        await this.taskStore.appendLog(taskId, "Spawner: task cancelled by user.");
      } else {
        const finishedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "Unknown runtime error";
        await this.taskStore.setStatus(taskId, "failed", {
          finishedAt,
          errorMessage: message,
          enqueued: false
        });
        await this.taskStore.appendLog(taskId, `Spawner: task failed - ${message}`);
      }
    } finally {
      this.activeTaskIds.delete(taskId);
      await this.drainQueue();
    }
  }

  private async maybeContinueAutoFlow(taskId: string, action: TaskAction): Promise<void> {
    if (action !== "plan") {
      return;
    }

    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return;
    }

    if (task.taskType !== "plan" || task.queueMode !== "auto" || task.status !== "planned") {
      return;
    }

    await this.taskStore.appendLog(task.id, "Scheduler: auto queue mode enabled, continuing from plan into build.");
    await this.taskStore.markQueuedForAction(task.id, "build");
    await this.taskStore.enqueueTask(task.id, "auto", "build");
  }
}
