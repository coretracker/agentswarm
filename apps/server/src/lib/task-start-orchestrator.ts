import { isActiveTaskStatus, type Task, type TaskAction, type TaskExecutionInput, type TaskStartMode } from "@agentswarm/shared-types";
import type { SchedulerService } from "../services/scheduler.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { getMutationBlocked, type TaskMutationBlockedReasonCode } from "./task-mutation-guards.js";
import { applyTaskStartMode } from "./task-start-mode.js";

export interface TaskStartOrchestratorDeps {
  taskStore: TaskStore;
  scheduler: SchedulerService;
  spawner: SpawnerService;
}

export interface OrchestrateTaskStartOptions {
  task: Task;
  startMode: TaskStartMode | undefined;
  input?: TaskExecutionInput;
  fallbackMessage: string;
  setPrepareWorkspaceFailureState?: boolean;
}

export type OrchestratedTaskStartResult =
  | { ok: true; task: Task }
  | { ok: false; message: string; statusCode: 409 | 500 };

export interface OrchestrateTaskActionOptions {
  task: Task;
  action: TaskAction;
  input?: TaskExecutionInput;
  allowParallelAsk?: boolean;
  busyMessage?: string;
  capacityMessage?: string;
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

export const taskStartFailureStatusCode = (startMode: TaskStartMode | undefined): 409 | 500 => {
  return (startMode ?? "run_now") === "run_now" ? 409 : 500;
};

const setPrepareWorkspaceFailureState = async (taskStore: TaskStore, taskId: string, message: string): Promise<void> => {
  await taskStore.patchTask(taskId, {
    status: "failed",
    enqueued: false,
    errorMessage: message,
    finishedAt: new Date().toISOString()
  });
  await taskStore.appendLog(taskId, `Workspace preparation failed: ${message}`);
};

export async function orchestrateTaskStart(
  deps: TaskStartOrchestratorDeps,
  options: OrchestrateTaskStartOptions
): Promise<OrchestratedTaskStartResult> {
  try {
    const startedTask = await applyTaskStartMode(options.task, options.startMode, deps, options.input);
    return { ok: true, task: startedTask };
  } catch (error) {
    const message = toErrorMessage(error, options.fallbackMessage);
    const mode = options.startMode ?? "run_now";
    if (options.setPrepareWorkspaceFailureState === true && mode === "prepare_workspace") {
      await setPrepareWorkspaceFailureState(deps.taskStore, options.task.id, message);
    }
    return {
      ok: false,
      message,
      statusCode: taskStartFailureStatusCode(mode)
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

  if (isActiveTaskStatus(options.task.status) && options.allowParallelAsk !== true) {
    return {
      ok: false,
      statusCode: 409,
      message: options.busyMessage ?? "Task is already running"
    };
  }

  if (options.allowParallelAsk === true && !(await deps.scheduler.hasExecutionCapacity())) {
    return {
      ok: false,
      statusCode: 409,
      message: options.capacityMessage ?? "No agent capacity is available for a parallel ask right now."
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
