import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
  DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
  DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE,
  type Repository,
  type Task,
  type TaskMessage
} from "@verft/shared-types";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import { resolveCreateTaskProviderConfig } from "../lib/task-create-defaults.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { beginTaskStart } from "../lib/task-start-orchestrator.js";
import { env } from "../config/env.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

interface SlackFeedback {
  externalId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  author: string;
  body: string;
  url: string;
  isRootMessage: boolean;
}

type SlackPromptKind = "initial" | "feedback";
type SlackCommandAction = "help" | "status" | "cancel" | "queue" | "config" | "link";

interface SlackCommand {
  command: string;
  teamId: string;
  channelId: string;
  userId: string;
  text: string;
  threadTs: string | null;
}

const SLACK_API_BASE_URL = "https://slack.com/api";

const readHeader = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const trimmed = value[0]?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");

const stringValue = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const parseFormBody = (rawBody: string): Record<string, string> => {
  const params = new URLSearchParams(rawBody);
  const parsed: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }
  return parsed;
};

const verifySlackSignature = (rawBody: string, timestamp: string | null, signature: string | null, secret: string): boolean => {
  if (!timestamp || !signature?.startsWith("v0=")) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 60 * 5) {
    return false;
  }
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const buildSlackMessageUrl = (channelId: string, messageTs: string): string =>
  `https://slack.com/archives/${encodeURIComponent(channelId)}/p${messageTs.replace(".", "")}`;

const stripBotMention = (body: string): string => body.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

const normalizeSlackFeedback = (payload: unknown): SlackFeedback | null => {
  if (!isRecord(payload)) {
    return null;
  }
  if (stringValue(payload, "type") !== "event_callback") {
    return null;
  }
  const teamId = stringValue(payload, "team_id");
  const event = isRecord(payload.event) ? payload.event : null;
  if (!teamId || !event) {
    return null;
  }
  const eventType = stringValue(event, "type");
  if (eventType !== "app_mention" && eventType !== "message") {
    return null;
  }
  if (stringValue(event, "bot_id") || stringValue(event, "subtype")) {
    return null;
  }
  const channelId = stringValue(event, "channel");
  const messageTs = stringValue(event, "ts");
  const author = stringValue(event, "user");
  const rawBody = stringValue(event, "text") ?? "";
  if (!channelId || !messageTs || !author || rawBody.trim().length === 0) {
    return null;
  }
  const threadTs = stringValue(event, "thread_ts") ?? messageTs;
  if (eventType === "message" && threadTs === messageTs) {
    return null;
  }
  const body = eventType === "app_mention" ? stripBotMention(rawBody) || rawBody : rawBody;
  return {
    externalId: `slack:message:${teamId}:${channelId}:${messageTs}`,
    teamId,
    channelId,
    threadTs,
    messageTs,
    author,
    body,
    url: buildSlackMessageUrl(channelId, messageTs),
    isRootMessage: threadTs === messageTs
  };
};

const normalizeSlackCommand = (payload: unknown): SlackCommand | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const command = stringValue(payload, "command");
  const teamId = stringValue(payload, "team_id");
  const channelId = stringValue(payload, "channel_id");
  const userId = stringValue(payload, "user_id");
  if (!command || !teamId || !channelId || !userId) {
    return null;
  }
  return {
    command,
    teamId,
    channelId,
    userId,
    text: stringValue(payload, "text") ?? "",
    threadTs: stringValue(payload, "thread_ts")
  };
};

const parseSlackCommandText = (text: string): { action: SlackCommandAction; taskId: string | null } => {
  const [rawAction, rawTaskId] = text.trim().split(/\s+/, 2);
  const normalized = rawAction?.toLowerCase();
  if (normalized === "status" || normalized === "cancel" || normalized === "queue" || normalized === "config" || normalized === "link") {
    return { action: normalized, taskId: rawTaskId?.trim() || null };
  }
  return { action: "help", taskId: normalized && normalized !== "help" ? normalized : null };
};

