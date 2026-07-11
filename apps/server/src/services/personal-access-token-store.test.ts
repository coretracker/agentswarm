import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSessionUser } from "@verft/shared-types";
import { PostgresPersonalAccessTokenStore } from "./personal-access-token-store.js";

const user: AuthSessionUser = {
  id: "user-1",
  name: "User",
  email: "user@example.com",
  githubUsername: null,
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
  agentResponsePreference: {},
  roles: [],
  repositoryIds: [],
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scopes: ["task:list", "task:read", "repo:list"],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: []
};

class FakePool {
  rows: Array<Record<string, unknown>> = [];

  async query(sql: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    if (sql.includes("INSERT INTO personal_access_tokens")) {
      this.rows.push({
        id: values[0],
        user_id: values[1],
        name: values[2],
        token_hash: values[3],
        token_prefix: values[4],
        scopes: JSON.parse(String(values[5])),
        runtime_context: JSON.parse(String(values[6])),
        expires_at: values[7],
        last_used_at: null,
        revoked_at: null,
        created_at: values[8]
      });
      return { rows: [] };
    }
    if (sql.includes("FROM personal_access_tokens") && sql.includes("WHERE user_id = $1")) {
      return { rows: this.rows.filter((row) => row.user_id === values[0]) };
    }
    if (sql.includes("UPDATE personal_access_tokens") && sql.includes("SET revoked_at")) {
      const row = this.rows.find((candidate) => candidate.user_id === values[0] && candidate.id === values[1]);
      if (!row) {
        return { rows: [] };
      }
      row.revoked_at = row.revoked_at ?? values[2];
      return { rows: [row] };
    }
    if (sql.includes("WHERE token_hash = $1")) {
      return { rows: this.rows.filter((row) => row.token_hash === values[0] && row.revoked_at == null).slice(0, 1) };
    }
    if (sql.includes("SET last_used_at")) {
      const row = this.rows.find((candidate) => candidate.id === values[0]);
      if (row) {
        row.last_used_at = values[1];
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

describe("PostgresPersonalAccessTokenStore", () => {
  it("creates metadata-only listings and authenticates until revoked", async () => {
    const pool = new FakePool();
    const store = new PostgresPersonalAccessTokenStore(pool as never, {
      getAuthSessionUser: async () => user
    } as never);

    const created = await store.createToken({
      userId: user.id,
      name: "Codex",
      scopes: ["task:list", "repo:list"]
    });
    assert.match(created.token, /^asw_pat_/);
    assert.equal(created.name, "Codex");

    const listed = await store.listTokens(user.id);
    assert.equal(listed.length, 1);
    assert.equal("token" in listed[0]!, false);
    assert.equal(listed[0]?.tokenPrefix, created.tokenPrefix);

    const authenticated = await store.authenticateToken(created.token);
    assert.deepEqual(authenticated?.user.scopes, ["task:list", "repo:list"]);
    assert.equal(authenticated?.runtimeContext, null);

    await store.revokeToken(user.id, created.id);
    assert.equal(await store.authenticateToken(created.token), null);
  });

  it("migrates legacy interactive terminal token scopes to terminal access", async () => {
    const pool = new FakePool();
    const terminalUser: AuthSessionUser = {
      ...user,
      scopes: ["task:terminal"]
    };
    const store = new PostgresPersonalAccessTokenStore(pool as never, {
      getAuthSessionUser: async () => terminalUser
    } as never);

    const created = await store.createToken({
      userId: user.id,
      name: "Terminal",
      scopes: ["task:interactive" as never]
    });
    assert.deepEqual(pool.rows[0]?.scopes, ["task:terminal"]);

    pool.rows[0]!.scopes = ["task:interactive"];
    const listed = await store.listTokens(user.id);
    assert.deepEqual(listed[0]?.scopes, ["task:terminal"]);

    const authenticated = await store.authenticateToken(created.token);
    assert.deepEqual(authenticated?.user.scopes, ["task:terminal"]);
  });

  it("does not expose or authenticate removed runtime context", async () => {
    const pool = new FakePool();
    const store = new PostgresPersonalAccessTokenStore(pool as never, {
      getAuthSessionUser: async () => ({ ...user, scopes: ["task:ask"] })
    } as never);

    const created = await store.createToken({
      userId: user.id,
      name: "Runtime token",
      scopes: ["task:ask"],
      runtimeContext: {
        kind: "removed_context",
        contextId: "context-1"
      } as never
    });

    const listed = await store.listTokens(user.id);
    assert.equal("runtimeContext" in listed[0]!, false);

    const authenticated = await store.authenticateToken(created.token);
    assert.equal(authenticated?.runtimeContext, null);
  });
});
