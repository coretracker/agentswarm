import assert from "node:assert/strict";
import test from "node:test";
import type { TaskChangeProposal, TaskMessage, TaskRun } from "@agentswarm/shared-types";
import {
  buildTaskHistoryEntries,
  INTERACTIVE_TERMINAL_END_REVIEW_MESSAGE,
  INTERACTIVE_TERMINAL_START_MESSAGE
} from "./task-history";

function createMessage(input: Partial<TaskMessage> & Pick<TaskMessage, "id" | "createdAt" | "role" | "content">): TaskMessage {
  return {
    taskId: "task-1",
    action: null,
    ...input
  };
}

function createRun(input: Partial<TaskRun> & Pick<TaskRun, "id" | "action" | "startedAt" | "status">): TaskRun {
  return {
    taskId: "task-1",
    provider: "codex",
    providerProfile: "high",
    modelOverride: null,
    branchName: "feature/test",
    finishedAt: null,
    summary: null,
    errorMessage: null,
    logs: [],
    ...input
  };
}

function createProposal(
  input: Partial<TaskChangeProposal> &
    Pick<TaskChangeProposal, "id" | "sourceType" | "sourceId" | "status" | "createdAt" | "diff">
): TaskChangeProposal {
  return {
    taskId: "task-1",
    fromRef: "abc123",
    toRef: "def456",
    diffStat: "1 file changed",
    changedFiles: ["src/example.ts"],
    diffTruncated: false,
    untrackedPathsAtCheckpoint: [],
    resolvedAt: null,
    revertedAt: null,
    ...input
  };
}