const replaceTemplateMarkers = (template: string, markers: Record<string, string>): string => {
  let rendered = template;
  for (const [marker, value] of Object.entries(markers)) {
    rendered = rendered.replaceAll(`{{${marker}}}`, value);
  }
  return rendered.trim();
};

const buildTemplateMarkers = (feedback: SlackFeedback, repositoryName: string): Record<string, string> => {
  const feedbackBody = feedback.body.trim() || "(No body provided.)";
  return {
    team_id: feedback.teamId,
    channel_id: feedback.channelId,
    thread_ts: feedback.threadTs,
    message_ts: feedback.messageTs,
    author: feedback.author,
    url: feedback.url,
    url_line: feedback.url ? `URL: ${feedback.url}\n` : "",
    feedback_body: feedbackBody,
    task_title: formatNewTaskTitle(feedback),
    repository_name: repositoryName
  };
};

const formatSlackMessage = (
  feedback: SlackFeedback,
  kind: SlackPromptKind,
  repositoryName: string,
  templates: { initial?: string | null; feedback?: string | null }
): string => {
  const template =
    kind === "initial"
      ? templates.initial?.trim() || DEFAULT_SLACK_INITIAL_INSTRUCTIONS
      : templates.feedback?.trim() || DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS;
  return replaceTemplateMarkers(template, buildTemplateMarkers(feedback, repositoryName));
};

const formatNewTaskTitle = (feedback: SlackFeedback): string => {
  const firstLine = feedback.body.trim().split(/\r?\n/, 1)[0]?.trim();
  return firstLine ? `Slack: ${firstLine.slice(0, 100)}` : `Slack thread from <@${feedback.author}>`;
};

const buildTaskUrl = (taskId: string): string => `${env.CORS_ORIGIN.replace(/\/+$/, "")}/tasks/${encodeURIComponent(taskId)}`;

const renderSlackCommandHelp = (repositoryId: string): string =>
  [
    "*Verft commands*",
    "`/verft status <task-id>` - show task state and what to do next.",
    "`/verft cancel <task-id>` - request cancellation for a queued or running task.",
    "`/verft queue <task-id>` - show queued Slack/thread feedback waiting for the task.",
    "`/verft config` - show the Slack integration wiring for this repository.",
    "`/verft link <task-id>` - link a task to the current Slack thread when Slack provides thread context.",
    "",
    `This slash command is wired to repository \`${repositoryId}\`. Slack slash commands usually do not include thread context, so pass a task id when in doubt.`
  ].join("\n");

const summarizePendingMessage = (message: TaskMessage): string => {
  const firstLine = message.content.trim().split(/\r?\n/, 1)[0]?.trim() || "(empty message)";
  return `- ${message.queueSource ?? "user"} ${message.externalId ? `\`${message.externalId}\`` : ""}: ${firstLine.slice(0, 120)}`;
};

const describeNextStep = (task: Task, pendingMessages: TaskMessage[]): string => {
  if (task.status === "archived") {
    return "What to do: this task is archived. Mention Verft in Slack to create a new task, or reopen/create a task in Verft.";
  }
  if (task.hasPendingCheckpoint) {
    return `What to do: review the pending checkpoint in Verft first: ${buildTaskUrl(task.id)}`;
  }
  if (isTaskCurrentlyWorking(task.executionStatus)) {
    return `What to do: wait for the current run to finish, or use \`/verft cancel ${task.id}\` if it is working on the wrong thing. New Slack thread replies will be queued.`;
  }
  if (task.executionStatus === "failed") {
    return `What to do: open the task logs, fix the cause or add corrected instructions in the linked Slack thread, then retry from Verft: ${buildTaskUrl(task.id)}`;
  }
  if (task.executionStatus === "cancelled") {
    return `What to do: add the corrected request in the linked Slack thread or restart the task from Verft: ${buildTaskUrl(task.id)}`;
  }
  if (pendingMessages.length > 0) {
    return "What to do: queued feedback is waiting. It should run next automatically; add more context in the Slack thread only if needed.";
  }
  return "What to do: add your next instruction in the linked Slack thread, or mention Verft in the repository channel to create a new task.";
};

