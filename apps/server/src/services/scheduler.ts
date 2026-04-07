import { isActiveTaskStatus, isQueuedTaskStatus, type TaskAction } from "@agentswarm/shared-types";
import { TaskStore, type QueueEntry } from "./task-store.js";
import { SettingsStore } from "./settings-store.js";
import { CancelledTaskError, SpawnerService } from "./spawner.js";

export class SchedulerService {
  private activeExecutionCount = 0;
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly settingsStore: SettingsStore,
    private readonly spawner: SpawnerService
  ) {}

  async bootstrap(): Promise<void> {
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
    // Queue mode has been removed; new tasks are enqueued explicitly via triggerAction.
    await this.drainQueue();
  }

  async onSettingsChanged(): Promise<void> {
    await this.drainQueue();
  }

  async hasExecutionCapacity(): Promise<boolean> {
    const settings = await this.settingsStore.getSettings();
    return this.activeExecutionCount < settings.maxAgents;
  }

  async triggerAction(taskId: string, action: TaskAction, input?: string): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return false;
    }

    const allowParallelAsk = action === "ask" && (task.status === "building" || task.status === "asking");
    if ((!allowParallelAsk && isActiveTaskStatus(task.status)) || task.status === "archived") {
      return false;
    }

    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      return false;
    }

    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      return false;
    }

    if (allowParallelAsk) {
      const settings = await this.settingsStore.getSettings();
      if (this.activeExecutionCount >= settings.maxAgents) {
        return false;
      }

      this.activeExecutionCount += 1;
      void this.executeTask({ taskId, reason: "manual", action, input }, false);
      return true;
    }

    await this.taskStore.markQueuedForAction(taskId, action);
    await this.taskStore.enqueueTask(taskId, "manual", action, input);
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

  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;

    try {
      const settings = await this.settingsStore.getSettings();
      while (this.activeExecutionCount < settings.maxAgents) {
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
          lastAction: queueEntry.action
        });
        this.activeExecutionCount += 1;

        void this.executeTask(queueEntry, true);
      }
    } finally {
      this.draining = false;
    }
  }

  private async executeTask(queueEntry: QueueEntry, requireQueuedStatus: boolean): Promise<void> {
    const taskId = queueEntry.taskId;
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        return;
      }

      if (requireQueuedStatus && !isQueuedTaskStatus(task.status)) {
        if (task.status === "archived") {
          await this.taskStore.appendLog(taskId, "Scheduler: archived task skipped before execution.");
        }
        return;
      }

      await this.spawner.runTask(task, queueEntry.action, queueEntry.input);
    } catch (error) {
      const task = await this.taskStore.getTask(taskId);
      if (error instanceof CancelledTaskError || task?.status === "cancelled") {
        await this.taskStore.appendLog(taskId, "Spawner: task cancelled by user.");
      } else {
        const message = error instanceof Error ? error.message : "Unknown runtime error";
        await this.taskStore.appendLog(taskId, `Spawner: task failed - ${message}`);
      }
    } finally {
      this.activeExecutionCount = Math.max(0, this.activeExecutionCount - 1);
      await this.drainQueue();
    }
  }
}
