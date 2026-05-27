import type { TaskStore } from "../services/task-store.js";

export type TaskMutationBlockedReasonCode = "pending_checkpoint" | "active_terminal_session";

export interface TaskMutationBlockedReason {
  code: TaskMutationBlockedReasonCode;
  message: string;
}

const PENDING_CHECKPOINT_BLOCK: TaskMutationBlockedReason = {
  code: "pending_checkpoint",
  message: "Apply or reject the pending checkpoint before continuing."
};

const ACTIVE_TERMINAL_SESSION_BLOCK: TaskMutationBlockedReason = {
  code: "active_terminal_session",
  message: "Close the terminal session before continuing."
};

export async function getMutationBlocked(taskStore: TaskStore, taskId: string): Promise<TaskMutationBlockedReason | null> {
  if (await taskStore.hasPendingChangeProposal(taskId)) {
    return PENDING_CHECKPOINT_BLOCK;
  }
  if (await taskStore.getActiveInteractiveSession(taskId)) {
    return ACTIVE_TERMINAL_SESSION_BLOCK;
  }
  return null;
}

export async function getMutationBlockedReason(taskStore: TaskStore, taskId: string): Promise<string | null> {
  return (await getMutationBlocked(taskStore, taskId))?.message ?? null;
}
