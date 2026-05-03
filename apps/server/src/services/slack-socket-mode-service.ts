import { createHmac } from "node:crypto";
import { SocketModeClient } from "@slack/socket-mode";
import type { FastifyInstance } from "fastify";
import type { SettingsStore } from "./settings-store.js";

type SlackSocketModeEnvelope = {
  body?: Record<string, unknown>;
  ack: (payload?: unknown) => Promise<void>;
};

const SLACK_SIGNATURE_VERSION = "v0";

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

  constructor(
    private readonly app: FastifyInstance,
    private readonly settingsStore: SettingsStore
  ) {}

  async sync(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = (async () => {
      const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
      const appToken = runtimeCredentials.slackSocketModeToken?.trim() || null;
      const botToken = runtimeCredentials.slackBotToken?.trim() || null;
      const signingSecret = runtimeCredentials.slackSigningSecret?.trim() || null;

      if (!appToken || !botToken || !signingSecret) {
        await this.stop();
        return;
      }

      if (this.client && this.activeAppToken === appToken) {
        return;
      }

      await this.stop();

      const client = new SocketModeClient({ appToken });
      client.on("slash_commands", (event: SlackSocketModeEnvelope) => {
        void this.handleSlashCommand(event, signingSecret);
      });
      client.on("interactive", (event: SlackSocketModeEnvelope) => {
        void this.handleInteractive(event, signingSecret);
      });
      client.on("error", (error: unknown) => {
        this.app.log.error({ error }, "Slack Socket Mode client error");
      });

      await client.start();
      this.client = client;
      this.activeAppToken = appToken;
      this.app.log.info("Slack Socket Mode client started");
    })().catch((error) => {
      this.app.log.error({ error }, "Failed to start Slack Socket Mode client");
    }).finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  async stop(): Promise<void> {
    if (!this.client) {
      this.activeAppToken = null;
      return;
    }

    const client = this.client;
    this.client = null;
    this.activeAppToken = null;
    try {
      await client.disconnect();
    } catch (error) {
      this.app.log.warn({ error }, "Failed to disconnect Slack Socket Mode client");
    }
  }

  private async handleSlashCommand(event: SlackSocketModeEnvelope, signingSecret: string): Promise<void> {
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
  }

  private async handleInteractive(event: SlackSocketModeEnvelope, signingSecret: string): Promise<void> {
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
  }
}
