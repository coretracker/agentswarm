import type { NormalizedAgentEvent } from "@verft/shared-types";

export interface TimelineToolCallDisplayItem {
  id: string;
  title: string;
  kind: NormalizedAgentEvent["kind"];
  rawEventIndexStart: number;
  rawEventIndexEnd: number;
  status?: string;
  toolName?: string;
  detail?: string;
  message?: string;
  exitCode?: number | null;
}

export interface TimelineFileChangeDisplayItem {
  id: string;
  title: string;
  rawEventIndex: number;
  filePath?: string;
  fileChangeKind?: string;
  status?: string;
}

export type TimelineDisplayItem =
  | { type: "event"; id: string; event: NormalizedAgentEvent }
  | {
      type: "tool_group";
      id: string;
      title: string;
      status: "in_progress" | "completed" | "failed";
      rawEventIndexStart: number;
      rawEventIndexEnd: number;
      calls: TimelineToolCallDisplayItem[];
      rawEventCount: number;
    }
  | {
      type: "file_group";
      id: string;
      title: string;
      status?: string;
      rawEventIndexStart: number;
      rawEventIndexEnd: number;
      files: TimelineFileChangeDisplayItem[];
      rawEventCount: number;
    };

const isToolEvent = (event: NormalizedAgentEvent): boolean => event.kind.startsWith("tool.");
const isFileChangeEvent = (event: NormalizedAgentEvent): boolean => event.kind === "file.changed";

const toolCallKey = (event: NormalizedAgentEvent): string => event.toolCallId ?? event.id;

const terminalRank = (event: NormalizedAgentEvent): number => {
  if (event.kind === "tool.failed") {
    return 3;
  }
  if (event.kind === "tool.completed") {
    return 2;
  }
  if (event.kind === "tool.started") {
    return 1;
  }
  return 0;
};

const toolGroupStatus = (calls: TimelineToolCallDisplayItem[]): "in_progress" | "completed" | "failed" => {
  if (calls.some((call) => call.kind === "tool.failed" || (call.exitCode != null && call.exitCode !== 0))) {
    return "failed";
  }
  if (calls.some((call) => call.kind === "tool.started" || call.status === "in_progress")) {
    return "in_progress";
  }
  return "completed";
};

const compactToolEvents = (events: NormalizedAgentEvent[]): TimelineToolCallDisplayItem[] => {
  const byToolCallId = new Map<string, { first: NormalizedAgentEvent; latest: NormalizedAgentEvent }>();

  for (const event of events) {
    const key = toolCallKey(event);
    const current = byToolCallId.get(key);
    if (!current) {
      byToolCallId.set(key, { first: event, latest: event });
      continue;
    }

    const shouldReplace =
      terminalRank(event) > terminalRank(current.latest) ||
      (terminalRank(event) === terminalRank(current.latest) && event.rawEventIndex > current.latest.rawEventIndex);
    if (shouldReplace) {
      current.latest = event;
    }
  }

  return Array.from(byToolCallId.entries()).map(([id, { first, latest }]) => ({
    id,
    title: latest.title,
    kind: latest.kind,
    rawEventIndexStart: first.rawEventIndex,
    rawEventIndexEnd: latest.rawEventIndex,
    status: latest.status,
    toolName: latest.toolName,
    detail: latest.detail,
    message: latest.message,
    exitCode: latest.exitCode
  }));
};

const buildToolGroup = (events: NormalizedAgentEvent[]): TimelineDisplayItem | null => {
  if (events.length === 0) {
    return null;
  }

  const calls = compactToolEvents(events);
  const status = toolGroupStatus(calls);
  const firstIndex = Math.min(...events.map((event) => event.rawEventIndex));
  const lastIndex = Math.max(...events.map((event) => event.rawEventIndex));

  return {
    type: "tool_group",
    id: `tool-group-${firstIndex}-${lastIndex}`,
    title: calls.length === 1 ? "Tool used" : "Tools used",
    status,
    rawEventIndexStart: firstIndex,
    rawEventIndexEnd: lastIndex,
    calls,
    rawEventCount: events.length
  };
};

const buildFileGroup = (events: NormalizedAgentEvent[]): TimelineDisplayItem | null => {
  if (events.length === 0) {
    return null;
  }

  const firstIndex = Math.min(...events.map((event) => event.rawEventIndex));
  const lastIndex = Math.max(...events.map((event) => event.rawEventIndex));
  const files = events.map((event) => ({
    id: event.id,
    title: event.title,
    rawEventIndex: event.rawEventIndex,
    filePath: event.filePath,
    fileChangeKind: event.fileChangeKind,
    status: event.status
  }));

  return {
    type: "file_group",
    id: `file-group-${firstIndex}-${lastIndex}`,
    title: files.length === 1 ? "File changed" : "Files changed",
    status: events.at(-1)?.status,
    rawEventIndexStart: firstIndex,
    rawEventIndexEnd: lastIndex,
    files,
    rawEventCount: events.length
  };
};

export function buildTimelineDisplayItems(events: NormalizedAgentEvent[]): TimelineDisplayItem[] {
  const items: TimelineDisplayItem[] = [];
  let toolEvents: NormalizedAgentEvent[] = [];
  let fileEvents: NormalizedAgentEvent[] = [];

  const flushTools = (): void => {
    const group = buildToolGroup(toolEvents);
    if (group) {
      items.push(group);
      toolEvents = [];
    }
  };

  const flushFiles = (): void => {
    const group = buildFileGroup(fileEvents);
    if (group) {
      items.push(group);
      fileEvents = [];
    }
  };

  for (const event of events) {
    if (isToolEvent(event)) {
      flushFiles();
      toolEvents.push(event);
      continue;
    }

    if (isFileChangeEvent(event)) {
      flushTools();
      fileEvents.push(event);
      continue;
    }

    flushTools();
    flushFiles();
    items.push({ type: "event", id: event.id, event });
  }

  flushTools();
  flushFiles();

  return items;
}
