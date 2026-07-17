import dayjs from "dayjs";
import type { TaskAction, TaskChangeProposal, TaskRun } from "@verft/shared-types";

export const taskRunStatusColor: Record<TaskRun["status"], string> = {
  running: "processing",
  succeeded: "green",
  failed: "red",
  cancelled: "default"
};

export const taskRunActionLabel: Record<TaskAction, string> = {
  build: "Build",
  ask: "Ask"
};

export function checkpointStatusLabel(status: TaskChangeProposal["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "applying":
      return "Applying";
    case "applied":
      return "Applied";
    case "rejected":
      return "Rejected";
    case "reverted":
      return "Reverted";
  }
}

export function checkpointStatusColor(status: TaskChangeProposal["status"]): string {
  switch (status) {
    case "pending":
      return "orange";
    case "applying":
      return "processing";
    case "applied":
      return "green";
    case "reverted":
      return "blue";
    case "rejected":
      return "red";
  }
}

export function getNormalizedRunSummary(run: TaskRun): string | null {
  if (run.status === "failed" && run.errorMessage) {
    const summary = run.summary?.trim();
    const errorMessage = run.errorMessage.trim();
    if (!summary) {
      return null;
    }
    if (summary === errorMessage || summary === `Task failed: ${errorMessage}`) {
      return null;
    }
    return summary;
  }

  return run.summary?.trim() || null;
}

export function formatRunDuration(startedAt: string, finishedAt: string | null): string {
  const start = dayjs(startedAt);
  const end = finishedAt ? dayjs(finishedAt) : dayjs();
  const totalSeconds = Math.max(0, end.diff(start, "second"));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
