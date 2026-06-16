import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repository } from "@agentswarm/shared-types";
import {
  buildTaskWorkspaceMap,
  remapTaskWorkspaceMapRoot,
  validateTaskAttachedRepositoriesInput
} from "./task-workspace.js";

const repository = (overrides: Partial<Repository> = {}): Repository =>
  ({
    id: "repo-1",
    name: "Repo",
    url: "https://github.com/example/repo.git",
    defaultBranch: "main",
    envVars: [],
    webhookUrl: null,
    webhookEnabled: false,
    webhookSecretConfigured: false,
    webhookLastAttemptAt: null,
    webhookLastStatus: null,
    webhookLastError: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  }) satisfies Repository as Repository;

describe("task workspace attachments", () => {
  it("rejects reserved or colliding mount names", () => {
    const reserved = validateTaskAttachedRepositoriesInput(
      [
        { repositoryId: "repo-2", mountName: "root", accessMode: "read-only" }
      ],
      { rootRepositoryId: "repo-1", allowExistingAttachmentUpdates: true, hasTaskRun: false }
    );

    assert.equal(reserved.ok, false);
    if (!reserved.ok) {
      assert.match(reserved.message, /invalid entries/i);
    }

    const aliasCollision = validateTaskAttachedRepositoriesInput(
      [
        { repositoryId: "repo-2", mountName: "foo-bar", accessMode: "read-only" },
        { repositoryId: "repo-3", mountName: "foo_bar", accessMode: "read-only" }
      ],
      { rootRepositoryId: "repo-1", allowExistingAttachmentUpdates: true, hasTaskRun: false }
    );

    assert.equal(aliasCollision.ok, false);
    if (!aliasCollision.ok) {
      assert.match(aliasCollision.message, /collides with another attachment alias/i);
    }
  });

  it("builds a root-writable workspace map with read-only attachments", () => {
    const map = buildTaskWorkspaceMap(
      repository(),
      [
        {
          attachment: {
            repositoryId: "repo-2",
            mountName: "shared-utils",
            accessMode: "read-only",
            purpose: "Shared code"
          },
          repository: repository({
            id: "repo-2",
            name: "Shared utils",
            url: "https://github.com/example/shared-utils.git",
            defaultBranch: "main"
          })
        }
      ]
    );

    assert.equal(map.root.mountPath, "/workspace");
    assert.equal(map.root.accessMode, "read-write");
    assert.equal(map.attachedRepositories[0]?.mountPath, "/workspace/repos/shared-utils");
    assert.equal(map.attachedRepositories[0]?.accessMode, "read-only");
  });

  it("remaps workspace map roots without changing attached mount names", () => {
    const map = buildTaskWorkspaceMap(repository(), []);
    const remapped = remapTaskWorkspaceMapRoot(map, "/task-workspaces/task-1");

    assert.equal(remapped.root.mountPath, "/task-workspaces/task-1");
    assert.equal(remapped.root.isRoot, true);
  });
});
