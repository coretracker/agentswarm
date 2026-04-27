import {
  getActiveStatusForAction,
  getQueuedStatusForAction,
  isActiveTaskStatus,
  isQueuedTaskStatus,
  type TaskAction,
  type TaskStatus
} from "@agentswarm/shared-types";

export const resolveTaskReadyStatus = (hasPendingCheckpoint: boolean): TaskStatus =>
  hasPendingCheckpoint ? "awaiting_review" : "open";

export const reconcileTaskStatusWithPendingCheckpoint = (
  status: TaskStatus,
  hasPendingCheckpoint: boolean
): TaskStatus => {
  if (status === "archived" || isQueuedTaskStatus(status) || isActiveTaskStatus(status)) {
    return status;
  }

  if (hasPendingCheckpoint) {
    return "awaiting_review";
  }

  if (status === "completed" || status === "answered" || status === "accepted") {
    return "open";
  }

  return status;
};

export const normalizeTaskLifecycleStatus = (
  status: string,
  fallbackAction: TaskAction,
  hasPendingCheckpoint: boolean
): TaskStatus => {
  if (
    status === "build_queued" ||
    status === "preparing_workspace" ||
    status === "building" ||
    status === "ask_queued" ||
    status === "asking" ||
    status === "open" ||
    status === "awaiting_review" ||
    status === "done" ||
    status === "completed" ||
    status === "answered" ||
    status === "accepted" ||
    status === "archived" ||
    status === "cancelled" ||
    status === "failed"
  ) {
    return reconcileTaskStatusWithPendingCheckpoint(status as TaskStatus, hasPendingCheckpoint);
  }

  if (status === "queued" || status.endsWith("_queued")) {
    return getQueuedStatusForAction(fallbackAction);
  }

  if (status === "spawning" || status === "running" || status.endsWith("ing")) {
    return getActiveStatusForAction(fallbackAction);
  }

  if (status === "succeeded" || status.endsWith("ed")) {
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  if (!status.includes("_")) {
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  return "failed";
};
