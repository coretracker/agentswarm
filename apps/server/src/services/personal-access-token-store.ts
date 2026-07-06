import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { Pool } from "pg";
import {
  ALL_PERMISSION_SCOPES,
  normalizePermissionScope,
  type AuthSessionUser,
  type CreatedPersonalAccessToken,
  type PermissionScope,
  type PersonalAccessToken
} from "@verft/shared-types";
import type { UserStore } from "./user-store.js";

const TOKEN_PREFIX = "asw_pat";
const TOKEN_RANDOM_BYTES = 32;
const TOKEN_PREFIX_CHARS = 18;

const nowIso = (): string => new Date().toISOString();
const validScopes = new Set<PermissionScope>(ALL_PERMISSION_SCOPES);

export type PersonalAccessTokenRuntimeContext = null;

export interface CreatePersonalAccessTokenInput {
  userId: string;
  name: string;
  scopes?: PermissionScope[];
  expiresAt?: string | null;
  runtimeContext?: PersonalAccessTokenRuntimeContext | null;
}

export interface AuthenticatedPersonalAccessToken {
  user: AuthSessionUser;
  runtimeContext: PersonalAccessTokenRuntimeContext | null;
}

export interface PersonalAccessTokenStore {
  createToken(input: CreatePersonalAccessTokenInput): Promise<CreatedPersonalAccessToken>;
  listTokens(userId: string): Promise<PersonalAccessToken[]>;
  revokeToken(userId: string, tokenId: string): Promise<PersonalAccessToken | null>;
  authenticateToken(token: string): Promise<AuthenticatedPersonalAccessToken | null>;
}

const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ");

const normalizeScopes = (scopes: PermissionScope[] | string[] | undefined): PermissionScope[] =>
  Array.from(
    new Set(
      (scopes ?? ALL_PERMISSION_SCOPES)
        .map((scope) => normalizePermissionScope(String(scope)))
        .filter((scope): scope is PermissionScope => scope !== null && validScopes.has(scope))
    )
  ).sort(
    (left, right) => ALL_PERMISSION_SCOPES.indexOf(left) - ALL_PERMISSION_SCOPES.indexOf(right)
  );

const normalizeExpiresAt = (expiresAt: string | null | undefined): string | null => {
  const value = expiresAt?.trim();
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Token expiration must be a valid date.");
  }
  return new Date(timestamp).toISOString();
};

const normalizeRuntimeContext = (_value: unknown): PersonalAccessTokenRuntimeContext => null;

export class PostgresPersonalAccessTokenStore implements PersonalAccessTokenStore {
  constructor(
    private readonly pool: Pool,
    private readonly userStore: UserStore
  ) {}

  private mapTokenRow(row: Record<string, unknown>): PersonalAccessToken {
    const scopes = Array.isArray(row.scopes) ? normalizeScopes(row.scopes.filter((scope): scope is string => typeof scope === "string")) : [];
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      scopes,
      tokenPrefix: String(row.token_prefix ?? ""),
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
      lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      createdAt: String(row.created_at)
    };
  }

  async createToken(input: CreatePersonalAccessTokenInput): Promise<CreatedPersonalAccessToken> {
    const name = normalizeName(input.name);
    if (!name) {
      throw new Error("Token name is required.");
    }
    const user = await this.userStore.getAuthSessionUser(input.userId);
    if (!user) {
      throw new Error("User not found.");
    }

    const granted = new Set(user.scopes);
    const scopes = normalizeScopes(input.scopes).filter((scope) => granted.has(scope));
    if (scopes.length === 0) {
      throw new Error("Token must include at least one scope.");
    }

    const token = `${TOKEN_PREFIX}_${randomBytes(TOKEN_RANDOM_BYTES).toString("base64url")}`;
    const tokenHash = hashToken(token);
    const tokenPrefix = token.slice(0, TOKEN_PREFIX_CHARS);
    const createdAt = nowIso();
    const expiresAt = normalizeExpiresAt(input.expiresAt);
    const id = nanoid();

    await this.pool.query(
      `
        INSERT INTO personal_access_tokens (
          id,
          user_id,
          name,
          token_hash,
          token_prefix,
          scopes,
          runtime_context,
          expires_at,
          last_used_at,
          revoked_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NULL, NULL, $9)
      `,
      [
        id,
        input.userId,
        name,
        tokenHash,
        tokenPrefix,
        JSON.stringify(scopes),
        JSON.stringify(normalizeRuntimeContext(input.runtimeContext)),
        expiresAt,
        createdAt
      ]
    );

    return {
      id,
      name,
      scopes,
      tokenPrefix,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt,
      token
    };
  }

  async listTokens(userId: string): Promise<PersonalAccessToken[]> {
    const result = await this.pool.query<{ id: string; user_id: string; scopes: unknown; expires_at: string | null }>(
      `
        SELECT id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
        FROM personal_access_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    );
    return result.rows.map((row) => this.mapTokenRow(row));
  }

  async revokeToken(userId: string, tokenId: string): Promise<PersonalAccessToken | null> {
    const revokedAt = nowIso();
    const result = await this.pool.query(
      `
        UPDATE personal_access_tokens
        SET revoked_at = COALESCE(revoked_at, $3)
        WHERE user_id = $1 AND id = $2
        RETURNING id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
      `,
      [userId, tokenId, revokedAt]
    );
    const row = result.rows[0];
    return row ? this.mapTokenRow(row) : null;
  }

  async authenticateToken(token: string): Promise<AuthenticatedPersonalAccessToken | null> {
    const normalized = token.trim();
    if (!normalized.startsWith(`${TOKEN_PREFIX}_`)) {
      return null;
    }

    const result = await this.pool.query(
      `
        SELECT id, user_id, scopes, runtime_context, expires_at
        FROM personal_access_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
        LIMIT 1
      `,
      [hashToken(normalized)]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const expiresAt = typeof row.expires_at === "string" ? row.expires_at : null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return null;
    }

    const user = await this.userStore.getAuthSessionUser(String(row.user_id));
    if (!user) {
      return null;
    }

    const rawScopes = Array.isArray(row.scopes) ? (row.scopes as unknown[]) : [];
    const tokenScopes = rawScopes.length > 0
      ? normalizeScopes(rawScopes.filter((scope): scope is string => typeof scope === "string"))
      : [];
    const userScopes = new Set(user.scopes);
    const scopes = tokenScopes.filter((scope) => userScopes.has(scope));
    if (scopes.length === 0) {
      return null;
    }

    await this.pool.query("UPDATE personal_access_tokens SET last_used_at = $2 WHERE id = $1", [String(row.id), nowIso()]);
    return {
      user: {
        ...user,
        scopes
      },
      runtimeContext: normalizeRuntimeContext(row.runtime_context)
    };
  }
}
