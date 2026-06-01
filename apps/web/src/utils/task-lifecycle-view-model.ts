import { getCheckpointMutationBlockedReason, isActiveTaskStatus, isTaskWorking, type Task } from "@agentswarm/shared-types";

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
  const isArchived = task?.status === "archived";
  const isQueued = task?.status === "build_queued" || task?.status === "ask_queued";
  const isActive = task ? isActiveTaskStatus(task.status) : false;
  const hasTaskWorkingState = task ? isTaskWorking(task) : false;
  const checkpointDiffActionsBlockedReason = task ? getCheckpointMutationBlockedReason(task.status) : null;
  const checkpointDiffActionsBlocked = checkpointDiffActionsBlockedReason !== null;
  const isPreparingWorkspace = task?.status === "preparing_workspace";
  const resultStatusText =
    task?.status === "scheduled"
      ? "Scheduled"
      : task?.status === "preparing_workspace"
      ? "Preparing workspace"
      : taskType === "build"
        ? task?.status === "build_queued"
          ? "Build queued"
          : "Build in progress"
        : task?.status === "ask_queued"
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
