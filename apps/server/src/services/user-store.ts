import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import {
  ALL_PERMISSION_SCOPES,
  type AgentProvider,
  type AgentResponsePreference,
  type AudienceType,
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
import { type PostgresQueryable, withPostgresTransaction } from "../lib/postgres.js";
import type { RepositoryStore } from "./repository-store.js";
import { SYSTEM_ADMIN_ROLE_ID, type RoleStore } from "./role-store.js";

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
  agentResponsePreference: AgentResponsePreference;
  roleIds: string[];
  repositoryIds: string[];
  passwordHash: string;
  passwordSalt: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const normalizeUserName = (value: string | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
const normalizeUserEmail = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const DEFAULT_AGENT_RESPONSE_PREFERENCE: AgentResponsePreference = {};
const RESPONSE_AUDIENCES = new Set<AudienceType>(["technical", "non_technical", "mixed"]);
const RESPONSE_EXPLANATION_DEPTH = new Set(["one_line", "brief", "standard", "detailed", "deep_dive"]);
const RESPONSE_JARGON_LEVEL = new Set(["avoid", "balanced", "expert"]);
const RESPONSE_CODE_PREFERENCE = new Set(["only_when_needed", "prefer_examples", "avoid_code"]);
const RESPONSE_CLARIFY_BEHAVIOR = new Set(["ask_when_ambiguous", "make_reasonable_assumptions"]);
const RESPONSE_FORMATTING_STYLE = new Set(["direct", "teaching", "executive", "step_by_step", "checklist", "qa", "problem_solution"]);

const normalizeAgentResponsePreference = (
  value: Partial<AgentResponsePreference> | AgentResponsePreference | null | undefined,
  fallback: AgentResponsePreference = DEFAULT_AGENT_RESPONSE_PREFERENCE
): AgentResponsePreference => ({
  audience:
    (() => {
      const nextAudience = value?.audience ?? fallback.audience;
      if (typeof nextAudience === "string" && RESPONSE_AUDIENCES.has(nextAudience as AudienceType)) {
        return nextAudience as AudienceType;
      }
      const legacyStyle = (value as { style?: string } | undefined)?.style ?? (fallback as { style?: string } | undefined)?.style;
      if (legacyStyle === "technical" || legacyStyle === "non_technical") {
        return legacyStyle;
      }
      return undefined;
    })(),
  explanationDepth:
    typeof (value?.explanationDepth ?? fallback.explanationDepth) === "string" &&
    RESPONSE_EXPLANATION_DEPTH.has((value?.explanationDepth ?? fallback.explanationDepth) as string)
      ? (value?.explanationDepth ?? fallback.explanationDepth)
      : undefined,
  jargonLevel:
    typeof (value?.jargonLevel ?? fallback.jargonLevel) === "string" &&
    RESPONSE_JARGON_LEVEL.has((value?.jargonLevel ?? fallback.jargonLevel) as string)
      ? (value?.jargonLevel ?? fallback.jargonLevel)
      : undefined,
  codePreference:
    typeof (value?.codePreference ?? fallback.codePreference) === "string" &&
    RESPONSE_CODE_PREFERENCE.has((value?.codePreference ?? fallback.codePreference) as string)
      ? (value?.codePreference ?? fallback.codePreference)
      : undefined,
  clarifyBehavior:
    typeof (value?.clarifyBehavior ?? fallback.clarifyBehavior) === "string" &&
    RESPONSE_CLARIFY_BEHAVIOR.has((value?.clarifyBehavior ?? fallback.clarifyBehavior) as string)
      ? (value?.clarifyBehavior ?? fallback.clarifyBehavior)
      : undefined,
  formattingStyle:
    typeof (value?.formattingStyle ?? fallback.formattingStyle) === "string" &&
    RESPONSE_FORMATTING_STYLE.has((value?.formattingStyle ?? fallback.formattingStyle) as string)
      ? (value?.formattingStyle ?? fallback.formattingStyle)
      : undefined,
  extraInstructions: (value?.extraInstructions ?? fallback.extraInstructions)?.trim() || undefined
});

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

export interface UserStore {
  ensureDefaultAdminUser(input: BootstrapAdminInput): Promise<User>;
  listUsers(): Promise<User[]>;
  getUser(userId: string): Promise<User | null>;
  getAuthSessionUser(userId: string): Promise<AuthSessionUser | null>;
  authenticate(email: string, password: string): Promise<User | null>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(userId: string, input: UpdateUserInput): Promise<User | null>;
  deleteUser(userId: string): Promise<boolean>;
  hasUsersWithRole(roleId: string): Promise<boolean>;
  listUserIdsByRoleId(roleId: string): Promise<string[]>;
}

export class RedisUserStore implements UserStore {
  constructor(
    private readonly redis: Redis,
    private readonly roleStore: RoleStore,
    private readonly repositoryStore: RepositoryStore
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
      agentResponsePreference: normalizeAgentResponsePreference(user.agentResponsePreference),
      roleIds: Array.from(new Set((user.roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))),
      repositoryIds: Array.from(new Set((user.repositoryIds ?? []).map((repositoryId) => repositoryId.trim()).filter(Boolean))),
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

  private async normalizeRepositoryIds(repositoryIds: string[] | undefined): Promise<string[]> {
    const uniqueRepositoryIds = Array.from(new Set((repositoryIds ?? []).map((repositoryId) => repositoryId.trim()).filter(Boolean)));
    if (uniqueRepositoryIds.length === 0) {
      return [];
    }

    const repositories = await Promise.all(uniqueRepositoryIds.map((repositoryId) => this.repositoryStore.getRepository(repositoryId)));
    const missingRepositoryId = uniqueRepositoryIds.find((repositoryId, index) => !repositories[index]);
    if (missingRepositoryId) {
      throw new HttpError(400, `Unknown repository: ${missingRepositoryId}`);
    }

    return uniqueRepositoryIds;
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
      agentResponsePreference: user.agentResponsePreference,
      roles: this.buildRoleRefs(roles),
      repositoryIds: user.repositoryIds,
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
      allowedEfforts,
      agentResponsePreference: user.agentResponsePreference
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

    const [roleIds, repositoryIds] = await Promise.all([
      this.normalizeRoleIds(input.roleIds),
      this.normalizeRepositoryIds(input.repositoryIds)
    ]);
    const timestamp = nowIso();
    const passwordState = await hashPassword(password);
    const user: StoredUserRecord = {
      id: nanoid(),
      name,
      email,
      active: input.active !== false,
      agentResponsePreference: normalizeAgentResponsePreference(input.agentResponsePreference),
      roleIds,
      repositoryIds,
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

    const [nextRoleIds, nextRepositoryIds] = await Promise.all([
      input.roleIds === undefined ? Promise.resolve(current.roleIds) : this.normalizeRoleIds(input.roleIds),
      input.repositoryIds === undefined ? Promise.resolve(current.repositoryIds) : this.normalizeRepositoryIds(input.repositoryIds)
    ]);
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
      agentResponsePreference:
        input.agentResponsePreference === undefined
          ? current.agentResponsePreference
          : normalizeAgentResponsePreference(input.agentResponsePreference, current.agentResponsePreference),
      roleIds: nextRoleIds,
      repositoryIds: nextRepositoryIds,
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
}

export class PostgresUserStore implements UserStore {
  constructor(
    private readonly pool: Pool,
    private readonly roleStore: RoleStore,
    private readonly repositoryStore: RepositoryStore
  ) {}

  private mapUserRow(row: Record<string, unknown>, roleIds: string[], repositoryIds: string[]): StoredUserRecord {
    return this.normalizeStoredUser({
      id: String(row.id),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      active: row.active !== false,
      agentResponsePreference: normalizeAgentResponsePreference(
        row.agent_response_preference && typeof row.agent_response_preference === "object"
          ? (row.agent_response_preference as Partial<AgentResponsePreference>)
          : undefined
      ),
      roleIds,
      repositoryIds,
      passwordHash: String(row.password_hash ?? ""),
      passwordSalt: String(row.password_salt ?? ""),
      lastLoginAt: typeof row.last_login_at === "string" ? row.last_login_at : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    });
  }

  private normalizeStoredUser(user: StoredUserRecord): StoredUserRecord {
    return {
      ...user,
      name: normalizeUserName(user.name),
      email: normalizeUserEmail(user.email),
      active: user.active !== false,
      agentResponsePreference: normalizeAgentResponsePreference(user.agentResponsePreference),
      roleIds: Array.from(new Set((user.roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))),
      repositoryIds: Array.from(new Set((user.repositoryIds ?? []).map((repositoryId) => repositoryId.trim()).filter(Boolean))),
      lastLoginAt: user.lastLoginAt ?? null
    };
  }

  private async getRoleIdsForUsers(
    userIds: string[],
    db: PostgresQueryable = this.pool
  ): Promise<Map<string, string[]>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const result = await db.query<{ user_id: string; role_id: string }>(
      "SELECT user_id, role_id FROM user_roles WHERE user_id = ANY($1::text[]) ORDER BY role_id ASC",
      [userIds]
    );
    const roleIdsByUser = new Map<string, string[]>();
    for (const row of result.rows) {
      const roleIds = roleIdsByUser.get(row.user_id) ?? [];
      roleIds.push(row.role_id);
      roleIdsByUser.set(row.user_id, roleIds);
    }
    return roleIdsByUser;
  }

  private async getRepositoryIdsForUsers(
    userIds: string[],
    db: PostgresQueryable = this.pool
  ): Promise<Map<string, string[]>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const result = await db.query<{ user_id: string; repository_id: string }>(
      "SELECT user_id, repository_id FROM user_repositories WHERE user_id = ANY($1::text[]) ORDER BY repository_id ASC",
      [userIds]
    );
    const repositoryIdsByUser = new Map<string, string[]>();
    for (const row of result.rows) {
      const repositoryIds = repositoryIdsByUser.get(row.user_id) ?? [];
      repositoryIds.push(row.repository_id);
      repositoryIdsByUser.set(row.user_id, repositoryIds);
    }
    return repositoryIdsByUser;
  }

  private async getStoredUsers(userIds: string[], db: PostgresQueryable = this.pool): Promise<StoredUserRecord[]> {
    if (userIds.length === 0) {
      return [];
    }

    const result = await db.query("SELECT * FROM users WHERE id = ANY($1::text[])", [userIds]);
    const roleIdsByUser = await this.getRoleIdsForUsers(userIds, db);
    const repositoryIdsByUser = await this.getRepositoryIdsForUsers(userIds, db);
    const usersById = new Map<string, StoredUserRecord>();
    for (const row of result.rows) {
      const userId = String(row.id);
      usersById.set(userId, this.mapUserRow(row, roleIdsByUser.get(userId) ?? [], repositoryIdsByUser.get(userId) ?? []));
    }

    return userIds.flatMap((userId) => {
      const user = usersById.get(userId);
      return user ? [user] : [];
    });
  }

  private async getStoredUser(userId: string, db: PostgresQueryable = this.pool): Promise<StoredUserRecord | null> {
    const users = await this.getStoredUsers([userId], db);
    return users[0] ?? null;
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

  private async normalizeRepositoryIds(repositoryIds: string[] | undefined): Promise<string[]> {
    const uniqueRepositoryIds = Array.from(new Set((repositoryIds ?? []).map((repositoryId) => repositoryId.trim()).filter(Boolean)));
    if (uniqueRepositoryIds.length === 0) {
      return [];
    }

    const repositories = await Promise.all(uniqueRepositoryIds.map((repositoryId) => this.repositoryStore.getRepository(repositoryId)));
    const missingRepositoryId = uniqueRepositoryIds.find((repositoryId, index) => !repositories[index]);
    if (missingRepositoryId) {
      throw new HttpError(400, `Unknown repository: ${missingRepositoryId}`);
    }

    return uniqueRepositoryIds;
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
      agentResponsePreference: user.agentResponsePreference,
      roles: this.buildRoleRefs(roles),
      repositoryIds: user.repositoryIds,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private async countOtherActiveAdmins(excludedUserId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM users
        INNER JOIN user_roles ON user_roles.user_id = users.id
        WHERE users.id <> $1
          AND users.active = TRUE
          AND user_roles.role_id = $2
      `,
      [excludedUserId, SYSTEM_ADMIN_ROLE_ID]
    );
    return Number(result.rows[0]?.count ?? 0);
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

  private async persistUser(
    nextUser: StoredUserRecord,
    previousUser?: StoredUserRecord,
    db: PostgresQueryable = this.pool
  ): Promise<void> {
    await db.query(
      `
        INSERT INTO users (
          id,
          name,
          email,
          active,
          agent_response_preference,
          password_hash,
          password_salt,
          last_login_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          active = EXCLUDED.active,
          agent_response_preference = EXCLUDED.agent_response_preference,
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          last_login_at = EXCLUDED.last_login_at,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        nextUser.id,
        nextUser.name,
        nextUser.email,
        nextUser.active,
        JSON.stringify(nextUser.agentResponsePreference),
        nextUser.passwordHash,
        nextUser.passwordSalt,
        nextUser.lastLoginAt,
        nextUser.createdAt,
        nextUser.updatedAt
      ]
    );
    await db.query("DELETE FROM user_roles WHERE user_id = $1", [nextUser.id]);
    await db.query("DELETE FROM user_repositories WHERE user_id = $1", [nextUser.id]);
    if (nextUser.roleIds.length > 0) {
      await db.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          SELECT $1, role_id
          FROM unnest($2::text[]) AS role_id
          ON CONFLICT DO NOTHING
        `,
        [nextUser.id, nextUser.roleIds]
      );
    }
    if (nextUser.repositoryIds.length > 0) {
      await db.query(
        `
          INSERT INTO user_repositories (user_id, repository_id)
          SELECT $1, repository_id
          FROM unnest($2::text[]) AS repository_id
          ON CONFLICT DO NOTHING
        `,
        [nextUser.id, nextUser.repositoryIds]
      );
    }
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
    await withPostgresTransaction(this.pool, async (client) => {
      await this.persistUser(next, user, client);
    });
    return next;
  }

  async ensureDefaultAdminUser(input: BootstrapAdminInput): Promise<User> {
    const markerResult = await this.pool.query<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = $1",
      [BOOTSTRAP_ADMIN_MARKER_KEY]
    );
    const markerUserId = markerResult.rows[0]?.value ?? null;
    if (markerUserId) {
      const markedUser = await this.getStoredUser(markerUserId);
      if (markedUser) {
        const repairedUser = await this.setBootstrapAdminRoleIfMissing(markedUser);
        return this.sanitizeUser(repairedUser);
      }
    }

    const normalizedEmail = normalizeUserEmail(input.email);
    const existingUserResult = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    const existingUserId = existingUserResult.rows[0]?.id ?? null;
    if (existingUserId) {
      const existingUser = await this.getStoredUser(existingUserId);
      if (existingUser) {
        const repairedUser = await this.setBootstrapAdminRoleIfMissing(existingUser);
        await this.pool.query(
          `
            INSERT INTO app_metadata (key, value, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
          `,
          [BOOTSTRAP_ADMIN_MARKER_KEY, repairedUser.id, nowIso()]
        );
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
    await this.pool.query(
      `
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [BOOTSTRAP_ADMIN_MARKER_KEY, createdUser.id, nowIso()]
    );
    return createdUser;
  }

  async listUsers(): Promise<User[]> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM users ORDER BY name ASC, email ASC");
    const users = await this.getStoredUsers(result.rows.map((row) => row.id));
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
      allowedEfforts,
      agentResponsePreference: user.agentResponsePreference
    };
  }

  async authenticate(email: string, password: string): Promise<User | null> {
    const normalizedEmail = normalizeUserEmail(email);
    if (!normalizedEmail || !password) {
      return null;
    }

    const result = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    const userId = result.rows[0]?.id ?? null;
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
    await withPostgresTransaction(this.pool, async (client) => {
      await this.persistUser(next, user, client);
    });
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

    const existingUserResult = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
    if (existingUserResult.rowCount) {
      throw new HttpError(409, "A user with that email already exists");
    }

    const [roleIds, repositoryIds] = await Promise.all([
      this.normalizeRoleIds(input.roleIds),
      this.normalizeRepositoryIds(input.repositoryIds)
    ]);
    const timestamp = nowIso();
    const passwordState = await hashPassword(password);
    const user: StoredUserRecord = {
      id: nanoid(),
      name,
      email,
      active: input.active !== false,
      agentResponsePreference: normalizeAgentResponsePreference(input.agentResponsePreference),
      roleIds,
      repositoryIds,
      passwordHash: passwordState.passwordHash,
      passwordSalt: passwordState.passwordSalt,
      lastLoginAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await withPostgresTransaction(this.pool, async (client) => {
      await this.persistUser(user, undefined, client);
    });
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
      const existingUserResult = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [nextEmail]);
      const existingUserId = existingUserResult.rows[0]?.id ?? null;
      if (existingUserId && existingUserId !== userId) {
        throw new HttpError(409, "A user with that email already exists");
      }
    }

    const [nextRoleIds, nextRepositoryIds] = await Promise.all([
      input.roleIds === undefined ? Promise.resolve(current.roleIds) : this.normalizeRoleIds(input.roleIds),
      input.repositoryIds === undefined ? Promise.resolve(current.repositoryIds) : this.normalizeRepositoryIds(input.repositoryIds)
    ]);
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
      agentResponsePreference:
        input.agentResponsePreference === undefined
          ? current.agentResponsePreference
          : normalizeAgentResponsePreference(input.agentResponsePreference, current.agentResponsePreference),
      roleIds: nextRoleIds,
      repositoryIds: nextRepositoryIds,
      passwordHash,
      passwordSalt,
      updatedAt: nowIso()
    };

    await withPostgresTransaction(this.pool, async (client) => {
      await this.persistUser(next, current, client);
    });
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

    await this.pool.query("DELETE FROM users WHERE id = $1", [userId]);
    return true;
  }

  async hasUsersWithRole(roleId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM user_roles WHERE role_id = $1) AS exists",
      [roleId]
    );
    return result.rows[0]?.exists === true;
  }

  async listUserIdsByRoleId(roleId: string): Promise<string[]> {
    const result = await this.pool.query<{ user_id: string }>(
      "SELECT user_id FROM user_roles WHERE role_id = $1 ORDER BY user_id ASC",
      [roleId]
    );
    return result.rows.map((row) => row.user_id);
  }
}
