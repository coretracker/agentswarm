import { nanoid } from "nanoid";
import type { Pool } from "pg";
import type { AgentProvider, ProviderProfile } from "@verft/shared-types";
import { withPostgresTransaction } from "../lib/postgres.js";

const nowIso = (): string => new Date().toISOString();

export type AssistantSessionStatus = "active" | "cleared";
export type AssistantEventKind = "user_message" | "assistant_message" | "tool_call" | "tool_result" | "error" | "session_cleared";

export interface AssistantSession {
  id: string;
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider: AgentProvider;
  model: string | null;
  effort: ProviderProfile;
  providerSessionId: string | null;
  status: AssistantSessionStatus;
  clearedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantEvent {
  id: string;
  sessionId: string;
  kind: AssistantEventKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAssistantSessionInput {
  userId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackUserId: string;
  provider: AgentProvider;
  model?: string | null;
  effort: ProviderProfile;
}

export interface AssistantSessionStore {
  getActiveSession(userId: string): Promise<AssistantSession | null>;
  getOrCreateActiveSession(input: CreateAssistantSessionInput): Promise<AssistantSession>;
  listSessions(userId: string, limit?: number): Promise<AssistantSession[]>;
  listAllSessions(limit?: number): Promise<AssistantSession[]>;
  listEvents(userId: string, sessionId: string, limit?: number): Promise<AssistantEvent[]>;
  appendEvent(sessionId: string, kind: AssistantEventKind, content: string, metadata?: Record<string, unknown>): Promise<AssistantEvent>;
  setProviderSessionId(sessionId: string, providerSessionId: string | null): Promise<void>;
  clearActiveSession(userId: string): Promise<AssistantSession | null>;
  deleteExpiredEvents(retentionDays: number): Promise<number>;
}

export class PostgresAssistantSessionStore implements AssistantSessionStore {
  constructor(private readonly pool: Pool) {}

  private mapSession(row: Record<string, unknown>): AssistantSession {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      slackTeamId: String(row.slack_team_id),
      slackChannelId: String(row.slack_channel_id),
      slackUserId: String(row.slack_user_id),
      provider: row.provider === "claude" ? "claude" : "codex",
      model: typeof row.model === "string" ? row.model : null,
      effort: row.effort === "low" || row.effort === "medium" || row.effort === "max" ? row.effort : "high",
      providerSessionId: typeof row.provider_session_id === "string" ? row.provider_session_id : null,
      status: row.status === "cleared" ? "cleared" : "active",
      clearedAt: typeof row.cleared_at === "string" ? row.cleared_at : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapEvent(row: Record<string, unknown>): AssistantEvent {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      kind: row.kind as AssistantEventKind,
      content: String(row.content),
      metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
      createdAt: String(row.created_at)
    };
  }

  async getActiveSession(userId: string): Promise<AssistantSession | null> {
    const result = await this.pool.query(
      "SELECT * FROM assistant_sessions WHERE user_id = $1 AND status = 'active' LIMIT 1",
      [userId]
    );
    return result.rows[0] ? this.mapSession(result.rows[0]) : null;
  }

  async getOrCreateActiveSession(input: CreateAssistantSessionInput): Promise<AssistantSession> {
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`assistant-session:${input.userId}`]);
      const existing = await client.query(
        "SELECT * FROM assistant_sessions WHERE user_id = $1 AND status = 'active' LIMIT 1",
        [input.userId]
      );
      if (existing.rows[0]) {
        return this.mapSession(existing.rows[0]);
      }
      const timestamp = nowIso();
      const created = await client.query(
        `INSERT INTO assistant_sessions (
          id, user_id, slack_team_id, slack_channel_id, slack_user_id, provider, model, effort,
          provider_session_id, status, cleared_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'active',NULL,$9,$9) RETURNING *`,
        [
          nanoid(),
          input.userId,
          input.slackTeamId,
          input.slackChannelId,
          input.slackUserId,
          input.provider,
          input.model ?? null,
          input.effort,
          timestamp
        ]
      );
      return this.mapSession(created.rows[0]);
    });
  }

  async listSessions(userId: string, limit = 50): Promise<AssistantSession[]> {
    const result = await this.pool.query(
      "SELECT * FROM assistant_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2",
      [userId, Math.max(1, Math.min(limit, 100))]
    );
    return result.rows.map((row) => this.mapSession(row));
  }

  async listAllSessions(limit = 100): Promise<AssistantSession[]> {
    const result = await this.pool.query(
      "SELECT * FROM assistant_sessions ORDER BY updated_at DESC LIMIT $1",
      [Math.max(1, Math.min(limit, 500))]
    );
    return result.rows.map((row) => this.mapSession(row));
  }

  async listEvents(userId: string, sessionId: string, limit = 200): Promise<AssistantEvent[]> {
    const result = await this.pool.query(
      `SELECT event.*
       FROM assistant_events event
       INNER JOIN assistant_sessions session ON session.id = event.session_id
       WHERE event.session_id = $1 AND session.user_id = $2
       ORDER BY event.created_at ASC
       LIMIT $3`,
      [sessionId, userId, Math.max(1, Math.min(limit, 500))]
    );
    return result.rows.map((row) => this.mapEvent(row));
  }

  async appendEvent(
    sessionId: string,
    kind: AssistantEventKind,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<AssistantEvent> {
    const timestamp = nowIso();
    let result;
    try {
      result = await this.pool.query(
        `INSERT INTO assistant_events (id, session_id, kind, content, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
        [nanoid(), sessionId, kind, content, JSON.stringify(metadata), timestamp]
      );
    } catch (error) {
      if (!("externalId" in metadata) || !error || typeof error !== "object" || !("code" in error) || error.code !== "23505") {
        throw error;
      }
      result = await this.pool.query(
        "SELECT * FROM assistant_events WHERE session_id = $1 AND metadata->>'externalId' = $2 LIMIT 1",
        [sessionId, String(metadata.externalId)]
      );
    }
    await this.pool.query("UPDATE assistant_sessions SET updated_at = $2 WHERE id = $1", [sessionId, timestamp]);
    return this.mapEvent(result.rows[0]);
  }

  async setProviderSessionId(sessionId: string, providerSessionId: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE assistant_sessions SET provider_session_id = $2, updated_at = $3 WHERE id = $1 AND status = 'active'",
      [sessionId, providerSessionId, nowIso()]
    );
  }

  async clearActiveSession(userId: string): Promise<AssistantSession | null> {
    return withPostgresTransaction(this.pool, async (client) => {
      const timestamp = nowIso();
      const result = await client.query(
        `UPDATE assistant_sessions
         SET status = 'cleared', cleared_at = $2, provider_session_id = NULL, updated_at = $2
         WHERE user_id = $1 AND status = 'active'
         RETURNING *`,
        [userId, timestamp]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      await client.query(
        `INSERT INTO assistant_events (id, session_id, kind, content, metadata, created_at)
         VALUES ($1,$2,'session_cleared','Session cleared','{}'::jsonb,$3)`,
        [nanoid(), row.id, timestamp]
      );
      return this.mapSession(row);
    });
  }

  async deleteExpiredEvents(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.pool.query("DELETE FROM assistant_events WHERE created_at < $1", [cutoff]);
    return result.rowCount ?? 0;
  }
}
