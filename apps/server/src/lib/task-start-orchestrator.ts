import type { Task, TaskExecutionInput, TaskStartMode } from "@agentswarm/shared-types";
import type { SchedulerService } from "../services/scheduler.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
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
