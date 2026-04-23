import {
  TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH,
  type TaskChangeProposal,
  type TaskContextEntry,
  type TaskMessage,
  type TaskRun
} from "@agentswarm/shared-types";
import type { TaskHistoryEntry } from "./task-history";

export interface SerializedTaskHistoryContextEntry {
  key: string;
  label: string;
  preview: string;
  size: number;
  entry: TaskContextEntry;
}

const MAX_PREVIEW_LENGTH = 220;
const MAX_CHANGED_FILES = 8;

function toUtcLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function titleCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactPreview(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), MAX_PREVIEW_LENGTH);
}

function buildChangedFilesLine(changedFiles: string[]): string | null {
  if (changedFiles.length === 0) {
    return null;
  }

  const visible = changedFiles.slice(0, MAX_CHANGED_FILES);
  const hiddenCount = changedFiles.length - visible.length;
  return `Files: ${visible.join(", ")}${hiddenCount > 0 ? ` (+${hiddenCount} more)` : ""}`;
}

function buildProposalSummary(proposal: TaskChangeProposal): string {
  const lines = [
    `Source: ${proposal.sourceType === "build_run" ? "Build run" : "Terminal session"}`,
    `Status: ${titleCase(proposal.status)}`
  ];

  if (proposal.diffStat.trim()) {
    lines.push(`Diff stat: ${proposal.diffStat.trim()}`);
  }

  const changedFilesLine = buildChangedFilesLine(proposal.changedFiles);
  if (changedFilesLine) {
    lines.push(changedFilesLine);
  }

  if (proposal.diffTruncated) {
    lines.push("Diff preview was truncated in history.");
  }

  return lines.join("\n");
}

function getNormalizedRunSummary(run: TaskRun): string | null {
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

function joinSections(sections: Array<{ title: string; content: string | null | undefined }>): string {
  return sections
    .filter((section) => section.content && section.content.trim().length > 0)
    .map((section) => `${section.title}:\n${section.content?.trim() ?? ""}`)
    .join("\n\n");
}

function buildNestedContextSummary(entries: TaskContextEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) {
    return null;
  }

  return entries.map((entry) => `${entry.label}:\n${entry.content}`).join("\n\n");
}

function buildAttachmentSummary(message: TaskMessage): string | null {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return null;
  }

  return attachments.map((attachment) => attachment.name).join("\n");
}

function finalizeContext(key: string, kind: TaskContextEntry["kind"], label: string, content: string): SerializedTaskHistoryContextEntry {
  const normalizedContent = truncate(content.trim(), TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH);
  return {
    key,
    label,
    preview: compactPreview(normalizedContent),
    size: label.length + normalizedContent.length,
    entry: {
      kind,
      label,
      content: normalizedContent
    }
  };
}

function serializeMessageEntry(key: string, message: TaskMessage): SerializedTaskHistoryContextEntry {
  const labelParts = [titleCase(message.role)];
  if (message.action) {
    labelParts.push(titleCase(message.action));
  }
  labelParts.push("message");
  const nestedContextSummary = buildNestedContextSummary(message.contextEntries);
  const attachmentSummary = buildAttachmentSummary(message);
  const content = joinSections([
    {
      title: "Message",
      content: message.content
    },
    {
      title: "Images",
      content: attachmentSummary
    },
    {
      title: "Additional context",
      content: nestedContextSummary
    }
  ]);

  return finalizeContext(key, "message", `${labelParts.join(" ")} · ${toUtcLabel(message.createdAt)}`, content);
}

function serializeRunEntry(key: string, run: TaskRun): SerializedTaskHistoryContextEntry {
  const summary = getNormalizedRunSummary(run);
  const content = joinSections([
    {
      title: "Run",
      content: [`Status: ${titleCase(run.status)}`, `Provider: ${titleCase(run.provider)}`, `Branch: ${run.branchName ?? "(pending)"}`].join("\n")
    },
    {
      title: run.action === "ask" ? "Answer" : "Summary",
      content: summary
    },
    {
      title: "Error",
      content: run.errorMessage?.trim() || null
    }
  ]);

  return finalizeContext(key, "run", `${titleCase(run.action)} run · ${titleCase(run.status)} · ${toUtcLabel(run.startedAt)}`, content);
}

function serializeProposalEntry(key: string, proposal: TaskChangeProposal): SerializedTaskHistoryContextEntry {
  return finalizeContext(key, "proposal", `Checkpoint · ${titleCase(proposal.status)} · ${toUtcLabel(proposal.createdAt)}`, buildProposalSummary(proposal));
}

export function serializeTaskHistoryContextEntry(entry: TaskHistoryEntry): SerializedTaskHistoryContextEntry {
  if (entry.kind === "message") {
    return serializeMessageEntry(entry.key, entry.message);
  }

  if (entry.kind === "run") {
    return serializeRunEntry(entry.key, entry.run);
  }

  if (entry.kind === "proposal") {
    return serializeProposalEntry(entry.key, entry.proposal);
  }

  if (entry.kind === "grouped_terminal_session") {
    const content = joinSections([
      {
        title: "Session",
        content: [
          `Status: ${entry.active ? "Active" : "Completed"}`,
          `Started: ${toUtcLabel(entry.startMessage.createdAt)}`,
          entry.endMessage ? `Ended: ${toUtcLabel(entry.endMessage.createdAt)}` : null
        ]
          .filter(Boolean)
          .join("\n")
      },
      {
        title: "Checkpoint",
        content: entry.proposal ? buildProposalSummary(entry.proposal) : "No checkpoint was attached to this terminal session."
      }
    ]);

    return finalizeContext(entry.key, "terminal_session", `Terminal session · ${entry.active ? "Active" : "Completed"} · ${toUtcLabel(entry.timestamp)}`, content);
  }

  const summary = getNormalizedRunSummary(entry.run);
  const content = joinSections([
    {
      title: entry.run.action === "ask" ? "Question" : "Request",
      content: entry.promptMessage?.content ?? "No matched user prompt was found for this run."
    },
    {
      title: entry.run.action === "ask" ? "Answer" : "Summary",
      content: summary ?? (entry.run.status === "running" ? "This run is still in progress." : null)
    },
    {
      title: "Checkpoint",
      content: entry.proposal ? buildProposalSummary(entry.proposal) : null
    },
    {
      title: "Error",
      content: entry.run.errorMessage?.trim() || null
    }
  ]);

  return finalizeContext(entry.key, "run", `${titleCase(entry.run.action)} run · ${titleCase(entry.run.status)} · ${toUtcLabel(entry.timestamp)}`, content);
}
