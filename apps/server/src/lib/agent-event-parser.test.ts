import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentJsonlEvents } from "./agent-event-parser.js";

describe("parseAgentJsonlEvents", () => {
  it("normalizes Codex command, file, message, and usage events", () => {
    const raw = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      { type: "item.started", item: { id: "item_1", type: "command_execution", command: "npm test", aggregated_output: "", exit_code: null, status: "in_progress" } },
      { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "npm test", aggregated_output: "ok", exit_code: 0, status: "completed" } },
      { type: "item.completed", item: { id: "item_2", type: "file_change", changes: [{ path: "src/app.ts", kind: "update" }], status: "completed" } },
      { type: "item.completed", item: { id: "item_3", type: "agent_message", text: "Done" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }
    ].map((event) => JSON.stringify(event)).join("\n");

    const events = parseAgentJsonlEvents("codex", raw);

    assert.equal(events.some((event) => event.kind === "tool.started" && event.detail === "npm test"), true);
    assert.equal(events.some((event) => event.kind === "tool.completed" && event.message === "ok"), true);
    assert.equal(events.some((event) => event.kind === "file.changed" && event.filePath === "src/app.ts"), true);
    assert.equal(events.some((event) => event.kind === "assistant.message" && event.message === "Done"), true);
    assert.equal(events.some((event) => event.kind === "usage.reported"), true);
  });

  it("normalizes Codex MCP tool call events", () => {
    const raw = [
      {
        type: "item.started",
        item: {
          id: "item_1",
          type: "mcp_tool_call",
          server: "repo-mcp",
          tool: "list_branches",
          arguments: { repo: "repo", query: "main" },
          result: null,
          error: null,
          status: "in_progress"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "mcp_tool_call",
          server: "repo-mcp",
          tool: "list_branches",
          arguments: { repo: "repo", query: "main" },
          result: { content: [{ type: "text", text: "[]" }], structured_content: null },
          error: null,
          status: "completed"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "item_2",
          type: "mcp_tool_call",
          server: "repo-mcp",
          tool: "delete_branch",
          arguments: { repo: "repo", branch: "old-branch" },
          result: null,
          error: { message: "Forbidden" },
          status: "completed"
        }
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const events = parseAgentJsonlEvents("codex", raw);

    assert.equal(
      events.some(
        (event) =>
          event.kind === "tool.started" &&
          event.title === "MCP repo-mcp:list_branches started" &&
          event.toolName === "list_branches" &&
          event.detail === "{\"repo\":\"repo\",\"query\":\"main\"}"
      ),
      true
    );
    assert.equal(
      events.some(
        (event) =>
          event.kind === "tool.completed" &&
          event.title === "MCP repo-mcp:list_branches completed" &&
          event.message === "[]" &&
          event.status === "completed"
      ),
      true
    );
    assert.equal(
      events.some(
        (event) =>
          event.kind === "tool.failed" &&
          event.title === "MCP repo-mcp:delete_branch failed" &&
          event.message === "{\"message\":\"Forbidden\"}" &&
          event.status === "completed"
      ),
      true
    );
  });

  it("normalizes Codex web search events into tool lifecycle entries", () => {
    const raw = [
      {
        type: "item.started",
        item: {
          id: "ws_123",
          type: "web_search",
          query: "",
          action: { type: "other" },
          status: "in_progress"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "ws_123",
          type: "web_search",
          query: "site:docs.github.com GitHub Actions runs-on expressions",
          action: {
            type: "search",
            query: "site:docs.github.com GitHub Actions runs-on expressions",
            queries: ["site:docs.github.com GitHub Actions runs-on expressions"]
          },
          status: "completed"
        }
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const events = parseAgentJsonlEvents("codex", raw);

    assert.equal(
      events.some(
        (event) =>
          event.kind === "tool.started" &&
          event.toolName === "web_search" &&
          event.toolCallId === "ws_123" &&
          event.status === "in_progress"
      ),
      true
    );
    assert.equal(
      events.some(
        (event) =>
          event.kind === "tool.completed" &&
          event.toolName === "web_search" &&
          event.toolCallId === "ws_123" &&
          event.detail === "site:docs.github.com GitHub Actions runs-on expressions"
      ),
      true
    );
  });

  it("normalizes Codex file change events from started and completed wrappers", () => {
    const raw = [
      {
        type: "item.started",
        item: {
          id: "file_1",
          type: "file_change",
          changes: [{ path: "docs/tasks/active/026-step-metrics-delay.md", kind: "add" }],
          status: "in_progress"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "file_1",
          type: "file_change",
          changes: [{ path: "docs/tasks/active/026-step-metrics-delay.md", kind: "add" }],
          status: "completed"
        }
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const events = parseAgentJsonlEvents("codex", raw);

    assert.equal(
      events.some(
        (event) =>
          event.kind === "file.changed" &&
          event.toolCallId === "file_1" &&
          event.filePath === "docs/tasks/active/026-step-metrics-delay.md" &&
          event.status === "in_progress"
      ),
      true
    );
    assert.equal(
      events.some(
        (event) =>
          event.kind === "file.changed" &&
          event.toolCallId === "file_1" &&
          event.filePath === "docs/tasks/active/026-step-metrics-delay.md" &&
          event.status === "completed"
      ),
      true
    );
  });

  it("normalizes Claude tool results and final result events", () => {
    const raw = [
      { type: "system", subtype: "init", session_id: "session-1", model: "claude-sonnet" },
      { type: "assistant", session_id: "session-1", message: { id: "msg_1", content: [{ type: "tool_use", id: "tool_1", name: "Write", input: { file_path: "test.txt" } }] } },
      { type: "user", session_id: "session-1", message: { content: [{ type: "tool_result", tool_use_id: "tool_1", content: "File created" }] }, tool_use_result: { type: "create" } },
      { type: "stream_event", session_id: "session-1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Done" } } },
      { type: "result", subtype: "success", is_error: false, session_id: "session-1", result: "Done", usage: { input_tokens: 1 }, total_cost_usd: 0.01, terminal_reason: "completed" }
    ].map((event) => JSON.stringify(event)).join("\n");

    const events = parseAgentJsonlEvents("claude", raw);

    assert.equal(events.some((event) => event.kind === "run.started" && event.sessionId === "session-1"), true);
    assert.equal(events.some((event) => event.kind === "tool.started" && event.toolName === "Write"), true);
    assert.equal(events.some((event) => event.kind === "tool.completed" && event.toolCallId === "tool_1"), true);
    assert.equal(events.some((event) => event.kind === "assistant.message.delta" && event.message === "Done"), true);
    assert.equal(events.some((event) => event.kind === "run.completed" && event.message === "Done"), true);
    assert.equal(events.some((event) => event.kind === "usage.reported" && event.metrics?.total_cost_usd === 0.01), true);
  });
});
