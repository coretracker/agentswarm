import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
  DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
  DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE
} from "@verft/shared-types";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import { resolveCreateTaskProviderConfig } from "../lib/task-create-defaults.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { UserStore } from "../services/user-store.js";
import type { SlackIdentityStore } from "../services/slack-identity-store.js";
import type { AssistantSessionStore } from "../services/assistant-session-store.js";
import type { AssistantRuntimeService } from "../services/assistant-runtime-service.js";
import type { AssistantPolicyStore } from "../services/assistant-policy-store.js";
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

interface SlackDirectMessage {
  externalId: string;
  teamId: string;
  channelId: string;
  messageTs: string;
  author: string;
  body: string;
}

type SlackPromptKind = "initial" | "feedback";

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

const normalizeSlackDirectMessage = (payload: unknown): SlackDirectMessage | null => {
  if (!isRecord(payload) || stringValue(payload, "type") !== "event_callback") return null;
  const teamId = stringValue(payload, "team_id");
  const eventId = stringValue(payload, "event_id");
  const event = isRecord(payload.event) ? payload.event : null;
  if (!teamId || !event || stringValue(event, "type") !== "message" || stringValue(event, "channel_type") !== "im") return null;
  if (stringValue(event, "bot_id") || stringValue(event, "subtype")) return null;
  const channelId = stringValue(event, "channel");
  const messageTs = stringValue(event, "ts");
  const author = stringValue(event, "user");
  const body = stringValue(event, "text");
  if (!eventId || !channelId || !messageTs || !author || !body) return null;
  return { externalId: `slack:event:${teamId}:${eventId}`, teamId, channelId, messageTs, author, body };
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
  threadTs?: string;
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
    body: JSON.stringify({ channel: input.channelId, ...(input.threadTs ? { thread_ts: input.threadTs } : {}), text: input.text })
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

const findRepositoryForSlackFeedback = async (
  repositoryStore: RepositoryStore,
  feedback: SlackFeedback,
  repositoryId?: string
) => {
  const repositories = await repositoryStore.listRepositories();
  const matches = repositories.filter((repository) => repository.slackChannelId === feedback.channelId);
  if (repositoryId) {
    const pathRepository = await repositoryStore.getRepository(repositoryId);
    if (!pathRepository) {
      return { repository: null, error: { statusCode: 404, body: { message: "Repository not found" } } };
    }
    if (matches.length === 0) {
      return { repository: null, error: { statusCode: 202, body: { queued: false, reason: "wrong_slack_channel" } } };
    }
    const matchedPathRepository = matches.find((repository) => repository.id === repositoryId);
    if (matchedPathRepository) {
      return { repository: matchedPathRepository, error: null };
    }
    return { repository: null, error: { statusCode: 202, body: { queued: false, reason: "wrong_slack_channel" } } };
  }

  if (matches.length === 1) {
    return { repository: matches[0]!, error: null };
  }
  if (matches.length > 1) {
    return { repository: null, error: { statusCode: 409, body: { message: "Multiple repositories are configured for this Slack channel." } } };
  }
  return { repository: null, error: { statusCode: 202, body: { queued: false, reason: "unmapped_slack_channel" } } };
};

export const registerSlackWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    settingsStore: SettingsStore;
    spawner: SpawnerService;
    userStore?: UserStore;
    slackIdentityStore?: SlackIdentityStore;
    assistantSessionStore?: AssistantSessionStore;
    assistantRuntimeService?: AssistantRuntimeService;
    assistantPolicyStore?: AssistantPolicyStore;
  }
): void => {
  const handleSlackEvent = async (request: RawBodyRequest & { params?: { repositoryId?: string } }, reply: FastifyReply) => {
    const credentials = await deps.settingsStore.getRuntimeCredentials();
    if (!credentials.slackSigningSecret) {
      return reply.status(409).send({ message: "Slack signing secret is not configured." });
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? "";
    if (
      !verifySlackSignature(
        rawBody,
        readHeader(request.headers["x-slack-request-timestamp"]),
        readHeader(request.headers["x-slack-signature"]),
        credentials.slackSigningSecret
      )
    ) {
      return reply.status(401).send({ message: "Invalid Slack webhook signature." });
    }

    if (isRecord(request.body) && stringValue(request.body, "type") === "url_verification") {
      return reply.send({ challenge: stringValue(request.body, "challenge") ?? "" });
    }
    if (!credentials.slackBotToken) {
      return reply.status(409).send({ message: "Slack bot token is not configured." });
    }

    const directMessage = normalizeSlackDirectMessage(request.body);
    if (directMessage) {
      if (!deps.userStore || !deps.slackIdentityStore || !deps.assistantSessionStore || !deps.assistantRuntimeService || !deps.assistantPolicyStore) {
        return reply.status(202).send({ queued: false, reason: "assistant_disabled" });
      }
      const policy = await deps.assistantPolicyStore.get();
      if (!policy.enabled) return reply.status(202).send({ queued: false, reason: "assistant_disabled" });
      const userId = await deps.slackIdentityStore.findActiveUserId(directMessage.teamId, directMessage.author);
      if (!userId) {
        await postSlackThreadReply({
          botToken: credentials.slackBotToken,
          channelId: directMessage.channelId,
          text: "Slack assistant access is not linked. Add this workspace ID and user ID in your Verft profile."
        }).catch(() => false);
        return reply.status(202).send({ queued: false, reason: "unlinked_user" });
      }
      const user = await deps.userStore.getAuthSessionUser(userId);
      if (!user?.active) return reply.status(202).send({ queued: false, reason: "inactive_user" });
      const settings = await deps.settingsStore.getSettings();
      const provider = user.defaultProvider ?? settings.defaultProvider;
      if (
        !policy.allowedProviders.includes(provider) ||
        (user.allowedProviders.length > 0 && !user.allowedProviders.includes(provider))
      ) {
        return reply.status(202).send({ queued: false, reason: "provider_not_allowed" });
      }
      if (
        user.defaultModel &&
        ((policy.allowedModels.length > 0 && !policy.allowedModels.includes(user.defaultModel)) ||
          (user.allowedModels.length > 0 && !user.allowedModels.includes(user.defaultModel)))
      ) {
        return reply.status(202).send({ queued: false, reason: "model_not_allowed" });
      }
      const effort = user.defaultProviderProfile ?? (provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort);
      if (user.allowedEfforts.length > 0 && !user.allowedEfforts.includes(effort)) {
        return reply.status(202).send({ queued: false, reason: "effort_not_allowed" });
      }
      const session = await deps.assistantSessionStore.getOrCreateActiveSession({
        userId,
        slackTeamId: directMessage.teamId,
        slackChannelId: directMessage.channelId,
        slackUserId: directMessage.author,
        provider,
        model: user.defaultModel,
        effort
      });
      if (
        !policy.allowedProviders.includes(session.provider) ||
        (session.model && policy.allowedModels.length > 0 && !policy.allowedModels.includes(session.model))
      ) {
        return reply.status(202).send({ queued: false, reason: "session_configuration_not_allowed" });
      }
      const recentEvents = await deps.assistantSessionStore.listEvents(userId, session.id, 500);
      if (recentEvents.some((event) => event.metadata.externalId === directMessage.externalId)) {
        return reply.status(202).send({ queued: false, reason: "duplicate", sessionId: session.id });
      }
      void deps.assistantRuntimeService.respond(user, session, directMessage.body, directMessage.externalId)
        .then((text) => postSlackThreadReply({ botToken: credentials.slackBotToken, channelId: directMessage.channelId, text }))
        .catch(() => postSlackThreadReply({
          botToken: credentials.slackBotToken,
          channelId: directMessage.channelId,
          text: "The assistant runtime failed. Review the session log in your Verft profile."
        }))
        .catch(() => false);
      return reply.status(202).send({ queued: true, sessionId: session.id });
    }

    const feedback = normalizeSlackFeedback(request.body);
    if (!feedback) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    const repositoryResult = await findRepositoryForSlackFeedback(deps.repositoryStore, feedback, request.params?.repositoryId);
    if (repositoryResult.error) {
      return reply.status(repositoryResult.error.statusCode).send(repositoryResult.error.body);
    }
    const repository = repositoryResult.repository!;

    const existingTask = await deps.taskStore.findTaskBySlackThread(repository.id, feedback.channelId, feedback.threadTs);
    if (!existingTask) {
      if (!feedback.isRootMessage) {
        return reply.status(202).send({ queued: false, reason: "linked_task_not_found" });
      }
      const ownerUserId = repository.slackTaskOwnerUserId?.trim() || null;
      if (!ownerUserId) {
        await postSlackThreadReply({
          botToken: credentials.slackBotToken,
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
        botToken: credentials.slackBotToken,
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
      botToken: credentials.slackBotToken,
      channelId: feedback.channelId,
      threadTs: feedback.threadTs,
      text: isTaskCurrentlyWorking(existingTask.executionStatus)
        ? "I’m currently working on this task. I queued your latest message and will handle it next."
        : "Queued your message for this task."
    }).catch(() => false);

    return reply.status(202).send({ queued: true, taskId: existingTask.id, messageId: message?.id ?? null });
  };

  app.post("/slack/events", async (request, reply) => handleSlackEvent(request as RawBodyRequest & { params?: { repositoryId?: string } }, reply));
  app.post<{ Params: { repositoryId: string } }>("/slack/events/:repositoryId", async (request, reply) =>
    handleSlackEvent(request as RawBodyRequest & { params: { repositoryId: string } }, reply)
  );
};
