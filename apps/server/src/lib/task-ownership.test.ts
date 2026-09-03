import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthSessionUser, Task } from "@verft/shared-types";
import { canUserAccessTask, listTasksAccessibleToUser } from "./task-ownership.js";

const user = (overrides: Partial<AuthSessionUser> = {}): AuthSessionUser => ({
  id: "user-1", name: "Ada", email: "ada@example.com", githubUsername: null, defaultProvider: null, defaultModel: null,
  defaultProviderProfile: null, active: true, roles: [], repositoryIds: ["repo-1"], lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", scopes: [], allowedProviders: [],
  allowedModels: [], allowedEfforts: [], teamMemberUserIds: ["user-1", "user-2"], ...overrides
});

const task = (ownerUserId: string, repoId = "repo-1", shareWithTeam = false): Task => ({ ownerUserId, repoId, shareWithTeam } as Task);

test("task access keeps owners and admins, and admits only shared repository-authorized teammates", () => {
  assert.equal(canUserAccessTask(user(), task("user-1", "repo-2")), true);
  assert.equal(canUserAccessTask(user(), task("user-2")), false);
  assert.equal(canUserAccessTask(user(), task("user-2", "repo-1", true)), true);
  assert.equal(canUserAccessTask(user(), task("user-2", "repo-2", true)), false);
  assert.equal(canUserAccessTask(user(), task("user-3", "repo-1", true)), false);
  assert.equal(canUserAccessTask(user({ teamMemberUserIds: [] }), task("user-2", "repo-1", true)), false);
  assert.equal(canUserAccessTask(user({ roles: [{ id: "admin", name: "Admin", isSystem: true }] }), task("user-3", "repo-2")), true);
});

test("task listing combines own tasks with repository-authorized teammate tasks", async () => {
  const tasks = [
    { ...task("user-1", "repo-2"), id: "own", pinned: false, createdAt: "2026-01-03T00:00:00.000Z" },
    { ...task("user-2", "repo-1", true), id: "team", pinned: false, createdAt: "2026-01-02T00:00:00.000Z" },
    { ...task("user-2"), id: "private", pinned: false, createdAt: "2026-01-05T00:00:00.000Z" },
    { ...task("user-2", "repo-2", true), id: "hidden", pinned: false, createdAt: "2026-01-04T00:00:00.000Z" }
  ] as Task[];
  const listed = await listTasksAccessibleToUser({
    listTasks: async (options: { ownerUserId?: string | null; ownerUserIds?: string[]; repositoryIds?: string[]; shareWithTeam?: boolean }) =>
      tasks.filter((entry) => options.ownerUserId
        ? entry.ownerUserId === options.ownerUserId
        : options.ownerUserIds?.includes(entry.ownerUserId ?? "") && (!options.repositoryIds || options.repositoryIds.includes(entry.repoId)) && (options.shareWithTeam === undefined || entry.shareWithTeam === options.shareWithTeam))
  } as never, user(), { view: "all" });
  assert.deepEqual(listed.map((entry) => entry.id), ["own", "team"]);
});
