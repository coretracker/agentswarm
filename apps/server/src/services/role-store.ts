import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import {
  ALL_PERMISSION_SCOPES,
  type AgentProvider,
  type CreateRoleInput,
  type PermissionScope,
  type ProviderProfile,
  type Role,
  type UpdateRoleInput
} from "@agentswarm/shared-types";
import { HttpError } from "../lib/http-error.js";
import { parseJsonColumn, type PostgresQueryable } from "../lib/postgres.js";

const ROLE_KEY_PREFIX = "agentswarm:role:";
const ROLE_IDS_KEY = "agentswarm:role_ids";
const ROLE_NAME_KEY_PREFIX = "agentswarm:role_name:";

export const SYSTEM_ADMIN_ROLE_ID = "admin";
const SYSTEM_ADMIN_ROLE_NAME = "Admin";
const SYSTEM_ADMIN_ROLE_DESCRIPTION = "Built-in superuser role with every available permission.";
const ROLE_SCOPE_VERSION = 4;

const nowIso = (): string => new Date().toISOString();
const scopeOrder = new Map(ALL_PERMISSION_SCOPES.map((scope, index) => [scope, index]));

const normalizeRoleName = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
const normalizeRoleNameKey = (value: string | undefined): string => normalizeRoleName(value).toLowerCase();

const normalizeRoleDescription = (value: string | undefined): string => (value ?? "").trim();
const providerOrder: AgentProvider[] = ["codex", "claude"];
const effortOrder: ProviderProfile[] = ["low", "medium", "high", "max"];

const normalizeAllowedProviders = (providers: AgentProvider[] | string[] | undefined): AgentProvider[] => {
  const unique = Array.from(new Set((providers ?? []).map((provider) => String(provider).trim()).filter(Boolean)));
  const invalid = unique.find((provider) => !providerOrder.includes(provider as AgentProvider));
  if (invalid) {
    throw new HttpError(400, `Unknown provider: ${invalid}`);
  }
  return unique
    .map((provider) => provider as AgentProvider)
    .sort((left, right) => providerOrder.indexOf(left) - providerOrder.indexOf(right));
};

const normalizeAllowedEfforts = (efforts: ProviderProfile[] | string[] | undefined): ProviderProfile[] => {
  const unique = Array.from(new Set((efforts ?? []).map((effort) => String(effort).trim()).filter(Boolean)));
  const invalid = unique.find((effort) => !effortOrder.includes(effort as ProviderProfile));
  if (invalid) {
    throw new HttpError(400, `Unknown effort: ${invalid}`);
  }
  return unique
    .map((effort) => effort as ProviderProfile)
    .sort((left, right) => effortOrder.indexOf(left) - effortOrder.indexOf(right));
};

const normalizeAllowedModels = (models: string[] | undefined): string[] =>
  Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));

const LEGACY_SCOPE_ALIASES: Record<string, PermissionScope> = {
  "preset:list": "snippet:list",
  "preset:create": "snippet:create",
  "preset:read": "snippet:read",
  "preset:edit": "snippet:edit",
  "preset:delete": "snippet:delete"
};

const expandLegacyTaskModeScopes = (scopes: string[]): string[] => {
  const expanded = new Set(scopes);
  if (expanded.has("task:create") || expanded.has("task:edit")) {
    expanded.add("task:build");
    expanded.add("task:ask");
    expanded.add("task:interactive");
  }
  return Array.from(expanded);
};

const normalizeScopes = (
  scopes: PermissionScope[] | string[] | undefined,
  options?: { legacyTaskModes?: boolean }
): PermissionScope[] => {
  const uniqueScopesRaw = Array.from(
    new Set(
      (scopes ?? [])
        .map((scope) => String(scope).trim())
        .filter(Boolean)
        .map((scope) => LEGACY_SCOPE_ALIASES[scope] ?? scope)
    )
  );
  const uniqueScopes = options?.legacyTaskModes ? expandLegacyTaskModeScopes(uniqueScopesRaw) : uniqueScopesRaw;
  if (uniqueScopes.length === 0) {
    throw new HttpError(400, "At least one permission scope is required");
  }

  const invalidScope = uniqueScopes.find((scope) => !scopeOrder.has(scope as PermissionScope));
  if (invalidScope) {
    throw new HttpError(400, `Unknown permission scope: ${invalidScope}`);
  }

  return uniqueScopes
    .map((scope) => scope as PermissionScope)
    .sort((left, right) => (scopeOrder.get(left) ?? 0) - (scopeOrder.get(right) ?? 0));
};

