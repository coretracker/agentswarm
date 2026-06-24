import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedAgentEvent } from "@agentswarm/shared-types";
import { buildTimelineDisplayItems } from "./task-run-timeline";

function event(input: Partial<NormalizedAgentEvent> & Pick<NormalizedAgentEvent, "id" | "kind" | "rawEventIndex" | "title">): NormalizedAgentEvent {
  return {
    provider: "codex",
    ...input
  };
}

test("combines related tool start and completion events into one display group", () => {
  const items = buildTimelineDisplayItems([
    event({ id: "assistant-1", kind: "assistant.message", rawEventIndex: 0, title: "Assistant message", message: "Working on it" }),
    event({
      id: "tool-1-start",
      kind: "tool.started",
      rawEventIndex: 1,
      title: "Command started",
      detail: "npm test",
      status: "in_progress",
      toolCallId: "tool-1",
      toolName: "command_execution"
    }),
    event({
      id: "tool-1-complete",
      kind: "tool.completed",
      rawEventIndex: 2,
      title: "Command completed",
      detail: "npm test",
      message: "ok",
      status: "completed",
      toolCallId: "tool-1",
      toolName: "command_execution",
      exitCode: 0
    })
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.type, "event");
  assert.equal(items[1]?.type, "tool_group");
  if (items[1]?.type !== "tool_group") {
    throw new Error("Expected tool_group");
  }
  assert.equal(items[1].status, "completed");
  assert.equal(items[1].rawEventCount, 2);
  assert.equal(items[1].calls.length, 1);
  assert.equal(items[1].calls[0]?.title, "Command completed");
  assert.equal(items[1].calls[0]?.message, "ok");
});

test("keeps failed tool calls prominent in the group status", () => {
  const items = buildTimelineDisplayItems([
    event({
      id: "tool-1",
      kind: "tool.completed",
      rawEventIndex: 0,
      title: "MCP repo-mcp:list_branches completed",
      status: "completed",
      toolCallId: "tool-1",
      toolName: "list_branches"
    }),
    event({
      id: "tool-2",
      kind: "tool.failed",
      rawEventIndex: 1,
      title: "Command failed",
      status: "completed",
      toolCallId: "tool-2",
      toolName: "command_execution",
      exitCode: 1
    })
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.type, "tool_group");
  if (items[0]?.type !== "tool_group") {
    throw new Error("Expected tool_group");
  }
  assert.equal(items[0].status, "failed");
  assert.equal(items[0].calls.length, 2);
});

test("groups consecutive file change events", () => {
  const items = buildTimelineDisplayItems([
    event({
      id: "file-1",
      kind: "file.changed",
      rawEventIndex: 0,
      title: "File update",
      filePath: "src/a.ts",
      fileChangeKind: "update"
    }),
    event({
      id: "file-2",
      kind: "file.changed",
      rawEventIndex: 1,
      title: "File create",
      filePath: "src/b.ts",
      fileChangeKind: "create"
    })
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.type, "file_group");
  if (items[0]?.type !== "file_group") {
    throw new Error("Expected file_group");
  }
  assert.equal(items[0].title, "Files changed");
  assert.deepEqual(
    items[0].files.map((file) => file.filePath),
    ["src/a.ts", "src/b.ts"]
  );
});