const renderTaskStatus = (task: Task, pendingMessages: TaskMessage[]): string =>
  [
    `*Task* <${buildTaskUrl(task.id)}|${task.id}>`,
    `Status: \`${task.status}\` / \`${task.executionStatus}\`${task.executionAction ? ` (${task.executionAction})` : ""}`,
    `Provider: \`${task.provider}\` / profile \`${task.providerProfile}\` / model \`${task.modelOverride ?? "default"}\``,
    `Queued feedback: ${pendingMessages.length}`,
    task.slackChannelId && task.slackThreadTs
      ? `Slack thread: \`${task.slackChannelId}\` / \`${task.slackThreadTs}\``
      : "Slack thread: not linked",
    describeNextStep(task, pendingMessages)
  ].join("\n");

const renderQueueStatus = (task: Task, pendingMessages: TaskMessage[]): string => {
  if (pendingMessages.length === 0) {
    return [`No queued feedback for task <${buildTaskUrl(task.id)}|${task.id}>.`, describeNextStep(task, pendingMessages)].join("\n");
  }
  const visibleMessages = pendingMessages.slice(0, 5).map(summarizePendingMessage);
  const remainder = pendingMessages.length > visibleMessages.length ? [`- ...and ${pendingMessages.length - visibleMessages.length} more.`] : [];
  return [`Queued feedback for <${buildTaskUrl(task.id)}|${task.id}>:`, ...visibleMessages, ...remainder, describeNextStep(task, pendingMessages)].join("\n");
};

const renderSlackConfig = (repository: Repository, hasSigningSecret: boolean, hasBotToken: boolean): string =>
  [
    `*Slack config for ${repository.name}*`,
    `Channel ID: \`${repository.slackChannelId ?? "not configured"}\``,
    `Signing secret: ${hasSigningSecret ? "configured" : "missing"}`,
    `Bot token: ${hasBotToken ? "configured" : "missing"}`,
    `Task owner for new Slack tasks: \`${repository.slackTaskOwnerUserId ?? "not configured"}\``,
    "",
    !repository.slackChannelId
      ? "What to do: set the Slack Channel ID in the repository settings."
      : !hasSigningSecret
        ? "What to do: paste the Slack app signing secret into the repository settings."
        : !hasBotToken
          ? "What to do: paste a bot token with chat write access into the repository settings."
          : !repository.slackTaskOwnerUserId
            ? "What to do: set a Slack-created task owner so root thread mentions can create Verft tasks."
            : "What to do: configure Slack with the repository event and slash command URLs shown in Verft."
  ].join("\n");

const renderSlackTaskCreatedReply = (template: string | null | undefined, input: { feedback: SlackFeedback; taskId: string }): string => {
  const replacements: Record<string, string> = {
    task_id: input.taskId,
    task_url: buildTaskUrl(input.taskId),
    author: input.feedback.author,
    channel_id: input.feedback.channelId,
    thread_ts: input.feedback.threadTs,
    message_ts: input.feedback.messageTs
  };
  const source = template?.trim() || DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE;
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => replacements[key] ?? match).trim();
};