export interface RoleStore {
  ensureDefaultAdminRole(): Promise<Role>;
  listRoles(): Promise<Role[]>;
  getRole(roleId: string): Promise<Role | null>;
  getRolesByIds(roleIds: string[]): Promise<Role[]>;
  createRole(input: CreateRoleInput): Promise<Role>;
  updateRole(roleId: string, input: UpdateRoleInput): Promise<Role | null>;
  deleteRole(roleId: string): Promise<boolean>;
}

export class RedisRoleStore implements RoleStore {
  constructor(private readonly redis: Redis) {}

  private roleKey(roleId: string): string {
    return `${ROLE_KEY_PREFIX}${roleId}`;
  }

  private roleNameKey(roleName: string): string {
    return `${ROLE_NAME_KEY_PREFIX}${normalizeRoleNameKey(roleName)}`;
  }

  private normalizeRole(role: Role): Role {
    const legacyRole = role as Role & {
      allowedProviders?: AgentProvider[] | string[];
      allowedModels?: string[];
      allowedEfforts?: ProviderProfile[] | string[];
    };
    return {
      ...role,
      name: normalizeRoleName(role.name),
      description: normalizeRoleDescription(role.description),
      scopes: normalizeScopes(role.scopes, { legacyTaskModes: role.scopeVersion !== ROLE_SCOPE_VERSION }),
      allowedProviders: normalizeAllowedProviders(legacyRole.allowedProviders),
      allowedModels: normalizeAllowedModels(legacyRole.allowedModels),
      allowedEfforts: normalizeAllowedEfforts(legacyRole.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION
    };
  }

  private async getStoredRole(roleId: string): Promise<Role | null> {
    const raw = await this.redis.get(this.roleKey(roleId));
    if (!raw) {
      return null;
    }

    return this.normalizeRole(JSON.parse(raw) as Role);
  }

  private async assertUniqueRoleName(roleName: string, currentRoleId?: string): Promise<void> {
    const existingRoleId = await this.redis.get(this.roleNameKey(roleName));
    if (existingRoleId && existingRoleId !== currentRoleId) {
      throw new HttpError(409, "A role with that name already exists");
    }
  }

  async ensureDefaultAdminRole(): Promise<Role> {
    const timestamp = nowIso();
    const current = await this.getStoredRole(SYSTEM_ADMIN_ROLE_ID);
    const adminRole: Role = {
      id: SYSTEM_ADMIN_ROLE_ID,
      name: SYSTEM_ADMIN_ROLE_NAME,
      description: SYSTEM_ADMIN_ROLE_DESCRIPTION,
      scopes: [...ALL_PERMISSION_SCOPES],
      allowedProviders: [],
      allowedModels: [],
      allowedEfforts: [],
      scopeVersion: ROLE_SCOPE_VERSION,
      isSystem: true,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: current?.updatedAt ?? timestamp
    };

    if (
      current &&
      current.name === adminRole.name &&
      current.description === adminRole.description &&
      current.isSystem &&
      JSON.stringify(current.scopes) === JSON.stringify(adminRole.scopes)
    ) {
      await this.redis.set(this.roleNameKey(adminRole.name), adminRole.id);
      return current;
    }

    const nextRole: Role = {
      ...adminRole,
      updatedAt: timestamp
    };

    const previousName = current?.name;
    const pipeline = this.redis
      .multi()
      .set(this.roleKey(nextRole.id), JSON.stringify(nextRole))
      .sadd(ROLE_IDS_KEY, nextRole.id)
      .set(this.roleNameKey(nextRole.name), nextRole.id);

    if (previousName && normalizeRoleNameKey(previousName) !== normalizeRoleNameKey(nextRole.name)) {
      pipeline.del(this.roleNameKey(previousName));
    }

    await pipeline.exec();
    return nextRole;
  }

  async listRoles(): Promise<Role[]> {
    const roleIds = await this.redis.smembers(ROLE_IDS_KEY);
    if (roleIds.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const roleId of roleIds) {
      pipeline.get(this.roleKey(roleId));
    }

    const result = await pipeline.exec();
    const roles: Role[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        roles.push(this.normalizeRole(JSON.parse(raw) as Role));
      }
    }

    return roles.sort((left, right) => {
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }

  async getRole(roleId: string): Promise<Role | null> {
    return this.getStoredRole(roleId);
  }

  async getRolesByIds(roleIds: string[]): Promise<Role[]> {
    const uniqueRoleIds = Array.from(new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean)));
    if (uniqueRoleIds.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const roleId of uniqueRoleIds) {
      pipeline.get(this.roleKey(roleId));
    }

    const result = await pipeline.exec();
    const rolesById = new Map<string, Role>();
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        const role = this.normalizeRole(JSON.parse(raw) as Role);
        rolesById.set(role.id, role);
      }
    }

    return uniqueRoleIds.flatMap((roleId) => {
      const role = rolesById.get(roleId);
      return role ? [role] : [];
    });
  }

  async createRole(input: CreateRoleInput): Promise<Role> {
    const name = normalizeRoleName(input.name);
    if (!name) {
      throw new HttpError(400, "Role name is required");
    }

    await this.assertUniqueRoleName(name);
    const timestamp = nowIso();
    const role: Role = {
      id: nanoid(),
      name,
      description: normalizeRoleDescription(input.description),
      scopes: normalizeScopes(input.scopes),
      allowedProviders: normalizeAllowedProviders(input.allowedProviders),
      allowedModels: normalizeAllowedModels(input.allowedModels),
      allowedEfforts: normalizeAllowedEfforts(input.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION,
      isSystem: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.redis
      .multi()
      .set(this.roleKey(role.id), JSON.stringify(role))
      .sadd(ROLE_IDS_KEY, role.id)
      .set(this.roleNameKey(role.name), role.id)
      .exec();

    return role;
  }

  async updateRole(roleId: string, input: UpdateRoleInput): Promise<Role | null> {
    const current = await this.getStoredRole(roleId);
    if (!current) {
      return null;
    }

    if (current.isSystem) {
      throw new HttpError(403, "System roles are immutable");
    }

    const nextName = input.name === undefined ? current.name : normalizeRoleName(input.name);
    if (!nextName) {
      throw new HttpError(400, "Role name is required");
    }

    await this.assertUniqueRoleName(nextName, current.id);
    const next: Role = {
      ...current,
      name: nextName,
      description: input.description === undefined ? current.description : normalizeRoleDescription(input.description),
      scopes: input.scopes === undefined ? current.scopes : normalizeScopes(input.scopes),
      allowedProviders:
        input.allowedProviders === undefined ? current.allowedProviders : normalizeAllowedProviders(input.allowedProviders),
      allowedModels: input.allowedModels === undefined ? current.allowedModels : normalizeAllowedModels(input.allowedModels),
      allowedEfforts: input.allowedEfforts === undefined ? current.allowedEfforts : normalizeAllowedEfforts(input.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION,
      updatedAt: nowIso()
    };

    const pipeline = this.redis
      .multi()
      .set(this.roleKey(roleId), JSON.stringify(next))
      .set(this.roleNameKey(next.name), next.id);

    if (normalizeRoleNameKey(current.name) !== normalizeRoleNameKey(next.name)) {
      pipeline.del(this.roleNameKey(current.name));
    }

    await pipeline.exec();
    return next;
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const current = await this.getStoredRole(roleId);
    if (!current) {
      return false;
    }

    if (current.isSystem) {
      throw new HttpError(403, "System roles cannot be deleted");
    }

    await this.redis
      .multi()
      .del(this.roleKey(roleId))
      .srem(ROLE_IDS_KEY, roleId)
      .del(this.roleNameKey(current.name))
      .exec();

    return true;
  }
}

export class PostgresRoleStore implements RoleStore {
  constructor(private readonly pool: Pool) {}

  private mapRoleRow(row: Record<string, unknown>): Role {
    return this.normalizeRole({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ""),
      scopes: parseJsonColumn<PermissionScope[]>(row.scopes),
      allowedProviders: parseJsonColumn<AgentProvider[]>(row.allowed_providers),
      allowedModels: parseJsonColumn<string[]>(row.allowed_models),
      allowedEfforts: parseJsonColumn<ProviderProfile[]>(row.allowed_efforts),
      scopeVersion: Number(row.scope_version),
      isSystem: row.is_system === true,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    });
  }

  private normalizeRole(role: Role): Role {
    const legacyRole = role as Role & {
      allowedProviders?: AgentProvider[] | string[];
      allowedModels?: string[];
      allowedEfforts?: ProviderProfile[] | string[];
    };
    return {
      ...role,
      name: normalizeRoleName(role.name),
      description: normalizeRoleDescription(role.description),
      scopes: normalizeScopes(role.scopes, { legacyTaskModes: role.scopeVersion !== ROLE_SCOPE_VERSION }),
      allowedProviders: normalizeAllowedProviders(legacyRole.allowedProviders),
      allowedModels: normalizeAllowedModels(legacyRole.allowedModels),
      allowedEfforts: normalizeAllowedEfforts(legacyRole.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION
    };
  }

  private async getStoredRole(roleId: string, db: PostgresQueryable = this.pool): Promise<Role | null> {
    const result = await db.query("SELECT * FROM roles WHERE id = $1", [roleId]);
    const row = result.rows[0];
    return row ? this.mapRoleRow(row) : null;
  }

  private async assertUniqueRoleName(
    roleName: string,
    currentRoleId?: string,
    db: PostgresQueryable = this.pool
  ): Promise<void> {
    const result = await db.query<{ id: string }>("SELECT id FROM roles WHERE name_key = $1", [normalizeRoleNameKey(roleName)]);
    const existingRoleId = result.rows[0]?.id ?? null;
    if (existingRoleId && existingRoleId !== currentRoleId) {
      throw new HttpError(409, "A role with that name already exists");
    }
  }

  private async upsertRole(role: Role, db: PostgresQueryable = this.pool): Promise<void> {
    await db.query(
      `
        INSERT INTO roles (
          id,
          name,
          name_key,
          description,
          scopes,
          allowed_providers,
          allowed_models,
          allowed_efforts,
          scope_version,
          is_system,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          name_key = EXCLUDED.name_key,
          description = EXCLUDED.description,
          scopes = EXCLUDED.scopes,
          allowed_providers = EXCLUDED.allowed_providers,
          allowed_models = EXCLUDED.allowed_models,
          allowed_efforts = EXCLUDED.allowed_efforts,
          scope_version = EXCLUDED.scope_version,
          is_system = EXCLUDED.is_system,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        role.id,
        role.name,
        normalizeRoleNameKey(role.name),
        role.description,
        JSON.stringify(role.scopes),
        JSON.stringify(role.allowedProviders),
        JSON.stringify(role.allowedModels),
        JSON.stringify(role.allowedEfforts),
        role.scopeVersion ?? ROLE_SCOPE_VERSION,
        role.isSystem,
        role.createdAt,
        role.updatedAt
      ]
    );
  }

  async ensureDefaultAdminRole(): Promise<Role> {
    const timestamp = nowIso();
    const current = await this.getStoredRole(SYSTEM_ADMIN_ROLE_ID);
    const adminRole: Role = {
      id: SYSTEM_ADMIN_ROLE_ID,
      name: SYSTEM_ADMIN_ROLE_NAME,
      description: SYSTEM_ADMIN_ROLE_DESCRIPTION,
      scopes: [...ALL_PERMISSION_SCOPES],
      allowedProviders: [],
      allowedModels: [],
      allowedEfforts: [],
      scopeVersion: ROLE_SCOPE_VERSION,
      isSystem: true,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: current?.updatedAt ?? timestamp
    };

    if (
      current &&
      current.name === adminRole.name &&
      current.description === adminRole.description &&
      current.isSystem &&
      JSON.stringify(current.scopes) === JSON.stringify(adminRole.scopes) &&
      JSON.stringify(current.allowedProviders) === JSON.stringify(adminRole.allowedProviders) &&
      JSON.stringify(current.allowedModels) === JSON.stringify(adminRole.allowedModels) &&
      JSON.stringify(current.allowedEfforts) === JSON.stringify(adminRole.allowedEfforts) &&
      current.scopeVersion === adminRole.scopeVersion
    ) {
      return current;
    }

    const nextRole: Role = {
      ...adminRole,
      updatedAt: timestamp
    };

    await this.upsertRole(nextRole);
    return nextRole;
  }

  async listRoles(): Promise<Role[]> {
    const result = await this.pool.query("SELECT * FROM roles ORDER BY is_system DESC, name ASC");
    return result.rows.map((row) => this.mapRoleRow(row));
  }

  async getRole(roleId: string): Promise<Role | null> {
    return this.getStoredRole(roleId);
  }

  async getRolesByIds(roleIds: string[]): Promise<Role[]> {
    const uniqueRoleIds = Array.from(new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean)));
    if (uniqueRoleIds.length === 0) {
      return [];
    }

    const result = await this.pool.query("SELECT * FROM roles WHERE id = ANY($1::text[])", [uniqueRoleIds]);
    const rolesById = new Map<string, Role>();
    for (const row of result.rows) {
      const role = this.mapRoleRow(row);
      rolesById.set(role.id, role);
    }

    return uniqueRoleIds.flatMap((roleId) => {
      const role = rolesById.get(roleId);
      return role ? [role] : [];
    });
  }

  async createRole(input: CreateRoleInput): Promise<Role> {
    const name = normalizeRoleName(input.name);
    if (!name) {
      throw new HttpError(400, "Role name is required");
    }

    await this.assertUniqueRoleName(name);
    const timestamp = nowIso();
    const role: Role = {
      id: nanoid(),
      name,
      description: normalizeRoleDescription(input.description),
      scopes: normalizeScopes(input.scopes),
      allowedProviders: normalizeAllowedProviders(input.allowedProviders),
      allowedModels: normalizeAllowedModels(input.allowedModels),
      allowedEfforts: normalizeAllowedEfforts(input.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION,
      isSystem: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.upsertRole(role);
    return role;
  }

  async updateRole(roleId: string, input: UpdateRoleInput): Promise<Role | null> {
    const current = await this.getStoredRole(roleId);
    if (!current) {
      return null;
    }

    if (current.isSystem) {
      throw new HttpError(403, "System roles are immutable");
    }

    const nextName = input.name === undefined ? current.name : normalizeRoleName(input.name);
    if (!nextName) {
      throw new HttpError(400, "Role name is required");
    }

    await this.assertUniqueRoleName(nextName, current.id);
    const next: Role = {
      ...current,
      name: nextName,
      description: input.description === undefined ? current.description : normalizeRoleDescription(input.description),
      scopes: input.scopes === undefined ? current.scopes : normalizeScopes(input.scopes),
      allowedProviders:
        input.allowedProviders === undefined ? current.allowedProviders : normalizeAllowedProviders(input.allowedProviders),
      allowedModels: input.allowedModels === undefined ? current.allowedModels : normalizeAllowedModels(input.allowedModels),
      allowedEfforts: input.allowedEfforts === undefined ? current.allowedEfforts : normalizeAllowedEfforts(input.allowedEfforts),
      scopeVersion: ROLE_SCOPE_VERSION,
      updatedAt: nowIso()
    };

    await this.upsertRole(next);
    return next;
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const current = await this.getStoredRole(roleId);
    if (!current) {
      return false;
    }

    if (current.isSystem) {
      throw new HttpError(403, "System roles cannot be deleted");
    }

    await this.pool.query("DELETE FROM roles WHERE id = $1", [roleId]);
    return true;
  }
}
