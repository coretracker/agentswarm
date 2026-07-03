import { isActiveTaskStatus, isQueuedTaskStatus, isTaskWorking, type Task } from "@verft/shared-types";

export interface TaskLifecycleViewModel {
  isArchived: boolean;
  isQueued: boolean;
  isActive: boolean;
  hasTaskWorkingState: boolean;
  isPreparingWorkspace: boolean;
  checkpointDiffActionsBlockedReason: string | null;
  checkpointDiffActionsBlocked: boolean;
  resultStatusText: string;
}

export const buildTaskLifecycleViewModel = (task: Task | null | undefined): TaskLifecycleViewModel => {
  const taskType = task?.taskType ?? "build";
  const executionStatus = task?.executionStatus;
  const isArchived = task?.workflowStatus === "archived" || task?.status === "archived";
  const isQueued = executionStatus === "queued" || (task ? isQueuedTaskStatus(task.status) : false);
  const isActive = executionStatus === "preparing" || executionStatus === "running" || (task ? isActiveTaskStatus(task.status) : false);
  const hasTaskWorkingState = isActive || (task ? isTaskWorking(task) : false);
  const checkpointDiffActionsBlockedReason =
    executionStatus === "queued" || executionStatus === "preparing" || executionStatus === "running" || (task ? isQueuedTaskStatus(task.status) || isActiveTaskStatus(task.status) : false)
      ? "Checkpoint actions are unavailable while task execution is queued or running."
      : null;
  const checkpointDiffActionsBlocked = checkpointDiffActionsBlockedReason !== null;
  const isPreparingWorkspace = executionStatus === "preparing" || task?.status === "preparing_workspace";
  const resultStatusText =
    isPreparingWorkspace
      ? "Preparing workspace"
      : taskType === "build"
        ? isQueued
          ? "Build queued"
          : "Build in progress"
        : isQueued
          ? "Question queued"
          : "Answer in progress";

  return {
    isArchived,
    isQueued,
    isActive,
    hasTaskWorkingState,
    isPreparingWorkspace,
    checkpointDiffActionsBlockedReason,
    checkpointDiffActionsBlocked,
    resultStatusText
  };
};
