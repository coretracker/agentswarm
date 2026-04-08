import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import {
  ALL_PERMISSION_SCOPES,
  type AgentProvider,
  type AuthSessionUser,
  type CreateUserInput,
  type PermissionScope,
  type ProviderProfile,
  type Role,
  type User,
  type UserRoleRef,
  type UpdateUserInput
} from "@agentswarm/shared-types";
import { HttpError } from "../lib/http-error.js";
import { RoleStore, SYSTEM_ADMIN_ROLE_ID } from "./role-store.js";

const USER_KEY_PREFIX = "agentswarm:user:";
const USER_IDS_KEY = "agentswarm:user_ids";
const USER_EMAIL_KEY_PREFIX = "agentswarm:user_email:";
const BOOTSTRAP_ADMIN_MARKER_KEY = "agentswarm:bootstrap_admin_user_id";

const scrypt = promisify(scryptCallback);
const nowIso = (): string => new Date().toISOString();
const scopeOrder = new Map(ALL_PERMISSION_SCOPES.map((scope, index) => [scope, index]));

export interface BootstrapAdminInput {
  name: string;
  email: string;
  password: string;
}

export interface StoredUserRecord {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roleIds: string[];
  passwordHash: string;
  passwordSalt: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const normalizeUserName = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
const normalizeUserEmail = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const sortScopes = (scopes: PermissionScope[]): PermissionScope[] =>
  Array.from(new Set(scopes)).sort((left, right) => (scopeOrder.get(left) ?? 0) - (scopeOrder.get(right) ?? 0));

const mergeRoleAllowlist = <T extends string>(roles: Role[], selector: (role: Role) => T[]): T[] => {
  if (roles.every((role) => selector(role).length === 0)) {
    return [];
  }
  return Array.from(new Set(roles.flatMap((role) => selector(role)))).sort((left, right) => left.localeCompare(right));
};

const hashPassword = async (
  password: string
): Promise<Pick<StoredUserRecord, "passwordHash" | "passwordSalt">> => {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, passwordSalt, 64)) as Buffer;
  return {
    passwordHash: passwordHash.toString("hex"),
    passwordSalt
  };
};

const verifyPassword = async (
  password: string,
  passwordSalt: string,
  passwordHash: string
): Promise<boolean> => {
  const providedHash = (await scrypt(password, passwordSalt, 64)) as Buffer;
  const storedHash = Buffer.from(passwordHash, "hex");
  if (providedHash.byteLength !== storedHash.byteLength) {
    return false;
  }

  return timingSafeEqual(storedHash, providedHash);
};

export class UserStore {
  constructor(
    private readonly redis: Redis,
    private readonly roleStore: RoleStore
  ) {}

  private userKey(userId: string): string {
    return `${USER_KEY_PREFIX}${userId}`;
  }

  private userEmailKey(email: string): string {
    return `${USER_EMAIL_KEY_PREFIX}${normalizeUserEmail(email)}`;
  }

  private normalizeStoredUser(user: StoredUserRecord): StoredUserRecord {
    return {
      ...user,
      name: normalizeUserName(user.name),
      email: normalizeUserEmail(user.email),
      active: user.active !== false,
      roleIds: Array.from(new Set((user.roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))),
      lastLoginAt: user.lastLoginAt ?? null
    };
  }

  private async getStoredUser(userId: string): Promise<StoredUserRecord | null> {
    const raw = await this.redis.get(this.userKey(userId));
    if (!raw) {
      return null;
    }

    return this.normalizeStoredUser(JSON.parse(raw) as StoredUserRecord);
  }

  private async getStoredUsers(userIds: string[]): Promise<StoredUserRecord[]> {
    if (userIds.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const userId of userIds) {
      pipeline.get(this.userKey(userId));
    }

    const result = await pipeline.exec();
    const users: StoredUserRecord[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        users.push(this.normalizeStoredUser(JSON.parse(raw) as StoredUserRecord));
      }
    }

