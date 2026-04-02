import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGitRuntimeMountsForPaths } from "./git-runtime-mounts.js";

describe("resolveGitRuntimeMountsForPaths", () => {
  it("does not add mounts for regular clone workspaces", () => {
    const mounts = resolveGitRuntimeMountsForPaths({
      gitDir: "/task-workspaces/task-1/.git",
      commonDir: "/task-workspaces/task-1/.git",
      usesLinkedWorktree: false
    });

    assert.deepEqual(mounts, []);
  });

  it("mounts the shared repo cache for linked worktrees", () => {
    const mounts = resolveGitRuntimeMountsForPaths({
      gitDir: "/repo-cache/repos/example/.git/worktrees/task-1",
      commonDir: "/repo-cache/repos/example/.git",
      usesLinkedWorktree: true
    });

    assert.deepEqual(mounts, ["-v", "agentswarm_repo_cache:/repo-cache:rw"]);
  });

  it("skips extra mounts when linked worktree metadata lives outside the repo cache root", () => {
    const mounts = resolveGitRuntimeMountsForPaths({
      gitDir: "/tmp/git/worktrees/task-1",
      commonDir: "/tmp/git",
      usesLinkedWorktree: true
    });

    assert.deepEqual(mounts, []);
  });
});
