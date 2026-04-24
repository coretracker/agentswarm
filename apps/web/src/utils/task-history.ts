import {
  getTaskTerminalSessionEndMessage,
  getTaskTerminalSessionReviewMessage,
  getTaskTerminalSessionStartMessage,
  type TaskAction,
  type TaskChangeProposal,
  type TaskMessage,
  type TaskRun
} from "@agentswarm/shared-types";

type RawMessageHistoryEntry = {
  key: string;
  kind: "message";
  timestamp: string;
  message: TaskMessage;
};

type RawRunHistoryEntry = {
  key: string;
  kind: "run";
  timestamp: string;
  run: TaskRun;
};

type RawProposalHistoryEntry = {
  key: string;
  kind: "proposal";
  timestamp: string;
  proposal: TaskChangeProposal;
};

export type GroupedAutoRunHistoryEntry = {
  key: string;
  kind: "grouped_auto_run";
  timestamp: string;
  run: TaskRun;
  promptMessage: TaskMessage | null;
  summaryMessage: TaskMessage | null;
  proposal: TaskChangeProposal | null;
};

export type GroupedTerminalHistoryEntry = {
  key: string;
  kind: "grouped_terminal_session";
  timestamp: string;
  sessionId: string | null;
  startMessage: TaskMessage;
  endMessage: TaskMessage | null;
  proposal: TaskChangeProposal | null;
  active: boolean;
};

export type TaskHistoryEntry =
  | RawMessageHistoryEntry
  | RawRunHistoryEntry
  | RawProposalHistoryEntry
  | GroupedAutoRunHistoryEntry
  | GroupedTerminalHistoryEntry;

export const INTERACTIVE_TERMINAL_START_MESSAGE = getTaskTerminalSessionStartMessage("interactive");
export const INTERACTIVE_TERMINAL_END_REVIEW_MESSAGE = getTaskTerminalSessionReviewMessage("interactive");
export const INTERACTIVE_TERMINAL_END_PREFIX = getTaskTerminalSessionEndMessage("interactive").replace(/\.$/, "");
export const GIT_TERMINAL_START_MESSAGE = getTaskTerminalSessionStartMessage("git");
export const LEGACY_GIT_TERMINAL_START_MESSAGE = "Git terminal session started.";
export const GIT_TERMINAL_END_REVIEW_MESSAGE = getTaskTerminalSessionReviewMessage("git");
export const GIT_TERMINAL_END_PREFIX = getTaskTerminalSessionEndMessage("git").replace(/\.$/, "");

type AutoRunAction = Extract<TaskAction, "ask" | "build">;

function compareIso(leftTimestamp: string, rightTimestamp: string, leftKey: string, rightKey: string): number {
  if (leftTimestamp === rightTimestamp) {
    return leftKey.localeCompare(rightKey);
  }

  return leftTimestamp.localeCompare(rightTimestamp);
}

function isAutoRunAction(action: TaskRun["action"]): action is AutoRunAction {
  return action === "ask" || action === "build";
}

function isAutoPromptMessage(message: TaskMessage): message is TaskMessage & { role: "user"; action: AutoRunAction } {
  return message.role === "user" && (message.action === "ask" || message.action === "build");
}

function isAssistantSummaryMessage(message: TaskMessage): message is TaskMessage & { role: "assistant"; action: AutoRunAction } {
  return message.role === "assistant" && (message.action === "ask" || message.action === "build");
}

function isInteractiveTerminalStartMessage(message: TaskMessage): boolean {
  return (
    message.role === "system" &&
    (
      message.content === INTERACTIVE_TERMINAL_START_MESSAGE ||
      message.content === GIT_TERMINAL_START_MESSAGE ||
      message.content === LEGACY_GIT_TERMINAL_START_MESSAGE
    )
  );
}

function isInteractiveTerminalEndMessage(message: TaskMessage): boolean {
  return (
    message.role === "system" &&
    (message.content.startsWith(INTERACTIVE_TERMINAL_END_PREFIX) || message.content.startsWith(GIT_TERMINAL_END_PREFIX))
  );
}