test("groups a build run with its prompt, summary message, and proposal", () => {
  const prompt = createMessage({
    id: "m1",
    createdAt: "2026-03-24T10:00:00.000Z",
    role: "user",
    action: "build",
    content: "Implement grouped history cards."
  });
  const summary = createMessage({
    id: "m2",
    createdAt: "2026-03-24T10:03:00.000Z",
    role: "assistant",
    action: "build",
    content: "Implemented grouped history cards."
  });
  const run = createRun({
    id: "r1",
    action: "build",
    startedAt: "2026-03-24T10:01:00.000Z",
    finishedAt: "2026-03-24T10:02:30.000Z",
    status: "succeeded",
    summary: "Implemented grouped history cards."
  });
  const proposal = createProposal({
    id: "p1",
    sourceType: "build_run",
    sourceId: "r1",
    status: "pending",
    createdAt: "2026-03-24T10:03:30.000Z",
    diff: "diff --git a/a b/a"
  });

  const entries = buildTaskHistoryEntries({
    messages: [prompt, summary],
    runs: [run],
    proposals: [proposal]
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "grouped_auto_run");
  if (entries[0]?.kind !== "grouped_auto_run") {
    throw new Error("Expected grouped_auto_run");
  }
  assert.equal(entries[0].promptMessage?.id, "m1");
  assert.equal(entries[0].summaryMessage?.id, "m2");
  assert.equal(entries[0].proposal?.id, "p1");
});

test("groups ask runs without forcing a diff section", () => {
  const prompt = createMessage({
    id: "m1",
    createdAt: "2026-03-24T11:00:00.000Z",
    role: "user",
    action: "ask",
    content: "Explain the current history pipeline."
  });
  const summary = createMessage({
    id: "m2",
    createdAt: "2026-03-24T11:01:30.000Z",
    role: "assistant",
    action: "ask",
    content: "The history pipeline merges messages, runs, and proposals."
  });
  const run = createRun({
    id: "r1",
    action: "ask",
    startedAt: "2026-03-24T11:00:10.000Z",
    finishedAt: "2026-03-24T11:01:00.000Z",
    status: "succeeded",
    summary: "The history pipeline merges messages, runs, and proposals."
  });

  const entries = buildTaskHistoryEntries({
    messages: [prompt, summary],
    runs: [run],
    proposals: []
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "grouped_auto_run");
  if (entries[0]?.kind !== "grouped_auto_run") {
    throw new Error("Expected grouped_auto_run");
  }
  assert.equal(entries[0].proposal, null);
});

test("keeps unmatched messages and proposals as raw entries when a run has no matched prompt", () => {
  const unrelatedMessage = createMessage({
    id: "m1",
    createdAt: "2026-03-24T12:00:00.000Z",
    role: "user",
    action: "comment",
    content: "Keep an eye on the history ordering."
  });
  const run = createRun({
    id: "r1",
    action: "build",
    startedAt: "2026-03-24T12:05:00.000Z",
    status: "running"
  });
  const unmatchedProposal = createProposal({
    id: "p1",
    sourceType: "build_run",
    sourceId: "missing-run",
    status: "pending",
    createdAt: "2026-03-24T12:06:00.000Z",
    diff: "diff --git a/a b/a"
  });

  const entries = buildTaskHistoryEntries({
    messages: [unrelatedMessage],
    runs: [run],
    proposals: [unmatchedProposal]
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["message", "grouped_auto_run", "proposal"]
  );
  const grouped = entries[1];
  assert.equal(grouped?.kind, "grouped_auto_run");
  if (grouped?.kind !== "grouped_auto_run") {
    throw new Error("Expected grouped_auto_run");
  }
  assert.equal(grouped.promptMessage, null);
});

test("groups completed terminal sessions with a diff proposal", () => {
  const start = createMessage({
    id: "m1",
    createdAt: "2026-03-24T13:00:00.000Z",
    role: "system",
    content: INTERACTIVE_TERMINAL_START_MESSAGE,
    sessionId: "session-1"
  });
  const end = createMessage({
    id: "m2",
    createdAt: "2026-03-24T13:10:00.000Z",
    role: "system",
    content: INTERACTIVE_TERMINAL_END_REVIEW_MESSAGE,
    sessionId: "session-1"
  });
  const proposal = createProposal({
    id: "p1",
    sourceType: "interactive_session",
    sourceId: "session-1",
    status: "pending",
    createdAt: "2026-03-24T13:10:01.000Z",
    diff: "diff --git a/a b/a"
  });

  const entries = buildTaskHistoryEntries({
    messages: [start, end],
    runs: [],
    proposals: [proposal]
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "grouped_terminal_session");
  if (entries[0]?.kind !== "grouped_terminal_session") {
    throw new Error("Expected grouped_terminal_session");
  }
  assert.equal(entries[0].sessionId, "session-1");
  assert.equal(entries[0].startMessage.id, "m1");
  assert.equal(entries[0].endMessage?.id, "m2");
  assert.equal(entries[0].proposal?.id, "p1");
  assert.equal(entries[0].active, false);
});

test("groups no-change terminal sessions without attaching a later proposal", () => {
  const start = createMessage({
    id: "m1",
    createdAt: "2026-03-24T14:00:00.000Z",
    role: "system",
    content: INTERACTIVE_TERMINAL_START_MESSAGE
  });
  const end = createMessage({
    id: "m2",
    createdAt: "2026-03-24T14:01:00.000Z",
    role: "system",
    content: "Interactive terminal session ended. No workspace changes were detected."
  });
  const laterProposal = createProposal({
    id: "p1",
    sourceType: "interactive_session",
    sourceId: "session-2",
    status: "pending",
    createdAt: "2026-03-24T14:05:00.000Z",
    diff: "diff --git a/a b/a"
  });

  const entries = buildTaskHistoryEntries({
    messages: [start, end],
    runs: [],
    proposals: [laterProposal]
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["grouped_terminal_session", "proposal"]
  );
  const grouped = entries[0];
  assert.equal(grouped?.kind, "grouped_terminal_session");
  if (grouped?.kind !== "grouped_terminal_session") {
    throw new Error("Expected grouped_terminal_session");
  }
  assert.equal(grouped.proposal, null);
});

test("shows an active terminal session as a start-only grouped card", () => {
  const start = createMessage({
    id: "m1",
    createdAt: "2026-03-24T15:00:00.000Z",
    role: "system",
    content: INTERACTIVE_TERMINAL_START_MESSAGE
  });

  const entries = buildTaskHistoryEntries({
    messages: [start],
    runs: [],
    proposals: [],
    interactiveTerminalRunning: true
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "grouped_terminal_session");
  if (entries[0]?.kind !== "grouped_terminal_session") {
    throw new Error("Expected grouped_terminal_session");
  }
  assert.equal(entries[0].endMessage, null);
  assert.equal(entries[0].active, true);
});

test("shows active auto runs as grouped cards before summary or diff exist", () => {
  const prompt = createMessage({
    id: "m1",
    createdAt: "2026-03-24T16:00:00.000Z",
    role: "user",
    action: "build",
    content: "Keep streaming logs in the grouped card."
  });
  const run = createRun({
    id: "r1",
    action: "build",
    startedAt: "2026-03-24T16:00:05.000Z",
    status: "running",
    logs: ["Preparing workspace", "Launching runtime"]
  });

  const entries = buildTaskHistoryEntries({
    messages: [prompt],
    runs: [run],
    proposals: []
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "grouped_auto_run");
  if (entries[0]?.kind !== "grouped_auto_run") {
    throw new Error("Expected grouped_auto_run");
  }
  assert.equal(entries[0].promptMessage?.id, "m1");
  assert.equal(entries[0].summaryMessage, null);
  assert.equal(entries[0].proposal, null);
});
