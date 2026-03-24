import type { TaskStore } from "../services/task-store.js";

export async function getMutationBlockedReason(taskStore: TaskStore, taskId: string): Promise<string | null> {
  if (await taskStore.hasPendingChangeProposal(taskId)) {
    return "Apply or reject the pending checkpoint before continuing.";
  }
  if (await taskStore.getActiveInteractiveSession(taskId)) {
    return "Close the interactive terminal session before continuing.";
  }
  return null;
}