export function buildTaskHistoryEntries(input: {
  messages: TaskMessage[];
  runs: TaskRun[];
  proposals: TaskChangeProposal[];
  interactiveTerminalRunning?: boolean;
}): TaskHistoryEntry[] {
  const sortedMessages = [...input.messages].sort((left, right) =>
    compareIso(left.createdAt, right.createdAt, left.id, right.id)
  );
  const sortedRuns = [...input.runs].sort((left, right) => compareIso(left.startedAt, right.startedAt, left.id, right.id));
  const sortedProposals = [...input.proposals].sort((left, right) =>
    compareIso(left.createdAt, right.createdAt, left.id, right.id)
  );

  const consumedMessageIds = new Set<string>();
  const consumedRunIds = new Set<string>();
  const consumedProposalIds = new Set<string>();
  const groupedAutoEntries: GroupedAutoRunHistoryEntry[] = [];
  const groupedTerminalEntries: GroupedTerminalHistoryEntry[] = [];

  const autoPromptCandidates = sortedMessages.filter(isAutoPromptMessage);
  const autoAssistantCandidates = sortedMessages.filter(isAssistantSummaryMessage);
  const promptQueues: Record<AutoRunAction, TaskMessage[]> = { ask: [], build: [] };
  let promptCursor = 0;

  const buildProposalByRunId = new Map<string, TaskChangeProposal>();
  for (const proposal of sortedProposals) {
    if (proposal.sourceType !== "build_run") {
      continue;
    }
    if (!buildProposalByRunId.has(proposal.sourceId)) {
      buildProposalByRunId.set(proposal.sourceId, proposal);
    }
  }

  for (const run of sortedRuns) {
    if (!isAutoRunAction(run.action)) {
      continue;
    }

    while (promptCursor < autoPromptCandidates.length && autoPromptCandidates[promptCursor]!.createdAt <= run.startedAt) {
      const candidate = autoPromptCandidates[promptCursor]!;
      if (!consumedMessageIds.has(candidate.id)) {
        promptQueues[candidate.action].push(candidate);
      }
      promptCursor += 1;
    }

    const promptMessage = promptQueues[run.action].shift() ?? null;
    if (promptMessage) {
      consumedMessageIds.add(promptMessage.id);
    }

    let summaryMessage: TaskMessage | null = null;
    const normalizedRunSummary = run.summary?.trim() ?? "";
    if (normalizedRunSummary) {
      const summaryThreshold = run.finishedAt ?? run.startedAt;
      summaryMessage =
        autoAssistantCandidates.find(
          (message) =>
            !consumedMessageIds.has(message.id) &&
            message.action === run.action &&
            message.createdAt >= summaryThreshold &&
            message.content.trim() === normalizedRunSummary
        ) ?? null;

      if (summaryMessage) {
        consumedMessageIds.add(summaryMessage.id);
      }
    }

    const proposal = buildProposalByRunId.get(run.id) ?? null;
    if (proposal) {
      consumedProposalIds.add(proposal.id);
    }

    consumedRunIds.add(run.id);
    groupedAutoEntries.push({
      key: `grouped-auto-${run.id}`,
      kind: "grouped_auto_run",
      timestamp: run.startedAt,
      run,
      promptMessage,
      summaryMessage,
      proposal
    });
  }

  const terminalStartMessages = sortedMessages.filter(isInteractiveTerminalStartMessage);
  const terminalEndMessages = sortedMessages.filter(isInteractiveTerminalEndMessage);
  const interactiveProposals = sortedProposals.filter((proposal) => proposal.sourceType === "interactive_session");
  const lastTerminalStartMessageId = terminalStartMessages.at(-1)?.id ?? null;
  const interactiveProposalsBySessionId = new Map<string, TaskChangeProposal>();
  for (const proposal of interactiveProposals) {
    if (!interactiveProposalsBySessionId.has(proposal.sourceId)) {
      interactiveProposalsBySessionId.set(proposal.sourceId, proposal);
    }
  }
  let terminalEndCursor = 0;
  let interactiveProposalCursor = 0;

  for (const startMessage of terminalStartMessages) {
    if (consumedMessageIds.has(startMessage.id)) {
      continue;
    }

    while (
      terminalEndCursor < terminalEndMessages.length &&
      (consumedMessageIds.has(terminalEndMessages[terminalEndCursor]!.id) ||
        terminalEndMessages[terminalEndCursor]!.createdAt < startMessage.createdAt)
    ) {
      terminalEndCursor += 1;
    }

    const startSessionId = typeof startMessage.sessionId === "string" && startMessage.sessionId.trim().length > 0 ? startMessage.sessionId : null;
    let endMessage: TaskMessage | null = null;

    if (startSessionId) {
      endMessage =
        terminalEndMessages.find(
          (message) =>
            !consumedMessageIds.has(message.id) &&
            message.createdAt >= startMessage.createdAt &&
            message.sessionId === startSessionId
        ) ?? null;
    } else {
      endMessage = terminalEndCursor < terminalEndMessages.length ? terminalEndMessages[terminalEndCursor]! : null;
    }

    if (!endMessage) {
      if (input.interactiveTerminalRunning && startMessage.id === lastTerminalStartMessageId) {
        consumedMessageIds.add(startMessage.id);
        groupedTerminalEntries.push({
          key: `grouped-terminal-${startMessage.id}`,
          kind: "grouped_terminal_session",
          timestamp: startMessage.createdAt,
          sessionId: startSessionId,
          startMessage,
          endMessage: null,
          proposal: null,
          active: true
        });
      }
      continue;
    }

    terminalEndCursor += 1;
    consumedMessageIds.add(startMessage.id);
    consumedMessageIds.add(endMessage.id);

    const endSessionId = typeof endMessage.sessionId === "string" && endMessage.sessionId.trim().length > 0 ? endMessage.sessionId : null;
    let sessionId = startSessionId ?? endSessionId;
    let proposal: TaskChangeProposal | null = null;
    if (endMessage.content === INTERACTIVE_TERMINAL_END_REVIEW_MESSAGE || endMessage.content === GIT_TERMINAL_END_REVIEW_MESSAGE) {
      if (sessionId) {
        const matchedProposal = interactiveProposalsBySessionId.get(sessionId) ?? null;
        if (matchedProposal && !consumedProposalIds.has(matchedProposal.id)) {
          proposal = matchedProposal;
          consumedProposalIds.add(matchedProposal.id);
        }
      }

      if (!proposal) {
        while (
          interactiveProposalCursor < interactiveProposals.length &&
          (consumedProposalIds.has(interactiveProposals[interactiveProposalCursor]!.id) ||
            interactiveProposals[interactiveProposalCursor]!.createdAt < endMessage.createdAt)
        ) {
          interactiveProposalCursor += 1;
        }

        proposal = interactiveProposalCursor < interactiveProposals.length ? interactiveProposals[interactiveProposalCursor]! : null;
        if (proposal) {
          consumedProposalIds.add(proposal.id);
          interactiveProposalCursor += 1;
        }
      }
    }

    sessionId = sessionId ?? proposal?.sourceId ?? null;

    groupedTerminalEntries.push({
      key: `grouped-terminal-${startMessage.id}`,
      kind: "grouped_terminal_session",
      timestamp: startMessage.createdAt,
      sessionId,
      startMessage,
      endMessage,
      proposal,
      active: false
    });
  }

  const rawRuns = sortedRuns.filter((run) => !consumedRunIds.has(run.id));
  const rawRunSummaryKeys = new Set(
    rawRuns.filter((run) => run.summary?.trim()).map((run) => `${run.action}:${run.summary?.trim()}`)
  );

  const rawMessages = sortedMessages.filter((message) => {
    if (consumedMessageIds.has(message.id)) {
      return false;
    }

    if (message.role === "assistant" && message.action) {
      const trimmedContent = message.content.trim();
      if (trimmedContent && rawRunSummaryKeys.has(`${message.action}:${trimmedContent}`)) {
        return false;
      }
    }

    return true;
  });
  const rawProposals = sortedProposals.filter((proposal) => !consumedProposalIds.has(proposal.id));

  return [
    ...groupedAutoEntries,
    ...groupedTerminalEntries,
    ...rawMessages.map(
      (message): RawMessageHistoryEntry => ({
        key: `message-${message.id}`,
        kind: "message",
        timestamp: message.createdAt,
        message
      })
    ),
    ...rawRuns.map(
      (run): RawRunHistoryEntry => ({
        key: `run-${run.id}`,
        kind: "run",
        timestamp: run.startedAt,
        run
      })
    ),
    ...rawProposals.map(
      (proposal): RawProposalHistoryEntry => ({
        key: `proposal-${proposal.id}`,
        kind: "proposal",
        timestamp: proposal.createdAt,
        proposal
      })
    )
  ].sort((left, right) => compareIso(left.timestamp, right.timestamp, left.key, right.key));
}
