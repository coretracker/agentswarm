import { type TaskAction, type TaskStatus } from "@agentswarm/shared-types";

export const resolveTaskReadyStatus = (hasPendingCheckpoint: boolean): TaskStatus =>
  hasPendingCheckpoint ? "awaiting_review" : "open";

export const reconcileTaskStatusWithPendingCheckpoint = (
  status: TaskStatus,
  hasPendingCheckpoint: boolean
): TaskStatus => {
  if (status === "draft" || status === "scheduled" || status === "archived") {
    return status;
  }

  if (
    status === "build_queued" ||
    status === "preparing_workspace" ||
    status === "building" ||
    status === "ask_queued" ||
    status === "asking" ||
    status === "completed" ||
    status === "answered" ||
    status === "accepted" ||
    status === "cancelled" ||
    status === "failed" ||
    (!hasPendingCheckpoint && status === "awaiting_review")
  ) {
    return "open";
  }

  return status;
};

export const normalizeTaskLifecycleStatus = (
  status: string,
  _fallbackAction: TaskAction,
  hasPendingCheckpoint: boolean
): TaskStatus => {
  if (
    status === "scheduled" ||
    status === "draft" ||
    status === "build_queued" ||
    status === "preparing_workspace" ||
    status === "building" ||
    status === "ask_queued" ||
    status === "asking" ||
    status === "open" ||
    status === "in_progress" ||
    status === "in_review" ||
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
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  if (status === "spawning" || status === "running" || status.endsWith("ing")) {
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  if (status === "succeeded" || status.endsWith("ed")) {
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  if (!status.includes("_")) {
    return resolveTaskReadyStatus(hasPendingCheckpoint);
  }

  return resolveTaskReadyStatus(hasPendingCheckpoint);
};
