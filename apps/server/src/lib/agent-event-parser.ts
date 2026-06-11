import type { AgentProvider, NormalizedAgentEvent } from "@agentswarm/shared-types";

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const asRecord = (value: unknown): JsonObject | undefined => (isRecord(value) ? value : undefined);

const stringify = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const truncate = (value: string | undefined, maxLength = 800): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
};

const eventId = (provider: AgentProvider, index: number, suffix: string): string => `${provider}-${index}-${suffix}`;

const push = (
  events: NormalizedAgentEvent[],
  provider: AgentProvider,
  rawEventIndex: number,
  suffix: string,
  event: Omit<NormalizedAgentEvent, "id" | "provider" | "rawEventIndex">
): void => {
  events.push({
    id: eventId(provider, rawEventIndex, suffix),
    provider,
    rawEventIndex,
    ...event
  });
};

export function parseAgentJsonlEvents(provider: AgentProvider, rawJsonl: string): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const lines = rawJsonl.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  lines.forEach((line, index) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      push(events, provider, index, "invalid-json", {
        kind: "unknown",
        title: "Invalid JSON event",
        detail: error instanceof Error ? error.message : "Could not parse JSONL line."
      });
      return;
    }

    if (!isRecord(raw)) {
      push(events, provider, index, "unknown-shape", {
        kind: "unknown",
        title: "Unknown event",
        detail: "Event is not a JSON object."
      });
      return;
    }

    if (provider === "codex") {
      parseCodexEvent(raw, index, events);
    } else {
      parseClaudeEvent(raw, index, events);
    }
  });

  return events;
}

function parseCodexEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[]): void {
  const type = asString(raw.type);
  if (type === "thread.started") {
    const threadId = asString(raw.thread_id);
    push(events, "codex", index, "thread-started", {
      kind: "run.started",
      title: "Codex thread started",
      sessionId: threadId
    });
    return;
  }
  if (type === "turn.started") {
    push(events, "codex", index, "turn-started", {
      kind: "turn.started",
      title: "Turn started"
    });
    return;
  }
  if (type === "turn.completed") {
    const usage = asRecord(raw.usage);
    push(events, "codex", index, "turn-completed", {
      kind: "turn.completed",
      title: "Turn completed",
      usage
    });
    if (usage) {
      push(events, "codex", index, "usage", {
        kind: "usage.reported",
        title: "Usage reported",
        usage
      });
    }
    return;
  }
  if (type === "item.started" || type === "item.completed") {
    parseCodexItem(raw, index, events);
    return;
  }

  push(events, "codex", index, "unknown", {
    kind: "unknown",
    title: type ? `Unknown Codex event: ${type}` : "Unknown Codex event"
  });
}

