import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSessionUser, Repository } from "@agentswarm/shared-types";
import { SYSTEM_ADMIN_ROLE_ID } from "../services/role-store.js";
import { canUserAccessRepository } from "./repository-access.js";

const makeRepository = (overrides: Partial<Repository> = {}): Repository => ({
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/example/repo.git",
  defaultBranch: "main",
  userIds: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const makeUser = (overrides: Partial<AuthSessionUser> = {}): AuthSessionUser => ({
  id: "user-1",
  name: "User",
  email: "user@example.com",
  active: true,
  roles: [],
  scopes: [],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: [],
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("canUserAccessRepository", () => {
  it("allows admins even when they are not explicitly assigned", () => {
    const repository = makeRepository();
    const user = makeUser({
      roles: [{ id: SYSTEM_ADMIN_ROLE_ID, name: "Administrator", isSystem: true }]
    });

    assert.equal(canUserAccessRepository(user, repository), true);
  });

  it("allows assigned non-admin users", () => {
    const repository = makeRepository({ userIds: ["user-1"] });
    const user = makeUser();

    assert.equal(canUserAccessRepository(user, repository), true);
  });

  it("rejects unassigned non-admin users", () => {
    const repository = makeRepository({ userIds: ["user-2"] });
    const user = makeUser();

    assert.equal(canUserAccessRepository(user, repository), false);
  });
});
