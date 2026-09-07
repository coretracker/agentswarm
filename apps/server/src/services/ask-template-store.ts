import { nanoid } from "nanoid";
import type { Pool } from "pg";
import type {
  AskTemplate,
  AskTemplateSummary,
  AskTemplateVariable,
  AskTemplateVersion,
  CreateAskTemplateInput,
  UpdateAskTemplateInput,
  UpdateAskTemplateSharingInput
} from "@verft/shared-types";
import { parseJsonColumn, withPostgresTransaction, type PostgresQueryable } from "../lib/postgres.js";

const nowIso = (): string => new Date().toISOString();
const variableKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeVariables = (value: unknown): AskTemplateVariable[] => {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!variableKeyPattern.test(key) || keys.has(key)) return [];
    keys.add(key);
    return [{
      key,
      label: typeof record.label === "string" ? record.label.trim() : "",
      description: typeof record.description === "string" ? record.description.trim() : "",
      type: record.type === "multiline" ? "multiline" : "text",
      required: record.required === true,
      defaultValue: typeof record.defaultValue === "string" ? record.defaultValue : ""
    }];
  });
};

const mapTemplate = (row: Record<string, unknown>): AskTemplate => ({
  id: String(row.id),
  ownerUserId: typeof row.owner_user_id === "string" ? row.owner_user_id : null,
  ownerName: typeof row.owner_name === "string" ? row.owner_name : null,
  name: String(row.name ?? ""),
  description: String(row.description ?? ""),
  prompt: String(row.prompt ?? ""),
  outputFormat: String(row.output_format ?? ""),
  variables: normalizeVariables(parseJsonColumn<unknown>(row.variables)),
  visibility: row.visibility === "teams" || row.visibility === "global" ? row.visibility : "private",
  sharedTeamIds: Array.isArray(row.shared_team_ids) ? row.shared_team_ids.map(String) : [],
  version: Number(row.version ?? 1),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const toSummary = (template: AskTemplate): AskTemplateSummary => {
  const { prompt: _prompt, outputFormat: _outputFormat, variables: _variables, ...summary } = template;
  return summary;
};

const templateSelect = `
  SELECT t.*, u.name AS owner_name,
    COALESCE(array_agg(a.team_id) FILTER (WHERE a.team_id IS NOT NULL), ARRAY[]::text[]) AS shared_team_ids
  FROM ask_templates t
  LEFT JOIN users u ON u.id = t.owner_user_id
  LEFT JOIN ask_template_team_access a ON a.template_id = t.id
`;

export interface AskTemplateStore {
  listAccessible(userId: string, teamId: string | null, isAdmin: boolean): Promise<AskTemplateSummary[]>;
  getTemplate(templateId: string): Promise<AskTemplate | null>;
  getAccessible(templateId: string, userId: string, teamId: string | null, isAdmin: boolean): Promise<AskTemplate | null>;
  createTemplate(ownerUserId: string, input: CreateAskTemplateInput): Promise<AskTemplate>;
  updateTemplate(templateId: string, changedByUserId: string, input: UpdateAskTemplateInput): Promise<AskTemplate | null>;
  updateSharing(templateId: string, input: UpdateAskTemplateSharingInput): Promise<AskTemplate | null>;
  deleteTemplate(templateId: string): Promise<boolean>;
  listVersions(templateId: string): Promise<AskTemplateVersion[]>;
  getVersion(templateId: string, version: number): Promise<AskTemplateVersion | null>;
  restoreVersion(templateId: string, changedByUserId: string, version: number): Promise<AskTemplate | null>;
}

export class PostgresAskTemplateStore implements AskTemplateStore {
  constructor(private readonly pool: Pool) {}

  private async getTemplateWith(db: PostgresQueryable, templateId: string): Promise<AskTemplate | null> {
    const result = await db.query(`${templateSelect} WHERE t.id = $1 GROUP BY t.id, u.name`, [templateId]);
    return result.rows[0] ? mapTemplate(result.rows[0]) : null;
  }

  async listAccessible(userId: string, teamId: string | null, isAdmin: boolean): Promise<AskTemplateSummary[]> {
    const result = await this.pool.query(
      `${templateSelect}
       WHERE $1::boolean
          OR t.owner_user_id = $2
          OR t.visibility = 'global'
          OR (t.visibility = 'teams' AND $3::text IS NOT NULL AND EXISTS (
            SELECT 1 FROM ask_template_team_access access WHERE access.template_id = t.id AND access.team_id = $3
          ))
       GROUP BY t.id, u.name
       ORDER BY t.updated_at DESC`,
      [isAdmin, userId, teamId]
    );
    return result.rows.map((row) => toSummary(mapTemplate(row)));
  }

  async getTemplate(templateId: string): Promise<AskTemplate | null> {
    return this.getTemplateWith(this.pool, templateId);
  }

  async getAccessible(templateId: string, userId: string, teamId: string | null, isAdmin: boolean): Promise<AskTemplate | null> {
    if (isAdmin) return this.getTemplate(templateId);
    const template = await this.getTemplate(templateId);
    if (!template) return null;
    if (template.ownerUserId === userId || template.visibility === "global") return template;
    return template.visibility === "teams" && teamId && template.sharedTeamIds.includes(teamId) ? template : null;
  }

  private async insertVersion(
    db: PostgresQueryable,
    template: Pick<AskTemplate, "id" | "version" | "name" | "description" | "prompt" | "outputFormat" | "variables">,
    changedByUserId: string | null,
    createdAt: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO ask_template_versions
       (template_id, version, name, description, prompt, output_format, variables, changed_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [template.id, template.version, template.name, template.description, template.prompt, template.outputFormat, JSON.stringify(template.variables), changedByUserId, createdAt]
    );
  }

  async createTemplate(ownerUserId: string, input: CreateAskTemplateInput): Promise<AskTemplate> {
    return withPostgresTransaction(this.pool, async (db) => {
      const timestamp = nowIso();
      const template: AskTemplate = {
        id: nanoid(), ownerUserId, ownerName: null, name: input.name.trim(), description: input.description?.trim() ?? "",
        prompt: input.prompt.trim(), outputFormat: input.outputFormat.trim(), variables: normalizeVariables(input.variables),
        visibility: "private", sharedTeamIds: [], version: 1, createdAt: timestamp, updatedAt: timestamp
      };
      await db.query(
        `INSERT INTO ask_templates (id, owner_user_id, name, description, prompt, output_format, variables, visibility, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
        [template.id, ownerUserId, template.name, template.description, template.prompt, template.outputFormat, JSON.stringify(template.variables), template.visibility, template.version, timestamp, timestamp]
      );
      await this.insertVersion(db, template, ownerUserId, timestamp);
      return (await this.getTemplateWith(db, template.id))!;
    });
  }

  async updateTemplate(templateId: string, changedByUserId: string, input: UpdateAskTemplateInput): Promise<AskTemplate | null> {
    return withPostgresTransaction(this.pool, async (db) => {
      const current = await this.getTemplateWith(db, templateId);
      if (!current) return null;
      const timestamp = nowIso();
      const next = { ...current, name: input.name.trim(), description: input.description?.trim() ?? "", prompt: input.prompt.trim(), outputFormat: input.outputFormat.trim(), variables: normalizeVariables(input.variables), version: current.version + 1, updatedAt: timestamp };
      await db.query(
        `UPDATE ask_templates SET name = $2, description = $3, prompt = $4, output_format = $5, variables = $6::jsonb, version = $7, updated_at = $8 WHERE id = $1`,
        [templateId, next.name, next.description, next.prompt, next.outputFormat, JSON.stringify(next.variables), next.version, timestamp]
      );
      await this.insertVersion(db, next, changedByUserId, timestamp);
      return this.getTemplateWith(db, templateId);
    });
  }

  async updateSharing(templateId: string, input: UpdateAskTemplateSharingInput): Promise<AskTemplate | null> {
    return withPostgresTransaction(this.pool, async (db) => {
      const current = await this.getTemplateWith(db, templateId);
      if (!current) return null;
      const teamIds = input.visibility === "teams" ? Array.from(new Set(input.sharedTeamIds ?? [])) : [];
      await db.query("UPDATE ask_templates SET visibility = $2, updated_at = $3 WHERE id = $1", [templateId, input.visibility, nowIso()]);
      await db.query("DELETE FROM ask_template_team_access WHERE template_id = $1", [templateId]);
      for (const teamId of teamIds) {
        await db.query("INSERT INTO ask_template_team_access (template_id, team_id) VALUES ($1, $2)", [templateId, teamId]);
      }
      return this.getTemplateWith(db, templateId);
    });
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM ask_templates WHERE id = $1", [templateId]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapVersion(row: Record<string, unknown>): AskTemplateVersion {
    return {
      templateId: String(row.template_id), version: Number(row.version), name: String(row.name), description: String(row.description ?? ""),
      prompt: String(row.prompt), outputFormat: String(row.output_format), variables: normalizeVariables(parseJsonColumn<unknown>(row.variables)),
      changedByUserId: typeof row.changed_by_user_id === "string" ? row.changed_by_user_id : null,
      changedByName: typeof row.changed_by_name === "string" ? row.changed_by_name : null, createdAt: String(row.created_at)
    };
  }

  async listVersions(templateId: string): Promise<AskTemplateVersion[]> {
    const result = await this.pool.query(
      `SELECT v.*, u.name AS changed_by_name FROM ask_template_versions v LEFT JOIN users u ON u.id = v.changed_by_user_id
       WHERE v.template_id = $1 ORDER BY v.version DESC`, [templateId]
    );
    return result.rows.map((row) => this.mapVersion(row));
  }

  async getVersion(templateId: string, version: number): Promise<AskTemplateVersion | null> {
    const result = await this.pool.query(
      `SELECT v.*, u.name AS changed_by_name FROM ask_template_versions v LEFT JOIN users u ON u.id = v.changed_by_user_id
       WHERE v.template_id = $1 AND v.version = $2`, [templateId, version]
    );
    return result.rows[0] ? this.mapVersion(result.rows[0]) : null;
  }

  async restoreVersion(templateId: string, changedByUserId: string, version: number): Promise<AskTemplate | null> {
    const source = await this.getVersion(templateId, version);
    if (!source) return null;
    return this.updateTemplate(templateId, changedByUserId, source);
  }
}
