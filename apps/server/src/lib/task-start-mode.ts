import type { Task, TaskAction, TaskExecutionInput, TaskStartMode } from "@agentswarm/shared-types";
import type { SchedulerService } from "../services/scheduler.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";

/** Clone/checkout runs asynchronously so create/import responses return immediately. */
function runPrepareWorkspaceInBackground(
  task: Task,
  deps: { taskStore: TaskStore; spawner: SpawnerService }
): void {
  void deps.spawner.prepareTaskWorkspaceOnly(task).catch(async (error) => {
    const message = error instanceof Error ? error.message : "Workspace preparation failed";
    await deps.taskStore.patchTask(task.id, {
      status: "failed",
      enqueued: false,
      errorMessage: message,
      finishedAt: new Date().toISOString()
    });
    await deps.taskStore.appendLog(task.id, `Workspace preparation failed: ${message}`);
  });
}

/** Action to enqueue when `startMode` is `run_now` (matches prior /tasks behavior). */
export const getTriggerActionForNewTask = (task: Pick<Task, "taskType">): TaskAction => {
  if (task.taskType === "ask") {
    return "ask";
  }
  return "build";
};

export async function applyTaskStartMode(
  task: Task,
  startMode: TaskStartMode | undefined,
  deps: { taskStore: TaskStore; scheduler: SchedulerService; spawner: SpawnerService },
  input?: TaskExecutionInput
): Promise<Task> {
  const mode = startMode ?? "run_now";
  if (mode === "idle") {
    return (await deps.taskStore.getTask(task.id)) ?? task;
  }
  if (mode === "prepare_workspace") {
    runPrepareWorkspaceInBackground(task, { taskStore: deps.taskStore, spawner: deps.spawner });
    return (await deps.taskStore.getTask(task.id)) ?? task;
  }
  const action = getTriggerActionForNewTask(task);
  const accepted = await deps.scheduler.triggerAction(task.id, action, input);
  if (!accepted) {
    throw new Error("Task execution could not be started");
  }
  return (await deps.taskStore.getTask(task.id)) ?? task;
}
