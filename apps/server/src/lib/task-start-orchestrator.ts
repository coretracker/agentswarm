import { isActiveTaskStatus, type Task, type TaskAction, type TaskExecutionInput } from "@agentswarm/shared-types";
import type { SchedulerService } from "../services/scheduler.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { getMutationBlocked, type TaskMutationBlockedReasonCode } from "./task-mutation-guards.js";

export interface TaskStartOrchestratorDeps {
  taskStore: TaskStore;
  scheduler: SchedulerService;
  spawner: SpawnerService;
}

export interface OrchestrateTaskStartOptions {
  task: Task;
  input?: TaskExecutionInput;
  fallbackMessage: string;
}

export type OrchestratedTaskStartResult =
  | { ok: true; task: Task }
  | { ok: false; message: string; statusCode: 409 | 500 };

export interface OrchestrateTaskActionOptions {
  task: Task;
  action: TaskAction;
  input?: TaskExecutionInput;
  busyMessage?: string;
  triggerRejectedMessage?: string;
}

export type OrchestratedTaskActionResult =
  | { ok: true }
  | { ok: false; statusCode: 409; message: string; reasonCode?: TaskMutationBlockedReasonCode };

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : fallbackMessage;
  }
  return fallbackMessage;
};

export const getTriggerActionForNewTask = (task: Pick<Task, "taskType">): TaskAction => {
  if (task.taskType === "ask") {
    return "ask";
  }
  return "build";
};

export async function orchestrateTaskStart(
  deps: TaskStartOrchestratorDeps,
  options: OrchestrateTaskStartOptions
): Promise<OrchestratedTaskStartResult> {
  try {
    await deps.spawner.prepareTaskWorkspaceOnly(options.task);
    const accepted = await deps.scheduler.triggerAction(
      options.task.id,
      getTriggerActionForNewTask(options.task),
      options.input
    );
    if (!accepted) {
      throw new Error("Task execution could not be started");
    }
    return { ok: true, task: (await deps.taskStore.getTask(options.task.id)) ?? options.task };
  } catch (error) {
    const message = toErrorMessage(error, options.fallbackMessage);
    return {
      ok: false,
      message,
      statusCode: 409
    };
  }
}

export async function orchestrateTaskActionStart(
  deps: Pick<TaskStartOrchestratorDeps, "taskStore" | "scheduler">,
  options: OrchestrateTaskActionOptions
): Promise<OrchestratedTaskActionResult> {
  const blocked = await getMutationBlocked(deps.taskStore, options.task.id);
  if (blocked) {
    return {
      ok: false,
      statusCode: 409,
      message: blocked.message,
      reasonCode: blocked.code
    };
  }

  if (
    ((options.task.executionStatus === "queued" || options.task.executionStatus === "preparing" || options.task.executionStatus === "running") ||
      isActiveTaskStatus(options.task.status))
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: options.busyMessage ?? "Task is already running"
    };
  }

  const accepted = await deps.scheduler.triggerAction(options.task.id, options.action, options.input);
  if (!accepted) {
    return {
      ok: false,
      statusCode: 409,
      message: options.triggerRejectedMessage ?? options.busyMessage ?? "Task is already running"
    };
  }

  return { ok: true };
}
