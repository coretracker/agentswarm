import type { FastifyInstance } from "fastify";
import type { RepositorySlackEventStatus, User } from "@agentswarm/shared-types";
import { verifySlackRequestSignature } from "../lib/slack-signature.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SlackAssistantStore } from "../services/slack-assistant-store.js";
import { SlackAssistantService, type SlackAssistantRuntime } from "../services/slack-assistant-service.js";
import { FetchSlackClient, type SlackClient } from "../services/slack-client.js";
import type { UserStore } from "../services/user-store.js";

type RawBodyRequest = { rawBody?: string };

const readHeader = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    const trimmed = value[0].trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringValue = (record: Record<string, unknown>, key: string): string | null =>
  typeof record[key] === "string" && record[key].trim().length > 0 ? record[key].trim() : null;

const normalizeSlackUsername = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().replace(/^@+/, "").toLowerCase();
  return normalized || null;
};

const findUserBySlackUsername = async (userStore: UserStore, slackUsername: string): Promise<User | null> => {
  const normalized = normalizeSlackUsername(slackUsername);
  if (!normalized) {
    return null;
  }
  const users = await userStore.listUsers();
  return users.find((user) => user.active && normalizeSlackUsername(user.slackUsername) === normalized) ?? null;
};

export const registerSlackEventRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    userStore: UserStore;
    slackAssistantStore: SlackAssistantStore;
    slackClient?: SlackClient;
    runtime?: SlackAssistantRuntime;
  }
): void => {
  const slackClient = deps.slackClient ?? new FetchSlackClient();
  const assistantService = new SlackAssistantService(deps.slackAssistantStore, deps.runtime);

  app.post<{ Params: { repositoryId: string } }>("/repositories/:repositoryId/slack/events", async (request, reply) => {
    const integration = await deps.repositoryStore.getRepositorySlackIntegration(request.params.repositoryId);
    if (!integration) {
      return reply.status(404).send({ message: "Repository Slack integration is not configured." });
    }

    const recordSlackEvent = async (
      status: RepositorySlackEventStatus,
      eventType: string,
      errorMessage?: string | null
    ): Promise<void> => {
      await deps.repositoryStore
        .recordSlackEventResult(integration.repository.id, {
          status,
          receivedAt: new Date().toISOString(),
          eventType,
          errorMessage
        })
        .catch((error) => request.log.warn({ err: error, repositoryId: integration.repository.id }, "slack.event_status.failed"));
    };

    const rawBody = (request as typeof request & RawBodyRequest).rawBody ?? JSON.stringify(request.body ?? {});
    const timestamp = readHeader(request.headers["x-slack-request-timestamp"]);
    const signature = readHeader(request.headers["x-slack-signature"]);
    if (!verifySlackRequestSignature(rawBody, timestamp, signature, integration.signingSecret)) {
      await recordSlackEvent("failed", "request", "invalid_signature");
      return reply.status(401).send({ message: "Invalid Slack request signature." });
    }

    if (readHeader(request.headers["x-slack-retry-num"])) {
      await recordSlackEvent("ignored", "retry", "slack_retry");
      return reply.send({ ok: true, ignored: "retry" });
    }

    const body = isRecord(request.body) ? request.body : {};
    if (body.type === "url_verification") {
      await recordSlackEvent("received", "url_verification");
      return reply.send({ challenge: stringValue(body, "challenge") ?? "" });
    }
    if (body.type !== "event_callback" || !isRecord(body.event)) {
      await recordSlackEvent("ignored", String(body.type ?? "unknown_payload"), "unsupported_payload");
      return reply.send({ ok: true, ignored: "unsupported_payload" });
    }

    const event = body.event;
    if (
      event.type !== "message" ||
      stringValue(event, "channel_type") !== "im" ||
      stringValue(event, "bot_id") ||
      stringValue(event, "subtype")
    ) {
      await recordSlackEvent("ignored", stringValue(event, "type") ?? "unknown_event", "unsupported_event");
      return reply.send({ ok: true, ignored: "unsupported_event" });
    }

    const slackUserId = stringValue(event, "user");
    const slackChannelId = stringValue(event, "channel");
    const text = stringValue(event, "text");
    const slackMessageTs = stringValue(event, "ts");
    const slackTeamId = stringValue(body, "team_id") ?? "unknown-team";
    if (!slackUserId || !slackChannelId || !text) {
      await recordSlackEvent("ignored", "message.im", "missing_message_fields");
      return reply.send({ ok: true, ignored: "missing_message_fields" });
    }

    if (slackMessageTs) {
      slackClient
        .addReaction(integration.botToken, slackChannelId, slackMessageTs, "eyes")
        .catch((error) => request.log.warn({ err: error, repositoryId: integration.repository.id }, "slack.reaction.failed"));
    }

    let profile: Awaited<ReturnType<SlackClient["getUserProfile"]>>;
    try {
      profile = await slackClient.getUserProfile(integration.botToken, slackUserId);
    } catch (error) {
      await recordSlackEvent("failed", "message.im", error instanceof Error ? error.message : "profile_lookup_failed");
      throw error;
    }
    const slackUsername = normalizeSlackUsername(profile?.name);
    const user = slackUsername ? await findUserBySlackUsername(deps.userStore, slackUsername) : null;
    if (!user) {
      await slackClient.postMessage(
        integration.botToken,
        slackChannelId,
        "I could not find an active AgentSwarm profile with this Slack username."
      );
      await recordSlackEvent("ignored", "message.im", "unmatched_user");
      return reply.send({ ok: true, ignored: "unmatched_user" });
    }

    let conversation: Awaited<ReturnType<SlackAssistantStore["getOrCreateConversation"]>>;
    try {
      conversation = await deps.slackAssistantStore.getOrCreateConversation({
        repositoryId: integration.repository.id,
        userId: user.id,
        slackTeamId,
        slackChannelId,
        slackUserId,
        provider: "codex"
      });
      await recordSlackEvent("received", "message.im");
    } catch (error) {
      await recordSlackEvent("failed", "message.im", error instanceof Error ? error.message : "conversation_setup_failed");
      throw error;
    }
    void (async () => {
      try {
        const responseText = await assistantService.handleMessage({
          repository: integration.repository,
          user,
          conversation,
          text
        });
        await slackClient.postMessage(integration.botToken, slackChannelId, responseText);
      } catch (error) {
        request.log.error({ err: error, repositoryId: integration.repository.id }, "slack.assistant.failed");
        await recordSlackEvent("failed", "message.im", error instanceof Error ? error.message : "assistant_failed");
        await slackClient
          .postMessage(integration.botToken, slackChannelId, "I could not complete that Slack assistant run.")
          .catch((postError) => request.log.error({ err: postError }, "slack.assistant.failure_reply_failed"));
      }
    })();

    return reply.send({ ok: true });
  });
};
