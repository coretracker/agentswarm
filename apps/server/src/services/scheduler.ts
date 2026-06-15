import { type Task, type TaskAction, type TaskExecutionInput } from "@agentswarm/shared-types";
import type { TaskStore } from "./task-store.js";
import type { QueueEntry, QueueReason, TaskQueueStore } from "./task-queue-store.js";
import type { SettingsStore } from "./settings-store.js";
import { CancelledTaskError, SpawnerService } from "./spawner.js";

const normalizeExecutionInput = (input?: TaskExecutionInput | string): TaskExecutionInput | undefined =>
  typeof input === "string"
    ? {
        content: input
      }
    : input;

const isExecutionQueued = (task: Pick<Task, "executionStatus">): boolean => task.executionStatus === "queued";
const isExecutionActive = (task: Pick<Task, "executionStatus">): boolean =>
  task.executionStatus === "preparing" || task.executionStatus === "running";
const isExecutionBusy = (task: Pick<Task, "executionStatus">): boolean => isExecutionQueued(task) || isExecutionActive(task);

interface TriggerActionOptions {
  promptMessageId?: string | null;
  reason?: QueueReason;
}

export class SchedulerService {
  private activeExecutionCount = 0;
  private interval: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly taskQueueStore: TaskQueueStore,
    private readonly settingsStore: SettingsStore,
    private readonly spawner: SpawnerService
  ) {}

  async bootstrap(): Promise<void> {
    await this.recoverInterruptedExecutions();
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

  async triggerAction(
    taskId: string,
    action: TaskAction,
    input?: TaskExecutionInput | string,
    options: TriggerActionOptions = {}
  ): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return false;
    }

    if (isExecutionBusy(task) || task.status === "archived" || task.status === "draft") {
      return false;
    }

    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      return false;
    }

    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      return false;
    }

    await this.taskStore.markQueuedForAction(taskId, action);
    await this.taskQueueStore.replaceTask({
      taskId,
      promptMessageId: options.promptMessageId ?? null,
      reason: options.reason ?? "manual",
      action,
      input: normalizeExecutionInput(input)
    });
    await this.taskStore.patchTask(taskId, {
      enqueued: true
    });
    await this.drainQueue();

    return true;
  }

  async triggerNextPendingAction(taskId: string, reason: QueueReason = "auto"): Promise<boolean> {
    const message = await this.taskStore.getNextPendingActionMessage(taskId);
    if (!message || (message.action !== "ask" && message.action !== "build")) {
      return false;
    }

    return this.triggerAction(
      taskId,
      message.action,
      {
        content: message.content,
        attachments: message.attachments ?? []
      },
      {
        promptMessageId: message.id,
        reason
      }
    );
  }

  async unstickTaskQueue(taskId: string, reason: QueueReason = "manual"): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task || task.status === "archived" || task.status === "draft") {
      return false;
    }

    if (isExecutionActive(task)) {
      return false;
    }

    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      return false;
    }

    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      return false;
    }

    const runningRuns = (await this.taskStore.listRuns(taskId)).filter((run) => run.status === "running");
    if (runningRuns.length > 0) {
      return false;
    }

    if (!(await this.taskStore.hasPendingActionMessage(taskId))) {
      return false;
    }

    if (isExecutionQueued(task)) {
      await this.taskQueueStore.removeTask(taskId);
      await this.taskStore.setExecutionState(taskId, "idle", {
        enqueued: false,
        executionAction: null,
        errorMessage: null
      });
      await this.taskStore.appendLog(taskId, "Scheduler: reset stale queued state before resuming queued follow-up.");
    }

    return this.triggerNextPendingAction(taskId, reason);
  }

  async triggerPostflight(taskId: string): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task || task.taskType !== "build") {
      return false;
    }

    if (isExecutionBusy(task) || task.status === "archived" || task.status === "draft") {
      return false;
    }

    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      return false;
    }

    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      return false;
    }

    const settings = await this.settingsStore.getSettings();
    if (this.activeExecutionCount >= settings.maxAgents) {
      return false;
    }

    this.activeExecutionCount += 1;
    void this.executePostflight(taskId);
    return true;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return false;
    }

    if (!isExecutionBusy(task)) {
      return false;
    }

    const finishedAt = new Date().toISOString();

    await this.taskStore.setExecutionState(taskId, "cancelled", {
      finishedAt,
      enqueued: false,
      errorMessage: "Cancelled by user"
    });
    await this.taskQueueStore.removeTask(taskId);

    if (isExecutionQueued(task)) {
      await this.taskStore.appendLog(taskId, "Scheduler: queued task cancelled by user.");
      await this.drainQueue();
      return true;
    }

    await this.taskStore.appendLog(taskId, "Scheduler: cancellation requested by user.");
    await this.spawner.cancelTask(taskId);
    return true;
  }

  private async recoverInterruptedExecutions(): Promise<void> {
    const tasks = await this.taskStore.listTasks({ ownerUserId: null, view: "all" });
    const finishedAt = new Date().toISOString();
    const recoveryMessage = "Server restarted before the previous run completed.";

    for (const task of tasks) {
      const runs = await this.taskStore.listRuns(task.id);
      const staleRuns = runs.filter((run) => run.status === "running");
      const shouldRecoverTask = staleRuns.length > 0 || isExecutionActive(task);

      if (!shouldRecoverTask) {
        continue;
      }

      for (const run of staleRuns) {
        await this.taskStore.updateRun(run.id, {
          status: "failed",
          finishedAt,
          errorMessage: recoveryMessage,
          summary: null
        });
      }

      await this.taskStore.setExecutionState(task.id, "failed", {
        finishedAt,
        enqueued: false,
        errorMessage: recoveryMessage,
        lastAction: staleRuns.at(-1)?.action ?? task.lastAction
      });
      await this.taskStore.appendLog(task.id, `Scheduler: recovered interrupted task after restart. ${recoveryMessage}`);
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;

    try {
      const settings = await this.settingsStore.getSettings();
      while (this.activeExecutionCount < settings.maxAgents) {
        const queueEntry = await this.taskQueueStore.dequeueTask();
        if (!queueEntry) {
          break;
        }

        const task = await this.taskStore.getTask(queueEntry.taskId);
        if (!task) {
          continue;
        }

        if (!isExecutionQueued(task)) {
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
    let completedSuccessfully = false;
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        return;
      }

      if (requireQueuedStatus && !isExecutionQueued(task)) {
        if (task.status === "archived") {
          await this.taskStore.appendLog(taskId, "Scheduler: archived task skipped before execution.");
        }
        return;
      }

      if (queueEntry.promptMessageId) {
        const consumed = await this.taskStore.consumePendingActionMessage(taskId, queueEntry.promptMessageId);
        if (!consumed) {
          await this.taskStore.appendLog(taskId, `Scheduler: queued follow-up ${queueEntry.promptMessageId} was unavailable before execution.`);
          await this.taskStore.setExecutionState(taskId, "idle", {
            enqueued: false,
            executionAction: null,
            errorMessage: null
          });
          await this.triggerNextPendingAction(taskId, "auto").catch(() => false);
          return;
        }
      }

      await this.spawner.runTask(task, queueEntry.action, queueEntry.input, queueEntry.promptMessageId ?? null);
      completedSuccessfully = true;
    } catch (error) {
      const task = await this.taskStore.getTask(taskId);
      if (error instanceof CancelledTaskError || task?.executionStatus === "cancelled") {
        await this.taskStore.appendLog(taskId, "Spawner: task cancelled by user.");
      } else {
        const message = error instanceof Error ? error.message : "Unknown runtime error";
        await this.taskStore.appendLog(taskId, `Spawner: task failed - ${message}`);
      }
    } finally {
      this.activeExecutionCount = Math.max(0, this.activeExecutionCount - 1);
      if (completedSuccessfully) {
        await this.triggerNextPendingAction(taskId, "auto").catch(() => false);
      }
      await this.drainQueue();
    }
  }

  private async executePostflight(taskId: string): Promise<void> {
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task || task.status === "archived") {
        return;
      }

      await this.spawner.runTaskPostflight(task);
    } catch (error) {
      const task = await this.taskStore.getTask(taskId);
      if (error instanceof CancelledTaskError || task?.executionStatus === "cancelled") {
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