const postSlackThreadReply = async (input: {
  botToken: string | null | undefined;
  channelId: string;
  threadTs: string;
  text: string;
}): Promise<boolean> => {
  const botToken = input.botToken?.trim();
  if (!botToken || input.text.trim().length === 0) {
    return false;
  }
  const response = await fetch(`${SLACK_API_BASE_URL}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: input.channelId,
      thread_ts: input.threadTs,
      text: input.text
    })
  });
  if (!response.ok) {
    return false;
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  return body?.ok === true;
};

const isTaskCurrentlyWorking = (executionStatus: string): boolean =>
  executionStatus === "queued" || executionStatus === "preparing" || executionStatus === "running";

const maybeStartQueuedSlackFeedback = async (
  deps: { taskStore: TaskStore; scheduler: SchedulerService },
  taskId: string,
  taskExecutionStatus: string,
  message: { id: string; content: string } | null
): Promise<void> => {
  if (!message) {
    return;
  }
  if (taskExecutionStatus === "idle" && !(await deps.taskStore.hasPendingChangeProposal(taskId))) {
    const blocked = await getMutationBlocked(deps.taskStore, taskId);
    if (!blocked) {
      await deps.scheduler.triggerAction(taskId, "build", { content: message.content }, { promptMessageId: message.id });
    }
  } else if (
    (taskExecutionStatus === "failed" || taskExecutionStatus === "cancelled") &&
    !(await deps.taskStore.hasPendingChangeProposal(taskId))
  ) {
    await deps.scheduler.triggerNextPendingAction(taskId, "auto");
  }
};

export const registerSlackWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    settingsStore: SettingsStore;
    spawner: SpawnerService;
  }
): void => {
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (request, body, done) => {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      (request as RawBodyRequest).rawBody = rawBody;
      done(null, parseFormBody(rawBody));
    });
  }

  const resolveSlackCommandTask = async (
    repository: Repository,
    command: SlackCommand,
    taskId: string | null
  ): Promise<{ task: Task | null; error: string | null }> => {
    const task = taskId
      ? await deps.taskStore.getTask(taskId)
      : command.threadTs
        ? await deps.taskStore.findTaskBySlackThread(repository.id, command.channelId, command.threadTs)
        : null;
    if (!task) {
      return {
        task: null,
        error: taskId
          ? `Task \`${taskId}\` was not found. What to do: check the task id or open Verft and copy it from the task URL.`
          : "I could not infer a task from this slash command. What to do: pass a task id, for example `/verft status task-123`."
      };
    }
    if (task.repoId !== repository.id) {
      return {
        task: null,
        error: `Task \`${task.id}\` belongs to a different repository. What to do: use the slash command URL for that repository or choose a task from this repository.`
      };
    }
    return { task, error: null };
  };

  app.post<{ Params: { repositoryId: string } }>("/slack/commands/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send({ response_type: "ephemeral", text: "Repository not found." });
    }

    const secrets = await deps.repositoryStore.getRepositorySlackSecrets(repository.id);
    if (!secrets.signingSecret) {
      return reply.status(409).send({
        response_type: "ephemeral",
        text: "Slack signing secret is not configured. What to do: add it in this repository's Slack integration settings."
      });
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? "";
    if (
      !verifySlackSignature(
        rawBody,
        readHeader(request.headers["x-slack-request-timestamp"]),
        readHeader(request.headers["x-slack-signature"]),
        secrets.signingSecret
      )
    ) {
      return reply.status(401).send({ response_type: "ephemeral", text: "Invalid Slack command signature." });
    }

    const command = normalizeSlackCommand(request.body);
    if (!command) {
      return reply.status(400).send({ response_type: "ephemeral", text: "Invalid Slack command payload." });
    }
    if (repository.slackChannelId && command.channelId !== repository.slackChannelId) {
      return reply.send({
        response_type: "ephemeral",
        text: `This repository listens to channel \`${repository.slackChannelId}\`, not \`${command.channelId}\`. What to do: run the command from the configured repository channel.`
      });
    }
    if (!repository.slackChannelId) {
      return reply.send({
        response_type: "ephemeral",
        text: "Slack Channel ID is not configured. What to do: set it in this repository's Slack integration settings."
      });
    }

    const parsed = parseSlackCommandText(command.text);
    if (parsed.action === "help") {
      return reply.send({ response_type: "ephemeral", text: renderSlackCommandHelp(repository.id) });
    }
    if (parsed.action === "config") {
      return reply.send({
        response_type: "ephemeral",
        text: renderSlackConfig(repository, Boolean(secrets.signingSecret), Boolean(secrets.botToken))
      });
    }

    const { task, error } = await resolveSlackCommandTask(repository, command, parsed.taskId);
    if (!task) {
      return reply.send({ response_type: "ephemeral", text: error ?? "Task not found." });
    }

    if (parsed.action === "link") {
      if (!command.threadTs) {
        return reply.send({
          response_type: "ephemeral",
          text: `Slack did not include thread context for this slash command. What to do: mention Verft in the thread, or use \`/verft status ${task.id}\` and \`/verft cancel ${task.id}\` with the task id.`
        });
      }
      await deps.taskStore.patchTask(task.id, { slackChannelId: command.channelId, slackThreadTs: command.threadTs });
      return reply.send({
        response_type: "ephemeral",
        text: `Linked task <${buildTaskUrl(task.id)}|${task.id}> to this Slack thread. What to do: continue by replying in the thread.`
      });
    }

    const pendingMessages = await deps.taskStore.listPendingActionMessages(task.id);

    if (parsed.action === "status") {
      return reply.send({ response_type: "ephemeral", text: renderTaskStatus(task, pendingMessages) });
    }
    if (parsed.action === "queue") {
      return reply.send({ response_type: "ephemeral", text: renderQueueStatus(task, pendingMessages) });
    }
    if (parsed.action === "cancel") {
      if (task.status === "archived") {
        return reply.send({
          response_type: "ephemeral",
          text: `Task <${buildTaskUrl(task.id)}|${task.id}> is archived and cannot be cancelled. What to do: create a new task or reopen work in Verft.`
        });
      }
      const accepted = await deps.scheduler.cancelTask(task.id);
      return reply.send({
        response_type: "ephemeral",
        text: accepted
          ? `Cancellation requested for task <${buildTaskUrl(task.id)}|${task.id}>. What to do: wait for the run to stop, then add corrected instructions in the Slack thread or Verft.`
          : `Task <${buildTaskUrl(task.id)}|${task.id}> cannot be cancelled in its current state. ${describeNextStep(task, pendingMessages)}`
      });
    }

    return reply.send({ response_type: "ephemeral", text: renderSlackCommandHelp(repository.id) });
  });

  app.post<{ Params: { repositoryId: string } }>("/slack/events/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const secrets = await deps.repositoryStore.getRepositorySlackSecrets(repository.id);
    if (!secrets.signingSecret) {
      return reply.status(409).send({ message: "Slack signing secret is not configured." });
    }
    if (!secrets.botToken) {
      return reply.status(409).send({ message: "Slack bot token is not configured." });
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? "";
    if (
      !verifySlackSignature(
        rawBody,
        readHeader(request.headers["x-slack-request-timestamp"]),
        readHeader(request.headers["x-slack-signature"]),
        secrets.signingSecret
      )
    ) {
      return reply.status(401).send({ message: "Invalid Slack webhook signature." });
    }

    if (isRecord(request.body) && stringValue(request.body, "type") === "url_verification") {
      return reply.send({ challenge: stringValue(request.body, "challenge") ?? "" });
    }

    const feedback = normalizeSlackFeedback(request.body);
    if (!feedback) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    if (!repository.slackChannelId || feedback.channelId !== repository.slackChannelId) {
      return reply.status(202).send({ queued: false, reason: "wrong_slack_channel" });
    }

    const existingTask = await deps.taskStore.findTaskBySlackThread(repository.id, feedback.channelId, feedback.threadTs);
    if (!existingTask) {
      if (!feedback.isRootMessage) {
        return reply.status(202).send({ queued: false, reason: "linked_task_not_found" });
      }
      const ownerUserId = repository.slackTaskOwnerUserId?.trim() || null;
      if (!ownerUserId) {
        await postSlackThreadReply({
          botToken: secrets.botToken,
          channelId: feedback.channelId,
          threadTs: feedback.threadTs,
          text: "I can create a Verft task from this thread after a Slack-created task owner is configured for this repository."
        }).catch(() => false);
        return reply.status(202).send({ queued: false, reason: "missing_slack_task_owner" });
      }

      const content = formatSlackMessage(feedback, "initial", repository.name, {
        initial: repository.slackInitialInstructions,
        feedback: repository.slackFeedbackInstructions
      });
      const settings = await deps.settingsStore.getSettings();
      const createdTask = await deps.taskStore.createTask(
        {
          title: formatNewTaskTitle(feedback),
          draft: true,
          repoId: repository.id,
          prompt: content,
          taskType: "build",
          baseBranch: repository.defaultBranch,
          branchStrategy: "feature_branch",
          autoApplyCheckpoints: true,
          ...resolveCreateTaskProviderConfig({}, settings, repository, null)
        },
        repository,
        ownerUserId
      );
      const openedTask = await deps.taskStore.patchTask(createdTask.id, {
        slackChannelId: feedback.channelId,
        slackThreadTs: feedback.threadTs,
        status: "open",
        workflowStatus: "ready",
        executionStatus: "idle",
        executionAction: "build",
        lastAction: "build"
      });
      if (!openedTask) {
        return reply.status(500).send({ message: "Slack-created task could not be opened." });
      }

      const message = await deps.taskStore.appendMessage(openedTask.id, {
        role: "user",
        action: "build",
        queueState: "pending",
        queueSource: "slack_thread",
        externalId: feedback.externalId,
        content
      });
      if (!message) {
        return reply.status(500).send({ message: "Slack-created task message could not be queued." });
      }

      const startResult = await beginTaskStart(
        {
          taskStore: deps.taskStore,
          scheduler: deps.scheduler,
          spawner: deps.spawner
        },
        {
          task: openedTask,
          action: "build",
          input: { content },
          promptMessageId: message.id,
          fallbackMessage: "Slack-created task start failed"
        }
      );
      if (!startResult.ok) {
        return reply.status(startResult.statusCode).send({ message: startResult.message });
      }

      await postSlackThreadReply({
        botToken: secrets.botToken,
        channelId: feedback.channelId,
        threadTs: feedback.threadTs,
        text: renderSlackTaskCreatedReply(repository.slackTaskCreatedReplyTemplate, { feedback, taskId: openedTask.id })
      }).catch(() => false);
      return reply.status(202).send({ queued: true, taskId: openedTask.id, messageId: message.id, createdTask: true });
    }

    const existingMessages = await deps.taskStore.listMessages(existingTask.id);
    if (existingMessages.some((message) => message.externalId === feedback.externalId)) {
      return reply.status(202).send({ queued: false, reason: "duplicate" });
    }

    const content = formatSlackMessage(feedback, "feedback", repository.name, {
      initial: repository.slackInitialInstructions,
      feedback: repository.slackFeedbackInstructions
    });
    const message = await deps.taskStore.appendMessage(existingTask.id, {
      role: "user",
      action: "build",
      queueState: "pending",
      queueSource: "slack_thread",
      externalId: feedback.externalId,
      content
    });

    await maybeStartQueuedSlackFeedback(deps, existingTask.id, existingTask.executionStatus, message);
    await postSlackThreadReply({
      botToken: secrets.botToken,
      channelId: feedback.channelId,
      threadTs: feedback.threadTs,
      text: isTaskCurrentlyWorking(existingTask.executionStatus)
        ? "I’m currently working on this task. I queued your latest message and will handle it next."
        : "Queued your message for this task."
    }).catch(() => false);

    return reply.status(202).send({ queued: true, taskId: existingTask.id, messageId: message?.id ?? null });
  });
};
