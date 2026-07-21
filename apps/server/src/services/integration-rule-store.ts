import { nanoid } from "nanoid";
import type { Pool } from "pg";
import type { IntegrationRule, CreateIntegrationRuleInput, UpdateIntegrationRuleInput } from "@verft/shared-types";

const nowIso = (): string => new Date().toISOString();

const mapRow = (row: Record<string, unknown>): IntegrationRule => ({
  id: String(row.id),
  repositoryId: String(row.repository_id),
  name: String(row.name ?? ""),
  enabled: row.enabled === true,
  filter: (row.filter as IntegrationRule["filter"]) ?? { conditions: [] },
  mapping: (row.mapping as IntegrationRule["mapping"]) ?? {},
  execution: (row.execution as IntegrationRule["execution"]) ?? null,
  correlationField: typeof row.correlation_field === "string" && row.correlation_field.trim().length > 0 ? row.correlation_field.trim() : null,
  taskOwnerUserId: typeof row.task_owner_user_id === "string" && row.task_owner_user_id.trim().length > 0 ? row.task_owner_user_id.trim() : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

export interface IntegrationRuleStore {
  listRules(repositoryId: string): Promise<IntegrationRule[]>;
  getRule(ruleId: string): Promise<IntegrationRule | null>;
  createRule(repositoryId: string, input: CreateIntegrationRuleInput): Promise<IntegrationRule>;
  updateRule(ruleId: string, input: UpdateIntegrationRuleInput): Promise<IntegrationRule | null>;
  deleteRule(ruleId: string): Promise<boolean>;
}

export class PostgresIntegrationRuleStore implements IntegrationRuleStore {
  constructor(private readonly pool: Pool) {}

  async listRules(repositoryId: string): Promise<IntegrationRule[]> {
    const result = await this.pool.query(
      "SELECT * FROM integration_rules WHERE repository_id = $1 ORDER BY created_at ASC",
      [repositoryId]
    );
    return result.rows.map(mapRow);
  }

  async getRule(ruleId: string): Promise<IntegrationRule | null> {
    const result = await this.pool.query("SELECT * FROM integration_rules WHERE id = $1", [ruleId]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async createRule(repositoryId: string, input: CreateIntegrationRuleInput): Promise<IntegrationRule> {
    const timestamp = nowIso();
    const id = nanoid();
    const result = await this.pool.query(
      `INSERT INTO integration_rules (id, repository_id, name, enabled, filter, mapping, execution, correlation_field, task_owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        repositoryId,
        input.name.trim(),
        input.enabled !== false,
        JSON.stringify(input.filter),
        JSON.stringify(input.mapping),
        input.execution ? JSON.stringify(input.execution) : null,
        input.correlationField?.trim() || null,
        input.taskOwnerUserId?.trim() || null,
        timestamp,
        timestamp
      ]
    );
    return mapRow(result.rows[0]);
  }

  async updateRule(ruleId: string, input: UpdateIntegrationRuleInput): Promise<IntegrationRule | null> {
    const current = await this.getRule(ruleId);
    if (!current) {
      return null;
    }

    const timestamp = nowIso();
    const result = await this.pool.query(
      `UPDATE integration_rules
       SET name = $2, enabled = $3, filter = $4::jsonb, mapping = $5::jsonb, execution = $6::jsonb, correlation_field = $7, task_owner_user_id = $8, updated_at = $9
       WHERE id = $1
       RETURNING *`,
      [
        ruleId,
        input.name !== undefined ? input.name.trim() : current.name,
        input.enabled !== undefined ? input.enabled : current.enabled,
        JSON.stringify(input.filter !== undefined ? input.filter : current.filter),
        JSON.stringify(input.mapping !== undefined ? input.mapping : current.mapping),
        input.execution !== undefined ? (input.execution ? JSON.stringify(input.execution) : null) : (current.execution ? JSON.stringify(current.execution) : null),
        input.correlationField !== undefined ? (input.correlationField?.trim() || null) : current.correlationField,
        input.taskOwnerUserId !== undefined ? (input.taskOwnerUserId?.trim() || null) : current.taskOwnerUserId,
        timestamp
      ]
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM integration_rules WHERE id = $1", [ruleId]);
    return (result.rowCount ?? 0) > 0;
  }
}
