import type { Pool } from "pg";
import type { AgentProvider, PermissionScope } from "@verft/shared-types";

export interface AssistantPolicy {
  enabled: boolean;
  allowedProviders: AgentProvider[];
  allowedModels: string[];
  mcpScopes: PermissionScope[];
  maxConcurrentRuns: number;
  retentionDays: number;
  updatedAt: string;
}

export type UpdateAssistantPolicy = Omit<AssistantPolicy, "updatedAt">;

export class AssistantPolicyStore {
  constructor(private readonly pool: Pool) {}

  private map(row: Record<string, unknown>): AssistantPolicy {
    return {
      enabled: row.enabled === true,
      allowedProviders: Array.isArray(row.allowed_providers) ? row.allowed_providers as AgentProvider[] : [],
      allowedModels: Array.isArray(row.allowed_models) ? row.allowed_models.map(String) : [],
      mcpScopes: Array.isArray(row.mcp_scopes) ? row.mcp_scopes as PermissionScope[] : [],
      maxConcurrentRuns: Number(row.max_concurrent_runs),
      retentionDays: Number(row.retention_days),
      updatedAt: String(row.updated_at)
    };
  }

  async get(): Promise<AssistantPolicy> {
    const result = await this.pool.query("SELECT * FROM assistant_settings WHERE singleton_id = 1");
    return this.map(result.rows[0]);
  }

  async update(input: UpdateAssistantPolicy): Promise<AssistantPolicy> {
    const result = await this.pool.query(
      `UPDATE assistant_settings SET
        enabled=$1, allowed_providers=$2::jsonb, allowed_models=$3::jsonb, mcp_scopes=$4::jsonb,
        max_concurrent_runs=$5, retention_days=$6, updated_at=$7
       WHERE singleton_id=1 RETURNING *`,
      [
        input.enabled,
        JSON.stringify(input.allowedProviders),
        JSON.stringify(input.allowedModels),
        JSON.stringify(input.mcpScopes),
        input.maxConcurrentRuns,
        input.retentionDays,
        new Date().toISOString()
      ]
    );
    return this.map(result.rows[0]);
  }
}
