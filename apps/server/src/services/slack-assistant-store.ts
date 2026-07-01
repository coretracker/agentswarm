import { nanoid } from "nanoid";
import type { Pool } from "pg";

const nowIso = (): string => new Date().toISOString();

export interface SlackAssistantTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface SlackAssistantActiveRuntime {
  provider: "codex" | "claude";
  status: "active" | "idle" | "stopped";
  containerName: string | null;
  startedAt: string;
  lastUserMessageAt: string;
  stoppedAt: string | null;
  stopReason: "idle_timeout" | "completed" | "failed" | null;
}

export interface SlackAssistantConversation {
  id: string;
  repositoryId: string | null;
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider: "codex" | "claude";
  turns: SlackAssistantTurn[];
  activeRuntime: SlackAssistantActiveRuntime | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlackAssistantConversationInput {
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider?: "codex" | "claude";
}

export interface SlackAssistantStore {
  getOrCreateConversation(input: SlackAssistantConversationInput): Promise<SlackAssistantConversation>;
  appendTurn(conversationId: string, turn: SlackAssistantTurn): Promise<SlackAssistantConversation | null>;
  updateActiveRuntime(
    conversationId: string,
    activeRuntime: SlackAssistantActiveRuntime | null
  ): Promise<SlackAssistantConversation | null>;
}

const normalizeProvider = (value: unknown): "codex" | "claude" => (value === "claude" ? "claude" : "codex");

const normalizeTurns = (value: unknown): SlackAssistantTurn[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content : "";
    const at = typeof record.at === "string" ? record.at : "";
    return role && content && at ? [{ role, content, at }] : [];
  });
};

const normalizeActiveRuntime = (value: unknown): SlackAssistantActiveRuntime | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const provider = normalizeProvider(record.provider);
  const status = record.status === "active" || record.status === "idle" || record.status === "stopped" ? record.status : "idle";
  const startedAt = typeof record.startedAt === "string" ? record.startedAt : "";
  const lastUserMessageAt = typeof record.lastUserMessageAt === "string" ? record.lastUserMessageAt : "";
  if (!startedAt || !lastUserMessageAt) {
    return null;
  }
  return {
    provider,
    status,
    containerName: typeof record.containerName === "string" && record.containerName.trim().length > 0 ? record.containerName.trim() : null,
    startedAt,
    lastUserMessageAt,
    stoppedAt: typeof record.stoppedAt === "string" ? record.stoppedAt : null,
    stopReason:
      record.stopReason === "idle_timeout" || record.stopReason === "completed" || record.stopReason === "failed"
        ? record.stopReason
        : null
  };
};

export class PostgresSlackAssistantStore implements SlackAssistantStore {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: Record<string, unknown>): SlackAssistantConversation {
    const context = row.context && typeof row.context === "object" ? (row.context as Record<string, unknown>) : {};
    return {
      id: String(row.id),
      repositoryId: typeof row.repository_id === "string" ? row.repository_id : null,
      userId: String(row.user_id),
      slackTeamId: String(row.slack_team_id),
      slackChannelId: String(row.slack_channel_id),
      slackUserId: String(row.slack_user_id),
      provider: normalizeProvider(row.provider),
      turns: normalizeTurns(context.turns),
      activeRuntime: normalizeActiveRuntime(row.active_runtime),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  async getOrCreateConversation(input: SlackAssistantConversationInput): Promise<SlackAssistantConversation> {
    const provider = input.provider ?? "codex";
    const timestamp = nowIso();
    const result = await this.pool.query(
      `
        INSERT INTO slack_assistant_conversations (
          id,
          repository_id,
          user_id,
          slack_team_id,
          slack_channel_id,
          slack_user_id,
          provider,
          context,
          active_runtime,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULL, $9, $10)
        ON CONFLICT (slack_team_id, slack_channel_id, slack_user_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        nanoid(),
        null,
        input.userId,
        input.slackTeamId,
        input.slackChannelId,
        input.slackUserId,
        provider,
        JSON.stringify({ turns: [] }),
        timestamp,
        timestamp
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async appendTurn(conversationId: string, turn: SlackAssistantTurn): Promise<SlackAssistantConversation | null> {
    const currentResult = await this.pool.query("SELECT * FROM slack_assistant_conversations WHERE id = $1", [conversationId]);
    const current = currentResult.rows[0];
    if (!current) {
      return null;
    }

    const conversation = this.mapRow(current);
    const timestamp = nowIso();
    const turns = [...conversation.turns, turn].slice(-80);
    const result = await this.pool.query(
      `
        UPDATE slack_assistant_conversations
        SET context = $2::jsonb,
            updated_at = $3
        WHERE id = $1
        RETURNING *
      `,
      [conversationId, JSON.stringify({ turns }), timestamp]
    );
    return this.mapRow(result.rows[0]);
  }

  async updateActiveRuntime(
    conversationId: string,
    activeRuntime: SlackAssistantActiveRuntime | null
  ): Promise<SlackAssistantConversation | null> {
    const timestamp = nowIso();
    const result = await this.pool.query(
      `
        UPDATE slack_assistant_conversations
        SET active_runtime = $2::jsonb,
            updated_at = $3
        WHERE id = $1
        RETURNING *
      `,
      [conversationId, activeRuntime ? JSON.stringify(activeRuntime) : null, timestamp]
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }
}
