import { createHmac } from "node:crypto";
import { SocketModeClient } from "@slack/socket-mode";
import type { FastifyInstance } from "fastify";
import type { SettingsStore } from "./settings-store.js";
import type { SlackTaskWorkflowService } from "./slack-task-workflow-service.js";
import { appendSlackEventLog } from "../lib/slack-event-log.js";

type SlackSocketModeEnvelope = {
  payload?: Record<string, unknown>;
  body?: Record<string, unknown>;
  ack: (payload?: unknown) => Promise<void>;
};

type SlackSocketModeEventsApiPayload = {
  type?: string;
  event?: {
    type?: string;
    channel?: string;
    thread_ts?: string;
    ts?: string;
    text?: string;
    user?: string;
    bot_id?: string;
    subtype?: string;
    message?: {
      type?: string;
      channel?: string;
      thread_ts?: string;
      ts?: string;
      text?: string;
      user?: string;
      bot_id?: string;
      subtype?: string;
    };
  };
};

type SlackSocketModeMessageEvent = {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

const getEnvelopeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const getEventsApiPayload = (event: SlackSocketModeEnvelope): SlackSocketModeEventsApiPayload | null => {
  const payloadRecord = getEnvelopeRecord(event.payload);
  if (payloadRecord) {
    return payloadRecord as SlackSocketModeEventsApiPayload;
  }

  const bodyRecord = getEnvelopeRecord(event.body);
  if (!bodyRecord) {
    return null;
  }
  const nestedPayload = getEnvelopeRecord(bodyRecord.payload);
  if (nestedPayload) {
    return nestedPayload as SlackSocketModeEventsApiPayload;
  }
  return bodyRecord as SlackSocketModeEventsApiPayload;
};

const normalizeSlackMessageEvent = (rawEvent: NonNullable<SlackSocketModeEventsApiPayload["event"]>): SlackSocketModeMessageEvent | null => {
  if (rawEvent.type !== "message") {
    return null;
  }

  if (rawEvent.subtype === "message_replied" && rawEvent.message && rawEvent.message.type === "message") {
    return {
      ...rawEvent.message,
      channel: rawEvent.channel ?? rawEvent.message.channel
    };
  }

  return rawEvent as SlackSocketModeMessageEvent;
};

const SLACK_SIGNATURE_VERSION = "v0";

const summarizeSlackMessageEvent = (event: SlackSocketModeMessageEvent): Record<string, unknown> => ({
  channel: event.channel ?? null,
  threadTs: event.thread_ts ?? null,
  ts: event.ts ?? null,
  user: event.user ?? null,
  subtype: event.subtype ?? null,
  textPreview: typeof event.text === "string" ? event.text.slice(0, 200) : null
});

const signSlackRequest = (signingSecret: string, timestamp: string, rawBody: string): string =>
  `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`).digest("hex")}`;

const buildFormBody = (fields: Record<string, string>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, value);
  }
  return params.toString();
};

const parseResponsePayload = (body: string): unknown | null => {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { response_type: "ephemeral", text: trimmed };
  }
};

export class SlackSocketModeService {
  private client: SocketModeClient | null = null;
  private syncInFlight: Promise<void> | null = null;
  private activeAppToken: string | null = null;
  private activeSigningSecret: string | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly settingsStore: SettingsStore,
    private readonly workflowService: SlackTaskWorkflowService
  ) {}

  private async writeSlackEventLog(kind: string, data: Record<string, unknown>): Promise<void> {
    await appendSlackEventLog(kind, data);
  }

  async sync(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = (async () => {
      const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
      const appToken = runtimeCredentials.slackSocketModeToken?.trim() || null;
      const botToken = runtimeCredentials.slackBotToken?.trim() || null;
      const signingSecret = runtimeCredentials.slackSigningSecret?.trim() || null;
      await this.writeSlackEventLog("socket_mode:sync", {
        hasAppToken: Boolean(appToken),
        hasBotToken: Boolean(botToken),
        hasSigningSecret: Boolean(signingSecret)
      });

      if (!appToken || !botToken || !signingSecret) {
        await this.writeSlackEventLog("socket_mode:disabled_missing_credentials", {});
        await this.stop();
        return;
      }

      if (this.client && this.activeAppToken === appToken && this.activeSigningSecret === signingSecret) {
        await this.writeSlackEventLog("socket_mode:already_active", {});
        return;
      }

      await this.stop();

      const client = new SocketModeClient({ appToken });
      const registerEvent = client as unknown as {
        on: (event: string, listener: (...args: any[]) => void) => void;
      };
      registerEvent.on("slash_commands", (event: SlackSocketModeEnvelope) => {
        void this.handleSlashCommand(event, signingSecret);
      });
      registerEvent.on("interactive", (event: SlackSocketModeEnvelope) => {
        void this.handleInteractive(event, signingSecret);
      });
      registerEvent.on("events_api", (event: SlackSocketModeEnvelope) => {
        void this.handleEventsApi(event);
      });
      registerEvent.on("error", (error: unknown) => {
        this.app.log.error({ error }, "Slack Socket Mode client error");
      });

      await client.start();
      this.client = client;
      this.activeAppToken = appToken;
      this.activeSigningSecret = signingSecret;
      await this.writeSlackEventLog("socket_mode:started", {});
      this.app.log.info("Slack Socket Mode client started");
    })().catch((error) => {
      void this.writeSlackEventLog("socket_mode:start_error", {
        message: error instanceof Error ? error.message : String(error)
      });
      this.app.log.error({ error }, "Failed to start Slack Socket Mode client");
    }).finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  async stop(): Promise<void> {
    if (!this.client) {
      this.activeAppToken = null;
      this.activeSigningSecret = null;
      return;
    }

    const client = this.client;
    this.client = null;
    this.activeAppToken = null;
    this.activeSigningSecret = null;
    try {
      await client.disconnect();
    } catch (error) {
      this.app.log.warn({ error }, "Failed to disconnect Slack Socket Mode client");
    }
  }

  private async handleSlashCommand(event: SlackSocketModeEnvelope, signingSecret: string): Promise<void> {
    try {
      const body = event.body ?? {};
      const command = typeof body.command === "string" ? body.command : "";
      const text = typeof body.text === "string" ? body.text : "";
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const teamId = typeof body.team_id === "string" ? body.team_id : "";
      const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
      const responseUrl = typeof body.response_url === "string" ? body.response_url : "";
      const triggerId = typeof body.trigger_id === "string" ? body.trigger_id : "";

      const rawBody = buildFormBody({
        command,
        text,
        user_id: userId,
        ...(teamId ? { team_id: teamId } : {}),
        ...(channelId ? { channel_id: channelId } : {}),
        ...(responseUrl ? { response_url: responseUrl } : {}),
        ...(triggerId ? { trigger_id: triggerId } : {})
      });
      const timestamp = `${Math.floor(Date.now() / 1000)}`;
      const response = await this.app.inject({
        method: "POST",
        url: "/slack/commands",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signSlackRequest(signingSecret, timestamp, rawBody)
        },
        payload: rawBody
      });

      const parsed = parseResponsePayload(response.body);
      await event.ack(parsed ?? undefined);
    } catch (error) {
      this.app.log.error({ error }, "Failed to process Slack slash command");
      try {
        await event.ack({
          response_type: "ephemeral",
          text: "Slack command processing failed."
        });
      } catch (ackError) {
        this.app.log.error({ error: ackError }, "Failed to ack Slack slash command error");
      }
    }
  }

  private async handleInteractive(event: SlackSocketModeEnvelope, signingSecret: string): Promise<void> {
    try {
      const body = event.body ?? {};
      const rawBody = buildFormBody({
        payload: JSON.stringify(body)
      });
      const timestamp = `${Math.floor(Date.now() / 1000)}`;
      const response = await this.app.inject({
        method: "POST",
        url: "/slack/interactions",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signSlackRequest(signingSecret, timestamp, rawBody)
        },
        payload: rawBody
      });

      const parsed = parseResponsePayload(response.body);
      await event.ack(parsed ?? undefined);
    } catch (error) {
      this.app.log.error({ error }, "Failed to process Slack interactive payload");
      try {
        await event.ack({
          response_type: "ephemeral",
          text: "Slack interaction processing failed."
        });
      } catch (ackError) {
        this.app.log.error({ error: ackError }, "Failed to ack Slack interaction error");
      }
    }
  }

  private async handleEventsApi(event: SlackSocketModeEnvelope): Promise<void> {
    try {
      await event.ack({});

      const payload = getEventsApiPayload(event);
      const slackEvent = payload?.event;
      if (!slackEvent) {
        await this.writeSlackEventLog("events_api:ignored:no_event", { payloadType: payload?.type ?? null });
        this.app.log.debug({ payloadType: payload?.type }, "Ignored Slack events_api event");
        return;
      }

      const normalizedMessage = normalizeSlackMessageEvent(slackEvent);
      if (!normalizedMessage) {
        await this.writeSlackEventLog("events_api:ignored:non_message", {
          eventType: slackEvent.type ?? null,
          subtype: slackEvent.subtype ?? null
        });
        this.app.log.debug({ eventType: slackEvent.type, subtype: slackEvent.subtype }, "Ignored non-message Slack event");
        return;
      }

      await this.writeSlackEventLog("events_api:message", summarizeSlackMessageEvent(normalizedMessage));
      void this.workflowService.handleSlackMessageEvent(normalizedMessage).catch((error) => {
        void this.writeSlackEventLog("events_api:workflow_error", {
          message: error instanceof Error ? error.message : String(error)
        });
        this.app.log.error({ error }, "Failed to process Slack events_api message");
      });
    } catch (error) {
      await this.writeSlackEventLog("events_api:handler_error", {
        message: error instanceof Error ? error.message : String(error)
      });
      this.app.log.error({ error }, "Failed to process Slack events_api payload");
    }
  }
}
