import assert from "node:assert/strict";
import test from "node:test";
import { TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH, type TaskChangeProposal, type TaskMessage, type TaskRun } from "@agentswarm/shared-types";
import { buildTaskHistoryEntries, INTERACTIVE_TERMINAL_END_REVIEW_MESSAGE, INTERACTIVE_TERMINAL_START_MESSAGE } from "./task-history";
import { serializeTaskHistoryContextEntry } from "./task-history-context";

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
    branchName: "feature/context",
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
    diffStat: "3 files changed, 24 insertions(+), 5 deletions(-)",
    changedFiles: ["src/context.ts", "src/prompt.ts", "src/ui.tsx"],
    diffTruncated: false,
    untrackedPathsAtCheckpoint: [],
    resolvedAt: null,
    revertedAt: null,
    ...input
  };
}

test("serializes grouped runs into compact context without logs or raw diffs", () => {
  const prompt = createMessage({
    id: "m1",
    createdAt: "2026-03-24T10:00:00.000Z",
    role: "user",
    action: "build",
    content: "Implement selectable history context."
  });
  const summary = createMessage({
    id: "m2",
    createdAt: "2026-03-24T10:03:00.000Z",
    role: "assistant",
    action: "build",
    content: "Implemented compact history context blocks."
  });
  const run = createRun({
    id: "r1",
    action: "build",
    startedAt: "2026-03-24T10:01:00.000Z",
    finishedAt: "2026-03-24T10:02:30.000Z",
    status: "succeeded",
    summary: "Implemented compact history context blocks.",
    logs: ["Preparing runtime", "Streaming logs that should not be included"]
  });
  const proposal = createProposal({
    id: "p1",
    sourceType: "build_run",
    sourceId: "r1",
    status: "pending",
    createdAt: "2026-03-24T10:03:30.000Z",
    diff: "diff --git a/src/context.ts b/src/context.ts\n+full diff body that should never be serialized"
  });

  const [entry] = buildTaskHistoryEntries({
    messages: [prompt, summary],
    runs: [run],
    proposals: [proposal]
  });

  assert.ok(entry);
  const serialized = serializeTaskHistoryContextEntry(entry!);
  assert.equal(serialized.entry.kind, "run");
  assert.match(serialized.label, /Build run · Succeeded/);
  assert.match(serialized.entry.content, /Request:\nImplement selectable history context\./);
  assert.match(serialized.entry.content, /Summary:\nImplemented compact history context blocks\./);
  assert.match(serialized.entry.content, /Diff stat: 3 files changed/);
  assert.doesNotMatch(serialized.entry.content, /Streaming logs that should not be included/);
  assert.doesNotMatch(serialized.entry.content, /diff --git/);
});

test("serializes terminal history using checkpoint summary instead of transcript data", () => {
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
    diff: "diff --git a/src/terminal.ts b/src/terminal.ts\n+hidden diff body"
  });

  const [entry] = buildTaskHistoryEntries({
    messages: [start, end],
    runs: [],
    proposals: [proposal]
  });

  assert.ok(entry);
  const serialized = serializeTaskHistoryContextEntry(entry!);
  assert.equal(serialized.entry.kind, "terminal_session");
  assert.match(serialized.entry.content, /Checkpoint:\nSource: Terminal session/);
  assert.match(serialized.entry.content, /Files: src\/context\.ts, src\/prompt\.ts, src\/ui\.tsx/);
  assert.doesNotMatch(serialized.entry.content, /diff --git/);
});

test("truncates oversized history content blocks to the configured maximum", () => {
  const oversizedMessage = createMessage({
    id: "m1",
    createdAt: "2026-03-24T15:00:00.000Z",
    role: "assistant",
    action: "ask",
    content: "A".repeat(TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH + 200)
  });

  const [entry] = buildTaskHistoryEntries({
    messages: [oversizedMessage],
    runs: [],
    proposals: []
  });

  assert.ok(entry);
  const serialized = serializeTaskHistoryContextEntry(entry!);
  assert.equal(serialized.entry.content.length, TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH);
  assert.match(serialized.entry.content, /\.\.\.$/);
});

test("serializes persisted additional context on user messages", () => {
  const message = createMessage({
    id: "m1",
    createdAt: "2026-03-24T16:00:00.000Z",
    role: "user",
    action: "ask",
    content: "What changed since the last run?",
    contextEntries: [
      {
        kind: "run",
        label: "Build run · Succeeded · 2026-03-24 15:45:00 UTC",
        content: "Summary:\nImplemented the previous fix."
      },
      {
        kind: "proposal",
        label: "Checkpoint · Pending · 2026-03-24 15:46:00 UTC",
        content: "Diff stat: 2 files changed, 8 insertions(+)"
      }
    ]
  });

  const [entry] = buildTaskHistoryEntries({
    messages: [message],
    runs: [],
    proposals: []
  });

  assert.ok(entry);
  const serialized = serializeTaskHistoryContextEntry(entry!);
  assert.match(serialized.entry.content, /Message:\nWhat changed since the last run\?/);
  assert.match(serialized.entry.content, /Additional context:\nBuild run · Succeeded · 2026-03-24 15:45:00 UTC:/);
  assert.match(serialized.entry.content, /Summary:\nImplemented the previous fix\./);
  assert.match(serialized.entry.content, /Checkpoint · Pending · 2026-03-24 15:46:00 UTC:/);
});