    return users;
  }

  private async normalizeRoleIds(roleIds: string[] | undefined): Promise<string[]> {
    const uniqueRoleIds = Array.from(new Set((roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean)));
    if (uniqueRoleIds.length === 0) {
      return [];
    }

    const roles = await this.roleStore.getRolesByIds(uniqueRoleIds);
    if (roles.length !== uniqueRoleIds.length) {
      const missingRoleId = uniqueRoleIds.find((roleId) => !roles.some((role) => role.id === roleId));
      throw new HttpError(400, `Unknown role: ${missingRoleId ?? "unknown"}`);
    }

    return uniqueRoleIds;
  }

  private buildRoleRefs(roles: Role[]): UserRoleRef[] {
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      isSystem: role.isSystem
    }));
  }

  private async sanitizeUser(user: StoredUserRecord): Promise<User> {
    const roles = await this.roleStore.getRolesByIds(user.roleIds);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      roles: this.buildRoleRefs(roles),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private async countOtherActiveAdmins(excludedUserId: string): Promise<number> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    const users = await this.getStoredUsers(userIds);
    return users.filter(
      (user) =>
        user.id !== excludedUserId &&
        user.active &&
        user.roleIds.includes(SYSTEM_ADMIN_ROLE_ID)
    ).length;
  }

  private async assertAdminUserStillExists(
    current: StoredUserRecord,
    nextRoleIds: string[],
    nextActive: boolean
  ): Promise<void> {
    if (
      current.active &&
      current.roleIds.includes(SYSTEM_ADMIN_ROLE_ID) &&
      (!nextActive || !nextRoleIds.includes(SYSTEM_ADMIN_ROLE_ID))
    ) {
      const otherActiveAdmins = await this.countOtherActiveAdmins(current.id);
      if (otherActiveAdmins === 0) {
        throw new HttpError(409, "At least one active admin user is required");
      }
    }
  }

  private async persistUser(nextUser: StoredUserRecord, previousUser?: StoredUserRecord): Promise<void> {
    const pipeline = this.redis
      .multi()
      .set(this.userKey(nextUser.id), JSON.stringify(nextUser))
      .sadd(USER_IDS_KEY, nextUser.id)
      .set(this.userEmailKey(nextUser.email), nextUser.id);

    if (previousUser && previousUser.email !== nextUser.email) {
      pipeline.del(this.userEmailKey(previousUser.email));
    }

    await pipeline.exec();
  }

  private async setBootstrapAdminRoleIfMissing(user: StoredUserRecord): Promise<StoredUserRecord> {
    if (user.roleIds.includes(SYSTEM_ADMIN_ROLE_ID)) {
      return user;
    }

    const next: StoredUserRecord = {
      ...user,
      roleIds: [...user.roleIds, SYSTEM_ADMIN_ROLE_ID],
      updatedAt: nowIso()
    };
    await this.persistUser(next, user);
    return next;
  }

  async ensureDefaultAdminUser(input: BootstrapAdminInput): Promise<User> {
    const markerUserId = await this.redis.get(BOOTSTRAP_ADMIN_MARKER_KEY);
    if (markerUserId) {
      const markedUser = await this.getStoredUser(markerUserId);
      if (markedUser) {
        const repairedUser = await this.setBootstrapAdminRoleIfMissing(markedUser);
        return this.sanitizeUser(repairedUser);
      }
    }

    const existingUserId = await this.redis.get(this.userEmailKey(input.email));
    if (existingUserId) {
      const existingUser = await this.getStoredUser(existingUserId);
      if (existingUser) {
        const repairedUser = await this.setBootstrapAdminRoleIfMissing(existingUser);
        await this.redis.set(BOOTSTRAP_ADMIN_MARKER_KEY, repairedUser.id);
        return this.sanitizeUser(repairedUser);
      }
    }

    const createdUser = await this.createUser({
      name: input.name,
      email: input.email,
      password: input.password,
      active: true,
      roleIds: [SYSTEM_ADMIN_ROLE_ID]
    });
    await this.redis.set(BOOTSTRAP_ADMIN_MARKER_KEY, createdUser.id);
    return createdUser;
  }

  async listUsers(): Promise<User[]> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    const users = await this.getStoredUsers(userIds);
    const sanitizedUsers = await Promise.all(users.map((user) => this.sanitizeUser(user)));
    return sanitizedUsers.sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return left.email.localeCompare(right.email);
    });
  }

  async getUser(userId: string): Promise<User | null> {
    const user = await this.getStoredUser(userId);
    if (!user) {
      return null;
    }

    return this.sanitizeUser(user);
  }

  async getAuthSessionUser(userId: string): Promise<AuthSessionUser | null> {
    const user = await this.getStoredUser(userId);
    if (!user || !user.active) {
      return null;
    }

    const roles = await this.roleStore.getRolesByIds(user.roleIds);
    const scopes = sortScopes(roles.flatMap((role) => role.scopes));
    const allowedProviders = mergeRoleAllowlist<AgentProvider>(roles, (role) => role.allowedProviders);
    const allowedModels = mergeRoleAllowlist<string>(roles, (role) => role.allowedModels);
    const allowedEfforts = mergeRoleAllowlist<ProviderProfile>(roles, (role) => role.allowedEfforts);
    return {
      ...(await this.sanitizeUser(user)),
      scopes,
      allowedProviders,
      allowedModels,
      allowedEfforts
    };
  }

  async authenticate(email: string, password: string): Promise<User | null> {
    const normalizedEmail = normalizeUserEmail(email);
    if (!normalizedEmail || !password) {
      return null;
    }

    const userId = await this.redis.get(this.userEmailKey(normalizedEmail));
    if (!userId) {
      return null;
    }

    const user = await this.getStoredUser(userId);
    if (!user || !user.active) {
      return null;
    }

    const validPassword = await verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!validPassword) {
      return null;
    }

    const next: StoredUserRecord = {
      ...user,
      lastLoginAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.persistUser(next, user);
    return this.sanitizeUser(next);
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const name = normalizeUserName(input.name);
    const email = normalizeUserEmail(input.email);
    const password = input.password.trim();

    if (!name) {
      throw new HttpError(400, "User name is required");
    }

    if (!email) {
      throw new HttpError(400, "User email is required");
    }

    if (!password) {
      throw new HttpError(400, "Password is required");
    }

    const existingUserId = await this.redis.get(this.userEmailKey(email));
    if (existingUserId) {
      throw new HttpError(409, "A user with that email already exists");
    }

    const roleIds = await this.normalizeRoleIds(input.roleIds);
    const timestamp = nowIso();
    const passwordState = await hashPassword(password);
    const user: StoredUserRecord = {
      id: nanoid(),
      name,
      email,
      active: input.active !== false,
      roleIds,
      passwordHash: passwordState.passwordHash,
      passwordSalt: passwordState.passwordSalt,
      lastLoginAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.persistUser(user);
    return this.sanitizeUser(user);
  }

  async updateUser(userId: string, input: UpdateUserInput): Promise<User | null> {
    const current = await this.getStoredUser(userId);
    if (!current) {
      return null;
    }

    const nextName = input.name === undefined ? current.name : normalizeUserName(input.name);
    const nextEmail = input.email === undefined ? current.email : normalizeUserEmail(input.email);
    if (!nextName) {
      throw new HttpError(400, "User name is required");
    }

    if (!nextEmail) {
      throw new HttpError(400, "User email is required");
    }

    if (nextEmail !== current.email) {
      const existingUserId = await this.redis.get(this.userEmailKey(nextEmail));
      if (existingUserId && existingUserId !== userId) {
        throw new HttpError(409, "A user with that email already exists");
      }
    }

    const nextRoleIds = input.roleIds === undefined ? current.roleIds : await this.normalizeRoleIds(input.roleIds);
    const nextActive = input.active ?? current.active;
    await this.assertAdminUserStillExists(current, nextRoleIds, nextActive);

    let passwordHash = current.passwordHash;
    let passwordSalt = current.passwordSalt;
    if (input.password !== undefined) {
      const nextPassword = input.password.trim();
      if (!nextPassword) {
        throw new HttpError(400, "Password is required");
      }

      const passwordState = await hashPassword(nextPassword);
      passwordHash = passwordState.passwordHash;
      passwordSalt = passwordState.passwordSalt;
    }

    const next: StoredUserRecord = {
      ...current,
      name: nextName,
      email: nextEmail,
      active: nextActive,
      roleIds: nextRoleIds,
      passwordHash,
      passwordSalt,
      updatedAt: nowIso()
    };

    await this.persistUser(next, current);
    return this.sanitizeUser(next);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const current = await this.getStoredUser(userId);
    if (!current) {
      return false;
    }

    if (current.active && current.roleIds.includes(SYSTEM_ADMIN_ROLE_ID)) {
      const otherActiveAdmins = await this.countOtherActiveAdmins(current.id);
      if (otherActiveAdmins === 0) {
        throw new HttpError(409, "At least one active admin user is required");
      }
    }

    await this.redis
      .multi()
      .del(this.userKey(userId))
      .srem(USER_IDS_KEY, userId)
      .del(this.userEmailKey(current.email))
      .exec();

    return true;
  }

  async hasUsersWithRole(roleId: string): Promise<boolean> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    const users = await this.getStoredUsers(userIds);
    return users.some((user) => user.roleIds.includes(roleId));
  }

  async listUserIdsByRoleId(roleId: string): Promise<string[]> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    const users = await this.getStoredUsers(userIds);
    return users.filter((user) => user.roleIds.includes(roleId)).map((user) => user.id);
  }

  async normalizeUserIds(userIds: string[] | undefined): Promise<string[]> {
    const normalizedUserIds = Array.from(new Set((userIds ?? []).map((userId) => userId.trim()).filter(Boolean)));
    if (normalizedUserIds.length === 0) {
      return [];
    }

    const users = await this.getStoredUsers(normalizedUserIds);
    if (users.length !== normalizedUserIds.length) {
      const missingUserId = normalizedUserIds.find((userId) => !users.some((user) => user.id === userId));
      throw new HttpError(400, `Unknown user: ${missingUserId ?? "unknown"}`);
    }

    return normalizedUserIds;
  }
}