function parseCodexItem(raw: JsonObject, index: number, events: NormalizedAgentEvent[]): void {
  const wrapperType = asString(raw.type);
  const item = asRecord(raw.item);
  const itemType = asString(item?.type);
  const itemId = asString(item?.id);
  const status = asString(item?.status);
  const isCompleted = wrapperType === "item.completed";

  if (itemType === "agent_message" && isCompleted) {
    push(events, "codex", index, itemId ?? "agent-message", {
      kind: "assistant.message",
      title: "Assistant message",
      message: asString(item?.text),
      messageId: itemId
    });
    return;
  }

  if (itemType === "command_execution") {
    const command = asString(item?.command);
    const exitCode = asNumber(item?.exit_code);
    const output = truncate(asString(item?.aggregated_output));
    const kind = !isCompleted ? "tool.started" : exitCode === 0 ? "tool.completed" : "tool.failed";
    push(events, "codex", index, itemId ?? "command", {
      kind,
      title: !isCompleted ? "Command started" : exitCode === 0 ? "Command completed" : "Command failed",
      detail: command,
      message: isCompleted ? output : undefined,
      status: status ?? (!isCompleted ? "in_progress" : undefined),
      toolCallId: itemId,
      toolName: "command_execution",
      exitCode: exitCode ?? null
    });
    return;
  }

  if (itemType === "mcp_tool_call") {
    const server = asString(item?.server);
    const toolName = asString(item?.tool);
    const error = item?.error;
    const isFailed = isCompleted && error !== undefined && error !== null;
    const kind = !isCompleted ? "tool.started" : isFailed ? "tool.failed" : "tool.completed";
    const titleToolName = [server, toolName].filter(Boolean).join(":");
    const result = asRecord(item?.result);
    const content = Array.isArray(result?.content) ? result.content : [];
    const textContent = content
      .map((block) => asString(asRecord(block)?.text))
      .filter((text): text is string => Boolean(text))
      .join("\n");
    const message = isFailed ? truncate(stringify(error)) : truncate(textContent || stringify(item?.result));
    push(events, "codex", index, itemId ?? "mcp-tool-call", {
      kind,
      title: !isCompleted
        ? titleToolName ? `MCP ${titleToolName} started` : "MCP tool started"
        : isFailed
          ? titleToolName ? `MCP ${titleToolName} failed` : "MCP tool failed"
          : titleToolName ? `MCP ${titleToolName} completed` : "MCP tool completed",
      detail: truncate(stringify(item?.arguments)),
      message: isCompleted ? message : undefined,
      status: status ?? (!isCompleted ? "in_progress" : isFailed ? "failed" : "completed"),
      toolCallId: itemId,
      toolName: toolName ?? "mcp_tool_call"
    });
    return;
  }

  if (itemType === "web_search") {
    const action = asRecord(item?.action);
    const actionType = asString(action?.type);
    const query = asString(item?.query) ?? asString(action?.query);
    const queries = Array.isArray(action?.queries) ? action.queries : [];
    const queryList = queries
      .map((entry) => asString(entry))
      .filter((entry): entry is string => Boolean(entry));
    const detail = truncate(query);
    const message = truncate(queryList.length > 0 ? queryList.join("\n") : actionType ? JSON.stringify(action) : undefined);
    push(events, "codex", index, itemId ?? "web-search", {
      kind: !isCompleted ? "tool.started" : "tool.completed",
      title: !isCompleted ? "Web search started" : "Web search completed",
      detail,
      message: isCompleted ? message : undefined,
      status: status ?? (!isCompleted ? "in_progress" : "completed"),
      toolCallId: itemId,
      toolName: "web_search"
    });
    return;
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item?.changes) ? item.changes : [];
    changes.forEach((change, changeIndex) => {
      const record = asRecord(change);
      const filePath = asString(record?.path);
      const fileChangeKind = asString(record?.kind);
      const isStarted = !isCompleted;
      push(events, "codex", index, `${itemId ?? "file-change"}-${changeIndex}`, {
        kind: "file.changed",
        title: isStarted
          ? fileChangeKind
            ? `File ${fileChangeKind} started`
            : "File change started"
          : fileChangeKind
            ? `File ${fileChangeKind}`
            : "File changed",
        detail: filePath,
        status: status ?? (isStarted ? "in_progress" : "completed"),
        toolCallId: itemId,
        filePath,
        fileChangeKind
      });
    });
    return;
  }

  push(events, "codex", index, itemId ?? "unknown-item", {
    kind: "unknown",
    title: itemType ? `Unknown Codex item: ${itemType}` : "Unknown Codex item",
    status,
    toolCallId: itemId
  });
}

function parseClaudeEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[]): void {
  const type = asString(raw.type);
  const sessionId = asString(raw.session_id);

  if (type === "system") {
    parseClaudeSystemEvent(raw, index, events, sessionId);
    return;
  }
  if (type === "stream_event") {
    parseClaudeStreamEvent(raw, index, events, sessionId);
    return;
  }
  if (type === "assistant") {
    parseClaudeAssistantEvent(raw, index, events, sessionId);
    return;
  }
  if (type === "user") {
    parseClaudeUserEvent(raw, index, events, sessionId);
    return;
  }
  if (type === "result") {
    parseClaudeResultEvent(raw, index, events, sessionId);
    return;
  }

  push(events, "claude", index, "unknown", {
    kind: "unknown",
    title: type ? `Unknown Claude event: ${type}` : "Unknown Claude event",
    sessionId
  });
}

function parseClaudeSystemEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[], sessionId?: string): void {
  const subtype = asString(raw.subtype);
  if (subtype === "init") {
    push(events, "claude", index, "init", {
      kind: "run.started",
      title: "Claude session started",
      detail: asString(raw.model),
      sessionId
    });
    return;
  }
  if (subtype === "status") {
    const status = asString(raw.status);
    push(events, "claude", index, "status", {
      kind: "run.status",
      title: status ? `Claude status: ${status}` : "Claude status",
      status,
      sessionId
    });
    return;
  }
  if (subtype === "task_started") {
    push(events, "claude", index, asString(raw.task_id) ?? "task-started", {
      kind: "subtask.started",
      title: asString(raw.description) ?? "Subtask started",
      status: asString(raw.status),
      sessionId,
      toolCallId: asString(raw.tool_use_id),
      toolName: asString(raw.task_type)
    });
    return;
  }
  if (subtype === "task_progress") {
    push(events, "claude", index, asString(raw.task_id) ?? "task-progress", {
      kind: "subtask.progress",
      title: asString(raw.description) ?? "Subtask progress",
      detail: asString(raw.last_tool_name),
      sessionId,
      toolCallId: asString(raw.tool_use_id),
      usage: asRecord(raw.usage)
    });
    return;
  }
  if (subtype === "task_notification") {
    const status = asString(raw.status);
    push(events, "claude", index, asString(raw.task_id) ?? "task-notification", {
      kind: "subtask.completed",
      title: asString(raw.summary) ?? "Subtask completed",
      status,
      sessionId,
      toolCallId: asString(raw.tool_use_id),
      usage: asRecord(raw.usage)
    });
    return;
  }
  push(events, "claude", index, "unknown-system", {
    kind: "unknown",
    title: subtype ? `Unknown Claude system event: ${subtype}` : "Unknown Claude system event",
    sessionId
  });
}

function parseClaudeStreamEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[], sessionId?: string): void {
  const event = asRecord(raw.event);
  const streamType = asString(event?.type);
  if (streamType === "message_start") {
    const message = asRecord(event?.message);
    push(events, "claude", index, "message-start", {
      kind: "assistant.message",
      title: "Assistant message started",
      sessionId,
      messageId: asString(message?.id),
      usage: asRecord(message?.usage)
    });
    return;
  }
  if (streamType === "content_block_delta") {
    const delta = asRecord(event?.delta);
    if (asString(delta?.type) === "text_delta") {
      push(events, "claude", index, "text-delta", {
        kind: "assistant.message.delta",
        title: "Assistant message delta",
        message: asString(delta?.text),
        sessionId
      });
    }
    return;
  }
  if (streamType === "message_delta") {
    const delta = asRecord(event?.delta);
    const usage = asRecord(event?.usage);
    push(events, "claude", index, "message-delta", {
      kind: "assistant.message",
      title: "Assistant message completed",
      status: asString(delta?.stop_reason),
      sessionId,
      usage
    });
    if (usage) {
      push(events, "claude", index, "usage", {
        kind: "usage.reported",
        title: "Usage reported",
        status: asString(delta?.stop_reason),
        sessionId,
        usage
      });
    }
  }
}

function parseClaudeAssistantEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[], sessionId?: string): void {
  const message = asRecord(raw.message);
  const messageId = asString(message?.id);
  const content = Array.isArray(message?.content) ? message.content : [];

  content.forEach((block, blockIndex) => {
    const record = asRecord(block);
    if (!record) {
      return;
    }
    const type = asString(record?.type);
    if (type === "text") {
      push(events, "claude", index, `text-${blockIndex}`, {
        kind: "assistant.message",
        title: "Assistant message",
        message: asString(record?.text),
        sessionId,
        messageId,
        usage: asRecord(message?.usage)
      });
    } else if (type === "tool_use") {
      const toolName = asString(record?.name);
      push(events, "claude", index, asString(record?.id) ?? `tool-${blockIndex}`, {
        kind: "tool.started",
        title: toolName ? `${toolName} started` : "Tool started",
        detail: truncate(JSON.stringify(record.input ?? {})),
        sessionId,
        messageId,
        toolCallId: asString(record?.id),
        parentToolCallId: asString(raw.parent_tool_use_id) ?? null,
        toolName
      });
    }
  });
}

function parseClaudeUserEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[], sessionId?: string): void {
  const message = asRecord(raw.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  content.forEach((block, blockIndex) => {
    const record = asRecord(block);
    if (!record) {
      return;
    }
    if (asString(record?.type) !== "tool_result") {
      return;
    }
    const result = raw.tool_use_result;
    const isFailed =
      typeof result === "string"
        ? result.toLowerCase().startsWith("error:")
        : isRecord(result) && result.interrupted === true;
    push(events, "claude", index, asString(record?.tool_use_id) ?? `tool-result-${blockIndex}`, {
      kind: isFailed ? "tool.failed" : "tool.completed",
      title: isFailed ? "Tool failed" : "Tool completed",
      message: truncate(typeof record.content === "string" ? record.content : JSON.stringify(record.content ?? "")),
      sessionId,
      toolCallId: asString(record?.tool_use_id),
      parentToolCallId: asString(raw.parent_tool_use_id) ?? null,
      status: isFailed ? "failed" : "completed"
    });
  });
}

function parseClaudeResultEvent(raw: JsonObject, index: number, events: NormalizedAgentEvent[], sessionId?: string): void {
  const isError = raw.is_error === true || asString(raw.subtype) !== "success";
  const usage = asRecord(raw.usage);
  const metrics: Record<string, unknown> = {};
  for (const key of ["duration_ms", "duration_api_ms", "ttft_ms", "num_turns", "total_cost_usd", "terminal_reason", "stop_reason"]) {
    if (raw[key] !== undefined) {
      metrics[key] = raw[key];
    }
  }

  push(events, "claude", index, "result", {
    kind: isError ? "run.failed" : "run.completed",
    title: isError ? "Claude run failed" : "Claude run completed",
    message: asString(raw.result),
    status: asString(raw.subtype),
    sessionId,
    usage,
    metrics
  });
  if (usage) {
    push(events, "claude", index, "result-usage", {
      kind: "usage.reported",
      title: "Final usage reported",
      status: asString(raw.subtype),
      sessionId,
      usage,
      metrics
    });
  }
}
