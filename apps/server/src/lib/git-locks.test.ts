import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractGitLockPathFromErrorMessage, isPathInside, resolveGitTargetLockKey } from "./git-locks.js";

describe("extractGitLockPathFromErrorMessage", () => {
  it("returns the lock path from a git unable-to-create error", () => {
    const message =
      "fatal: Unable to create '/task-workspaces/task-1/.git/index.lock': File exists.\nAnother git process seems to be running.";
    assert.equal(extractGitLockPathFromErrorMessage(message), "/task-workspaces/task-1/.git/index.lock");
  });

  it("returns null when the message does not include a lock path", () => {
    assert.equal(extractGitLockPathFromErrorMessage("fatal: not a git repository"), null);
  });
});

describe("resolveGitTargetLockKey", () => {
  it("uses the -C repository path", () => {
    assert.equal(resolveGitTargetLockKey(["-C", "/task-workspaces/task-1", "status"]), "/task-workspaces/task-1");
  });

  it("uses the --git-dir repository path", () => {
    assert.equal(
      resolveGitTargetLockKey(["--git-dir", "/repo-cache/example.git", "show", "main:README.md"]),
      "/repo-cache/example.git"
    );
  });

  it("uses the destination path for clone", () => {
    assert.equal(
      resolveGitTargetLockKey(["clone", "--no-local", "/repo-cache/example.git", "/task-workspaces/task-1"]),
      "/task-workspaces/task-1"
    );
  });

  it("returns null for git commands without a local target", () => {
    assert.equal(resolveGitTargetLockKey(["ls-remote", "--heads", "https://github.com/openai/openai-node.git"]), null);
  });
});

describe("isPathInside", () => {
  it("accepts paths within the root", () => {
    assert.equal(isPathInside("/task-workspaces", "/task-workspaces/task-1/.git/index.lock"), true);
  });

  it("rejects paths outside the root", () => {
    assert.equal(isPathInside("/task-workspaces", "/tmp/index.lock"), false);
  });
});
