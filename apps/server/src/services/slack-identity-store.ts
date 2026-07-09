import type { Pool } from "pg";
import { HttpError } from "../lib/http-error.js";

const SLACK_ID_PATTERN = /^[A-Z][A-Z0-9]{7,31}$/;

export interface SlackIdentity {
  userId: string;
  slackTeamId: string;
  slackUserId: string;
}

export interface SlackIdentityStore {
  getForUser(userId: string): Promise<SlackIdentity | null>;
  findActiveUserId(slackTeamId: string, slackUserId: string): Promise<string | null>;
  setForUser(userId: string, slackTeamId: string | null, slackUserId: string | null): Promise<SlackIdentity | null>;
}

const normalizeId = (value: string | null): string | null => {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized || null;
};

export class PostgresSlackIdentityStore implements SlackIdentityStore {
  constructor(private readonly pool: Pool) {}

  async getForUser(userId: string): Promise<SlackIdentity | null> {
    const result = await this.pool.query<{ id: string; slack_team_id: string | null; slack_user_id: string | null }>(
      "SELECT id, slack_team_id, slack_user_id FROM users WHERE id = $1",
      [userId]
    );
    const row = result.rows[0];
    return row?.slack_team_id && row.slack_user_id
      ? { userId: row.id, slackTeamId: row.slack_team_id, slackUserId: row.slack_user_id }
      : null;
  }

  async findActiveUserId(slackTeamId: string, slackUserId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE slack_team_id = $1 AND slack_user_id = $2 AND active = TRUE LIMIT 1",
      [normalizeId(slackTeamId), normalizeId(slackUserId)]
    );
    return result.rows[0]?.id ?? null;
  }

  async setForUser(userId: string, slackTeamId: string | null, slackUserId: string | null): Promise<SlackIdentity | null> {
    const teamId = normalizeId(slackTeamId);
    const externalUserId = normalizeId(slackUserId);
    if ((teamId === null) !== (externalUserId === null)) {
      throw new HttpError(400, "Slack workspace ID and user ID must be set or cleared together");
    }
    if (teamId && (!SLACK_ID_PATTERN.test(teamId) || !SLACK_ID_PATTERN.test(externalUserId!))) {
      throw new HttpError(400, "Invalid Slack workspace ID or user ID");
    }
    try {
      const result = await this.pool.query<{ id: string; slack_team_id: string | null; slack_user_id: string | null }>(
        `UPDATE users
         SET slack_team_id = $2, slack_user_id = $3, updated_at = $4
         WHERE id = $1
         RETURNING id, slack_team_id, slack_user_id`,
        [userId, teamId, externalUserId, new Date().toISOString()]
      );
      const row = result.rows[0];
      if (!row) {
        throw new HttpError(404, "User not found");
      }
      return row.slack_team_id && row.slack_user_id
        ? { userId: row.id, slackTeamId: row.slack_team_id, slackUserId: row.slack_user_id }
        : null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new HttpError(409, "Slack identity is already linked to another user");
      }
      throw error;
    }
  }
}
