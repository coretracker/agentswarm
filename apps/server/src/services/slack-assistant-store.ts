import { nanoid } from "nanoid";
import type { Pool } from "pg";

const nowIso = (): string => new Date().toISOString();

export interface SlackAssistantTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface SlackAssistantConversation {
  id: string;
  repositoryId: string;
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider: "codex" | "claude";
  turns: SlackAssistantTurn[];
  createdAt: string;
  updatedAt: string;
}

export interface SlackAssistantConversationInput {
  repositoryId: string;
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider?: "codex" | "claude";
}

export interface SlackAssistantStore {
  getOrCreateConversation(input: SlackAssistantConversationInput): Promise<SlackAssistantConversation>;
  appendTurn(conversationId: string, turn: SlackAssistantTurn): Promise<SlackAssistantConversation | null>;
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

export class PostgresSlackAssistantStore implements SlackAssistantStore {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: Record<string, unknown>): SlackAssistantConversation {
    const context = row.context && typeof row.context === "object" ? (row.context as Record<string, unknown>) : {};
    return {
      id: String(row.id),
      repositoryId: String(row.repository_id),
      userId: String(row.user_id),
      slackTeamId: String(row.slack_team_id),
      slackChannelId: String(row.slack_channel_id),
      slackUserId: String(row.slack_user_id),
      provider: normalizeProvider(row.provider),
      turns: normalizeTurns(context.turns),
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
        ON CONFLICT (repository_id, slack_team_id, slack_channel_id, slack_user_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        nanoid(),
        input.repositoryId,
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
}
