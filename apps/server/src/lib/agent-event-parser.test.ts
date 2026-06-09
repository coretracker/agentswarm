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
