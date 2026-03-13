import { nanoid } from "nanoid";
import type Redis from "ioredis";
import {
  ALL_PERMISSION_SCOPES,
  type CreateRoleInput,
  type PermissionScope,
  type Role,
  type UpdateRoleInput
} from "@agentswarm/shared-types";
import { HttpError } from "../lib/http-error.js";

const ROLE_KEY_PREFIX = "agentswarm:role:";
const ROLE_IDS_KEY = "agentswarm:role_ids";
const ROLE_NAME_KEY_PREFIX = "agentswarm:role_name:";

export const SYSTEM_ADMIN_ROLE_ID = "admin";
const SYSTEM_ADMIN_ROLE_NAME = "Admin";
const SYSTEM_ADMIN_ROLE_DESCRIPTION = "Built-in superuser role with every available permission.";

const nowIso = (): string => new Date().toISOString();
const scopeOrder = new Map(ALL_PERMISSION_SCOPES.map((scope, index) => [scope, index]));

const normalizeRoleName = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
const normalizeRoleNameKey = (value: string | undefined): string => normalizeRoleName(value).toLowerCase();

const normalizeRoleDescription = (value: string | undefined): string => (value ?? "").trim();

const normalizeScopes = (scopes: PermissionScope[] | string[] | undefined): PermissionScope[] => {
  const uniqueScopes = Array.from(new Set((scopes ?? []).map((scope) => String(scope).trim())));
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

export class RoleStore {
  constructor(private readonly redis: Redis) {}

  private roleKey(roleId: string): string {
    return `${ROLE_KEY_PREFIX}${roleId}`;
  }

  private roleNameKey(roleName: string): string {
    return `${ROLE_NAME_KEY_PREFIX}${normalizeRoleNameKey(roleName)}`;
  }

  private normalizeRole(role: Role): Role {
    return {
      ...role,
      name: normalizeRoleName(role.name),
      description: normalizeRoleDescription(role.description),
      scopes: normalizeScopes(role.scopes)
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
