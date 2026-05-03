import { env } from "../config/env.js";
import { normalizeProvider } from "../lib/provider-config.js";
import {
  getTaskStatusLabel,
  type AgentProvider,
  type ProviderProfile,
  type RealtimeEvent,
  type Task,
  type TaskAction,
  type TaskChangeProposal,
  type TaskMessage,
  type TaskRun,
  type User
} from "@agentswarm/shared-types";
import type { SchedulerService } from "./scheduler.js";
import type { SettingsStore } from "./settings-store.js";
import type { SpawnerService } from "./spawner.js";
import type { TaskQueueStore } from "./task-queue-store.js";
import type { TaskStore } from "./task-store.js";
import type { UserStore } from "./user-store.js";
import type { FastifyInstance } from "fastify";
import { canUserAccessTask } from "../lib/task-ownership.js";
import { SlackThreadStore } from "./slack-thread-store.js";

type SlackUser = Pick<User, "id" | "name" | "email" | "active">;

type SlackTaskMessageEvent = {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

type SlackBotMessage = {
  channel: string;
  threadTs?: string | null;
  text: string;
};

const trimSlackValue = (value: string | undefined | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const buildTaskLink = (taskId: string): string | null => {
  const base = env.CORS_ORIGIN.trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }

  return `${base}/tasks/${encodeURIComponent(taskId)}`;
};

const fetchSlackUserEmail = async (botToken: string, slackUserId: string): Promise<string | null> => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: {
      Authorization: `Bearer ${botToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Slack user lookup failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    user?: {
      deleted?: boolean;
      profile?: {
        email?: string;
      };
    };
  };

  if (!data.ok) {
    throw new Error(data.error ? `Slack user lookup failed: ${data.error}` : "Slack user lookup failed");
  }

  return trimSlackValue(data.user?.profile?.email);
};

const postSlackMessage = async (botToken: string, message: SlackBotMessage): Promise<{ ts: string | null }> => {
  const payload = {
    channel: message.channel,
    text: message.text,
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
    unfurl_links: false,
    unfurl_media: false
  };

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Slack postMessage failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!data.ok) {
    throw new Error(data.error ? `Slack postMessage failed: ${data.error}` : "Slack postMessage failed");
  }

  return { ts: data.ts ?? null };
};

const formatTaskRootMessage = (task: Task): string =>
  [
    `*AgentSwarm task created:* ${task.title}`,
    `*Status:* ${getTaskStatusLabel(task.status)}`,
    `*Task:* ${buildTaskLink(task.id) ?? task.id}`,
    "",
    "Reply in this thread with a prompt to continue.",
    "Use `build` or `ask` to switch task mode, `config taskType=build provider=claude model=... effort=...`, `accept`, `reject`, `archive`, or `delete`."
  ].join("\n");

const formatTaskStatusMessage = (task: Task): string =>
  [
    `*Status:* ${getTaskStatusLabel(task.status)}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

const formatTaskRunSummary = (task: Task, summary: string | null, errorMessage: string | null): string =>
  [
    "*Final result*",
    summary?.trim() ? truncateText(summary.trim(), 1400) : null,
    errorMessage?.trim() ? `*Error:* ${truncateText(errorMessage.trim(), 1200)}` : null,
    buildTaskLink(task.id) ? `<${buildTaskLink(task.id)}|Open task>` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

const parseConfigUpdates = (text: string): Partial<{
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  codexCredentialSource: "auto" | "profile" | "global";
  branchStrategy: "feature_branch" | "work_on_branch";
  taskType: Task["taskType"];
}> => {
  const tokenPattern =
    /(^|\s)(provider|model|effort|credentials|codexCredentialSource|providerProfile|profile|reasoningEffort|branchStrategy|taskType|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
  const updates: Partial<{
    provider: AgentProvider;
    providerProfile: ProviderProfile;
    modelOverride: string | null;
    codexCredentialSource: "auto" | "profile" | "global";
    branchStrategy: "feature_branch" | "work_on_branch";
    taskType: Task["taskType"];
  }> = {};

  text.replace(tokenPattern, (_match, prefix: string, key: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
    const value = trimSlackValue(doubleQuoted ?? singleQuoted ?? bare) ?? "";
    switch (key.toLowerCase()) {
      case "provider":
        updates.provider = value === "claude" ? "claude" : "codex";
        break;
      case "model":
        updates.modelOverride = value || null;
        break;
      case "effort":
      case "providerprofile":
      case "profile":
        updates.providerProfile =
          value === "low" || value === "medium" || value === "high" || value === "max"
            ? value
            : value === "minimal"
              ? "low"
              : value === "xhigh"
                ? "high"
                : undefined;
        break;
      case "credentials":
      case "codexcredentialsource":
        updates.codexCredentialSource = value === "profile" || value === "global" || value === "auto" ? value : undefined;
        break;
      case "branchstrategy":
        updates.branchStrategy = value === "work_on_branch" ? "work_on_branch" : "feature_branch";
        break;
      case "tasktype":
      case "type":
        updates.taskType = value === "ask" ? "ask" : "build";
        break;
      case "reasoningeffort":
        updates.providerProfile =
          value === "minimal" || value === "low"
            ? "low"
            : value === "medium"
              ? "medium"
              : value === "high" || value === "xhigh"
                ? "high"
                : undefined;
        break;
    }
    return prefix || " ";
  });

  return updates;
};

const parseThreadCommand = (text: string):
  | { kind: "prompt"; content: string }
  | { kind: "build"; content: string }
  | { kind: "ask"; content: string }
  | { kind: "mode"; taskType: Task["taskType"] }
  | { kind: "archive" }
  | { kind: "delete" }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "config"; updates: ReturnType<typeof parseConfigUpdates> }
  | { kind: "noop" } => {
  const normalized = normalizeWhitespace(text.replace(/^<@[^>]+>\s*/, ""));
  if (!normalized) {
    return { kind: "noop" };
  }

  const lower = normalized.toLowerCase();
  if (lower === "archive") {
    return { kind: "archive" };
  }
  if (lower === "delete") {
    return { kind: "delete" };
  }
  if (lower === "accept" || lower === "accept changes") {
    return { kind: "accept" };
  }
  if (lower === "reject" || lower === "reject changes" || lower === "decline" || lower === "decline changes") {
    return { kind: "reject" };
  }
  if (lower === "build" || lower === "build mode" || lower === "switch to build mode" || lower === "set build mode" || lower === "use build mode") {
    return { kind: "mode", taskType: "build" };
  }
  if (lower === "ask" || lower === "ask mode" || lower === "switch to ask mode" || lower === "set ask mode" || lower === "use ask mode") {
    return { kind: "mode", taskType: "ask" };
  }
  if (lower === "build" || lower.startsWith("build ")) {
    return { kind: "build", content: normalizeWhitespace(normalized.slice(5)) };
  }
  if (lower === "ask" || lower.startsWith("ask ")) {
    return { kind: "ask", content: normalizeWhitespace(normalized.slice(3)) };
  }
  if (lower.startsWith("config ") || lower.startsWith("settings ") || /\b(provider|model|effort|credentials|branchstrategy)\s*=/.test(lower)) {
    return { kind: "config", updates: parseConfigUpdates(normalized) };
  }

  return { kind: "prompt", content: normalized };
};

const createTaskControlNote = (action: TaskAction, content?: string): string => {
  const prefix = action === "ask" ? "Ask" : "Build";
  const body = content?.trim() ? ` with prompt: ${truncateText(content.trim(), 200)}` : "";
  return `${prefix} requested from Slack thread${body}.`;
};

const formatChangeProposalMessage = (proposal: TaskChangeProposal): string =>
  [
    `*Checkpoint ${proposal.id}*`,
    `*Status:* ${proposal.status}`,
    `*Files:* ${proposal.changedFiles.length}`,
    proposal.diffStat?.trim() ? truncateText(proposal.diffStat.trim(), 1200) : null,
    buildTaskLink(proposal.taskId) ? `<${buildTaskLink(proposal.taskId)}|Open task>` : null,
    proposal.status === "pending" ? "Reply with `accept` or `reject` to review this checkpoint." : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export class SlackTaskWorkflowService {
  private readonly ignoredSlackMessageIds = new Set<string>();
  private readonly postedRunFinalSummaryIds = new Set<string>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly settingsStore: SettingsStore,
    private readonly taskStore: TaskStore,
    private readonly taskQueueStore: TaskQueueStore,
    private readonly scheduler: SchedulerService,
    private readonly spawner: SpawnerService,
    private readonly userStore: UserStore,
    private readonly threadStore: SlackThreadStore
  ) {}

  async createTaskThread(task: Task, channelId: string): Promise<void> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const botToken = runtimeCredentials.slackBotToken?.trim() || null;
    if (!botToken) {
      return;
    }

    const channel = channelId.trim();
    if (!channel) {
      return;
    }

    const response = await postSlackMessage(botToken, {
      channel,
      text: formatTaskRootMessage(task)
    });
    if (!response.ts) {
      return;
    }

    await this.threadStore.set({
      taskId: task.id,
      channelId: channel,
      threadTs: response.ts,
      rootMessageTs: response.ts,
      lastKnownStatus: task.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  async handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === "task:created" || event.type === "task:updated") {
      await this.handleTaskSnapshot(event.payload);
      return;
    }

    if (event.type === "task:run_updated") {
      await this.handleRunUpdate(event.payload);
      return;
    }

    if (event.type === "task:message") {
      await this.handleTaskMessage(event.payload);
      return;
    }

    if (event.type === "task:message_updated") {
      await this.handleTaskMessageUpdated(event.payload);
      return;
    }

    if (event.type === "task:change_proposal") {
      await this.handleTaskChangeProposal(event.payload);
      return;
    }

    if (event.type === "task:pushed") {
      await this.handleTaskEventText(event.payload.taskId, `Branch pushed: ${event.payload.branchName}`);
      return;
    }

    if (event.type === "task:merged") {
      await this.handleTaskEventText(event.payload.taskId, `Merged ${event.payload.sourceBranch} into ${event.payload.targetBranch}`);
      return;
    }

    if (event.type === "task:deleted") {
      await this.handleTaskDeleted(event.payload.id);
    }
  }

  async handleSlackMessageEvent(payload: SlackTaskMessageEvent): Promise<void> {
    const channel = payload.channel?.trim() ?? "";
    const threadTs = payload.thread_ts?.trim() ?? "";
    const messageTs = payload.ts?.trim() ?? "";
    const text = payload.text?.trim() ?? "";
    const slackUserId = payload.user?.trim() ?? "";

    if (!channel || !threadTs || !messageTs || !text) {
      return;
    }

    if (payload.bot_id || payload.subtype) {
      return;
    }

    const thread = await this.threadStore.getByThread(channel, threadTs);
    if (!thread) {
      return;
    }

    const task = await this.taskStore.getTask(thread.taskId);
    if (!task || task.status === "archived") {
      return;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const botToken = runtimeCredentials.slackBotToken?.trim() || null;
    if (!botToken) {
      return;
    }

    let matchedUser: SlackUser | null = null;
    if (slackUserId) {
      const email = await fetchSlackUserEmail(botToken, slackUserId);
      if (email) {
        const user = await this.userStore.getUserByEmail(email);
        if (user && user.active && canUserAccessTask(user, task)) {
          matchedUser = user as SlackUser;
        }
      }
    }

    if (!matchedUser) {
      return;
    }

    const command = parseThreadCommand(text);
    if (command.kind === "noop") {
      return;
    }

    if (command.kind === "archive") {
      await this.archiveTaskFromSlack(task);
      await this.postThreadMessage(task.id, `Archived by ${matchedUser.name}.`);
      return;
    }

    if (command.kind === "delete") {
      await this.postThreadMessage(task.id, `Deleted by ${matchedUser.name}.`);
      await this.deleteTaskFromSlack(task);
      return;
    }

    if (command.kind === "accept" || command.kind === "reject") {
      const proposals = await this.taskStore.listChangeProposals(task.id);
      const targetProposal =
        command.kind === "accept"
          ? [...proposals].reverse().find((proposal) => proposal.status === "pending" || proposal.status === "reverted") ?? null
          : [...proposals].reverse().find((proposal) => proposal.status === "pending") ?? null;

      if (!targetProposal) {
        await this.postThreadMessage(task.id, "No matching checkpoint is available to review.");
        return;
      }

      const result =
        command.kind === "accept"
          ? await this.spawner.applyChangeProposal(task, targetProposal.id)
          : await this.spawner.rejectChangeProposal(task, targetProposal.id);
      if (!result.ok) {
        await this.postThreadMessage(task.id, result.message);
        return;
      }

      await this.postThreadMessage(
        task.id,
        command.kind === "accept"
          ? `Accepted checkpoint ${targetProposal.id} by ${matchedUser.name}.`
          : `Rejected checkpoint ${targetProposal.id} by ${matchedUser.name}.`
      );
      return;
    }

    if (command.kind === "config") {
      const updates = command.updates;
      if (
        !updates.provider &&
        !updates.providerProfile &&
        !updates.modelOverride &&
        !updates.codexCredentialSource &&
        !updates.branchStrategy &&
        !updates.taskType
      ) {
        await this.postThreadMessage(task.id, "No config changes were found in the message.");
        return;
      }

      const nextProvider = normalizeProvider(updates.provider ?? task.provider);
      const nextProfile = updates.providerProfile ?? task.providerProfile;
      const nextModelOverride = updates.modelOverride !== undefined ? updates.modelOverride : task.modelOverride;
      const nextCredentialSource = updates.codexCredentialSource ?? task.codexCredentialSource ?? "auto";
      const nextBranchStrategy = updates.branchStrategy ?? task.branchStrategy;
      const nextTaskType = updates.taskType ?? task.taskType;

      const updated = await this.taskStore.patchTask(task.id, {
        provider: nextProvider,
        providerProfile: nextProfile,
        modelOverride: nextModelOverride?.trim() || null,
        codexCredentialSource: nextCredentialSource,
        branchStrategy: nextBranchStrategy,
        taskType: nextTaskType,
        branchName:
          nextBranchStrategy === "work_on_branch"
            ? task.baseBranch
            : task.branchStrategy === "work_on_branch"
              ? null
              : task.branchName
      });
      if (!updated) {
        return;
      }

      await this.postThreadMessage(task.id, `Updated config by ${matchedUser.name}.`);
      await this.threadStore.updateStatus(task.id, updated.status);
      return;
    }

    if (command.kind === "mode") {
      const updated = await this.taskStore.patchTask(task.id, {
        taskType: command.taskType
      });
      if (!updated) {
        return;
      }

      await this.postThreadMessage(task.id, `Switched task mode to ${command.taskType} by ${matchedUser.name}.`);
      return;
    }

    const defaultAction: TaskAction = task.taskType === "ask" ? "ask" : "build";
    const action: TaskAction = command.kind === "prompt" ? defaultAction : command.kind === "ask" ? "ask" : "build";
    const promptContent = normalizeWhitespace(command.content || text);
    const taskIsIdle = task.status === "open" || task.status === "done" || task.status === "answered" || task.status === "accepted";
    const canParallelAsk = action === "ask" && (task.status === "building" || task.status === "asking");
    const messageAction = promptContent && (taskIsIdle || canParallelAsk) ? action : "comment";

    const message = await this.taskStore.appendMessage(task.id, {
      role: "user",
      action: messageAction,
      content: promptContent,
      ...(messageAction !== "comment" && promptContent ? { } : {})
    });
    this.ignoredSlackMessageIds.add(message.id);

    if (messageAction === "comment") {
      await this.postThreadMessage(task.id, `${matchedUser.name}: ${truncateText(promptContent, 1200)}`);
      return;
    }

    const accepted = await this.scheduler.triggerAction(task.id, action, promptContent || undefined);
    if (!accepted) {
      await this.postThreadMessage(task.id, `Could not start ${action}. The task may already be running.`);
      return;
    }

    await this.postThreadMessage(task.id, createTaskControlNote(action, promptContent));
  }

  private async handleTaskSnapshot(task: Task): Promise<void> {
    const thread = await this.threadStore.getByTaskId(task.id);
    if (!thread) {
      return;
    }

    if (thread.lastKnownStatus === task.status && task.status !== "archived") {
      return;
    }

    await this.threadStore.updateStatus(task.id, task.status);
    await this.postThreadMessage(task.id, formatTaskStatusMessage(task));
  }

  private async handleRunUpdate(run: TaskRun): Promise<void> {
    const thread = await this.threadStore.getByTaskId(run.taskId);
    if (!thread) {
      return;
    }

    if (!run.finishedAt) {
      return;
    }
    if (this.postedRunFinalSummaryIds.has(run.id)) {
      return;
    }
    if (!run.summary && !run.errorMessage) {
      return;
    }

    const task = await this.taskStore.getTask(run.taskId);
    if (!task) {
      return;
    }

    this.postedRunFinalSummaryIds.add(run.id);
    await this.postThreadMessage(task.id, formatTaskRunSummary(task, run.summary, run.errorMessage));
  }

  private async handleTaskMessage(message: TaskMessage): Promise<void> {
    if (this.ignoredSlackMessageIds.delete(message.id)) {
      return;
    }

    const thread = await this.threadStore.getByTaskId(message.taskId);
    if (!thread) {
      return;
    }

    const content = truncateText(normalizeWhitespace(message.content), 1200);
    if (!content) {
      return;
    }

    if (message.role === "assistant") {
      return;
    }

    if (message.role !== "user") {
      await this.postThreadMessage(message.taskId, content);
      return;
    }

    if (message.action === "comment") {
      await this.postThreadMessage(message.taskId, content);
      return;
    }

    const label = message.action === "ask" ? "Ask" : "Build";
    await this.postThreadMessage(message.taskId, `${label} prompt: ${content}`);
  }

  private async handleTaskMessageUpdated(message: TaskMessage): Promise<void> {
    if (this.ignoredSlackMessageIds.delete(message.id)) {
      return;
    }

    const thread = await this.threadStore.getByTaskId(message.taskId);
    if (!thread) {
      return;
    }

    const content = truncateText(normalizeWhitespace(message.content), 1200);
    if (!content) {
      return;
    }

    await this.postThreadMessage(message.taskId, `Updated message: ${content}`);
  }

  private async handleTaskChangeProposal(proposal: TaskChangeProposal): Promise<void> {
    const thread = await this.threadStore.getByTaskId(proposal.taskId);
    if (!thread) {
      return;
    }

    await this.postThreadMessage(proposal.taskId, formatChangeProposalMessage(proposal));
  }

  private async handleTaskEventText(taskId: string, text: string): Promise<void> {
    const thread = await this.threadStore.getByTaskId(taskId);
    if (!thread) {
      return;
    }

    await this.postThreadMessage(taskId, text);
  }

  private async handleTaskDeleted(taskId: string): Promise<void> {
    const thread = await this.threadStore.getByTaskId(taskId);
    if (!thread) {
      return;
    }

    await this.postThreadMessage(taskId, "Task deleted.");
    await this.threadStore.deleteByTaskId(taskId);
  }

  private async archiveTaskFromSlack(task: Task): Promise<void> {
    await this.spawner.cleanupTaskArtifacts(task);
    await this.taskQueueStore.removeTask(task.id);
    await this.taskStore.archiveTask(task.id);
    await this.taskStore.appendLog(task.id, "Task archived from Slack thread.");
  }

  private async deleteTaskFromSlack(task: Task): Promise<void> {
    await this.spawner.cleanupTaskArtifacts(task);
    await this.taskQueueStore.removeTask(task.id);
    await this.taskStore.deleteTask(task.id);
    await this.threadStore.deleteByTaskId(task.id);
  }

  private async postThreadMessage(taskId: string, text: string): Promise<void> {
    const thread = await this.threadStore.getByTaskId(taskId);
    if (!thread) {
      return;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const botToken = runtimeCredentials.slackBotToken?.trim() || null;
    if (!botToken) {
      return;
    }

    await postSlackMessage(botToken, {
      channel: thread.channelId,
      threadTs: thread.threadTs,
      text
    });
  }
}
