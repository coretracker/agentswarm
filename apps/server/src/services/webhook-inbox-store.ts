import { nanoid } from "nanoid";
import type { Pool } from "pg";
import type { WebhookInboxEntry } from "@verft/shared-types";

const mapRow = (row: Record<string, unknown>): WebhookInboxEntry => ({
  id: String(row.id),
  repositoryId: String(row.repository_id),
  headers: (row.headers as Record<string, string>) ?? {},
  body: row.body ?? {},
  sourceIp: typeof row.source_ip === "string" && row.source_ip.trim().length > 0 ? row.source_ip.trim() : null,
  status: row.status === "rejected" || row.status === "dropped" ? row.status : "accepted",
  reason: typeof row.reason === "string" && row.reason.trim().length > 0 ? row.reason.trim() : null,
  matchedRuleId: typeof row.matched_rule_id === "string" && row.matched_rule_id.trim().length > 0 ? row.matched_rule_id.trim() : null,
  taskId: typeof row.task_id === "string" && row.task_id.trim().length > 0 ? row.task_id.trim() : null,
  receivedAt: String(row.received_at)
});

export interface WebhookInboxStore {
  insertEntry(entry: {
    repositoryId: string;
    headers: Record<string, string>;
    body: unknown;
    sourceIp: string | null;
    status?: WebhookInboxEntry["status"];
    reason?: string | null;
  }): Promise<WebhookInboxEntry>;
  updateMatchResult(entryId: string, matchedRuleId: string, taskId: string): Promise<void>;
  markDropped(entryId: string, reason: string, matchedRuleId?: string | null): Promise<void>;
  listEntries(repositoryId: string, options?: { matched?: boolean; limit?: number }): Promise<WebhookInboxEntry[]>;
  getEntry(entryId: string): Promise<WebhookInboxEntry | null>;
  deleteEntry(entryId: string): Promise<boolean>;
  deleteOldEntries(repositoryId: string, olderThanDays: number): Promise<number>;
}

export class PostgresWebhookInboxStore implements WebhookInboxStore {
  constructor(private readonly pool: Pool) {}

  async insertEntry(entry: {
    repositoryId: string;
    headers: Record<string, string>;
    body: unknown;
    sourceIp: string | null;
    status?: WebhookInboxEntry["status"];
    reason?: string | null;
  }): Promise<WebhookInboxEntry> {
    const id = nanoid();
    const receivedAt = new Date().toISOString();
    const result = await this.pool.query(
      `INSERT INTO webhook_inbox (id, repository_id, headers, body, source_ip, status, reason, received_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        entry.repositoryId,
        JSON.stringify(entry.headers),
        JSON.stringify(entry.body),
        entry.sourceIp,
        entry.status ?? "accepted",
        entry.reason?.trim() || null,
        receivedAt
      ]
    );
    return mapRow(result.rows[0]);
  }

  async updateMatchResult(entryId: string, matchedRuleId: string, taskId: string): Promise<void> {
    await this.pool.query(
      "UPDATE webhook_inbox SET matched_rule_id = $2, task_id = $3 WHERE id = $1",
      [entryId, matchedRuleId, taskId]
    );
  }

  async markDropped(entryId: string, reason: string, matchedRuleId?: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE webhook_inbox SET status = 'dropped', reason = $2, matched_rule_id = COALESCE($3, matched_rule_id) WHERE id = $1",
      [entryId, reason, matchedRuleId ?? null]
    );
  }

  async listEntries(repositoryId: string, options?: { matched?: boolean; limit?: number }): Promise<WebhookInboxEntry[]> {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    let query = "SELECT * FROM webhook_inbox WHERE repository_id = $1";
    const params: unknown[] = [repositoryId];

    if (options?.matched === true) {
      query += " AND matched_rule_id IS NOT NULL";
    } else if (options?.matched === false) {
      query += " AND matched_rule_id IS NULL";
    }

    query += " ORDER BY received_at DESC LIMIT $" + (params.length + 1);
    params.push(limit);

    const result = await this.pool.query(query, params);
    return result.rows.map(mapRow);
  }

  async getEntry(entryId: string): Promise<WebhookInboxEntry | null> {
    const result = await this.pool.query("SELECT * FROM webhook_inbox WHERE id = $1", [entryId]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM webhook_inbox WHERE id = $1", [entryId]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteOldEntries(repositoryId: string, olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.pool.query(
      "DELETE FROM webhook_inbox WHERE repository_id = $1 AND received_at < $2",
      [repositoryId, cutoff]
    );
    return result.rowCount ?? 0;
  }
}
