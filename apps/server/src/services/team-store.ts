import { nanoid } from "nanoid";
import type { Pool } from "pg";
import type { CreateTeamInput, Team, UpdateTeamInput } from "@verft/shared-types";
import { HttpError } from "../lib/http-error.js";

const nowIso = (): string => new Date().toISOString();
const normalizeName = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
const normalizeNameKey = (value: string | undefined): string => normalizeName(value).toLowerCase();

export class TeamStore {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: Record<string, unknown>): Team {
    return {
      id: String(row.id),
      name: normalizeName(String(row.name ?? "")),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private async assertUniqueName(name: string, currentId?: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM teams WHERE name_key = $1", [normalizeNameKey(name)]);
    const existingId = result.rows[0]?.id;
    if (existingId && existingId !== currentId) {
      throw new HttpError(409, "A team with that name already exists");
    }
  }

  async listTeams(): Promise<Team[]> {
    const result = await this.pool.query("SELECT * FROM teams ORDER BY name ASC");
    return result.rows.map((row) => this.mapRow(row));
  }

  async getTeam(teamId: string): Promise<Team | null> {
    const result = await this.pool.query("SELECT * FROM teams WHERE id = $1", [teamId]);
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  async createTeam(input: CreateTeamInput): Promise<Team> {
    const name = normalizeName(input.name);
    if (!name) {
      throw new HttpError(400, "Team name is required");
    }
    await this.assertUniqueName(name);
    const timestamp = nowIso();
    const team: Team = { id: nanoid(), name, createdAt: timestamp, updatedAt: timestamp };
    await this.pool.query(
      "INSERT INTO teams (id, name, name_key, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [team.id, team.name, normalizeNameKey(team.name), team.createdAt, team.updatedAt]
    );
    return team;
  }

  async updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team | null> {
    const current = await this.getTeam(teamId);
    if (!current) {
      return null;
    }
    const name = input.name === undefined ? current.name : normalizeName(input.name);
    if (!name) {
      throw new HttpError(400, "Team name is required");
    }
    await this.assertUniqueName(name, teamId);
    const next: Team = { ...current, name, updatedAt: nowIso() };
    await this.pool.query(
      "UPDATE teams SET name = $2, name_key = $3, updated_at = $4 WHERE id = $1",
      [next.id, next.name, normalizeNameKey(next.name), next.updatedAt]
    );
    return next;
  }

  async deleteTeam(teamId: string): Promise<boolean> {
    const members = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM users WHERE team_id = $1) AS exists",
      [teamId]
    );
    if (members.rows[0]?.exists) {
      throw new HttpError(409, "Remove or reassign all team members before deleting this team");
    }
    const result = await this.pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
    return Boolean(result.rowCount);
  }
}
