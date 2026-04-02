import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveGitPaths } from "./git-paths.js";

describe("resolveGitPaths", () => {
  it("returns a standard git directory unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-git-paths-"));
    const gitDir = path.join(root, ".git");

    try {
      await mkdir(gitDir, { recursive: true });
      const resolved = await resolveGitPaths(gitDir);
      assert.deepEqual(resolved, {
        gitDir,
        commonDir: gitDir,
        usesLinkedWorktree: false
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves linked worktree .git files to the shared common dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-git-paths-"));
    const workspacePath = path.join(root, "workspace");
    const commonDir = path.join(root, "repo", ".git");
    const worktreeGitDir = path.join(commonDir, "worktrees", "task-1");
    const dotGitPath = path.join(workspacePath, ".git");

    try {
      await mkdir(workspacePath, { recursive: true });
      await mkdir(worktreeGitDir, { recursive: true });
      await writeFile(path.join(worktreeGitDir, "commondir"), "../..", "utf8");
      await writeFile(dotGitPath, `gitdir: ../repo/.git/worktrees/task-1\n`, "utf8");

      const resolved = await resolveGitPaths(dotGitPath);
      assert.deepEqual(resolved, {
        gitDir: worktreeGitDir,
        commonDir,
        usesLinkedWorktree: true
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
