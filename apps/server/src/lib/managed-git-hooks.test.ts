import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { installManagedGitHooks, MANAGED_GIT_HOOKS } from "./managed-git-hooks.js";

describe("installManagedGitHooks", () => {
  it("writes blocking git hooks with execute permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-managed-hooks-"));
    const gitDir = path.join(root, ".git");

    try {
      await mkdir(gitDir, { recursive: true });
      await installManagedGitHooks(gitDir);

      for (const [hookName, content] of Object.entries(MANAGED_GIT_HOOKS)) {
        const hookPath = path.join(gitDir, "hooks", hookName);
        assert.equal(await readFile(hookPath, "utf8"), content);
        assert.equal((await stat(hookPath)).mode & 0o777, 0o755);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("installs hooks into the shared common dir for linked worktrees", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-managed-hooks-"));
    const workspacePath = path.join(root, "workspace");
    const commonDir = path.join(root, "repo", ".git");
    const worktreeGitDir = path.join(commonDir, "worktrees", "task-1");
    const dotGitPath = path.join(workspacePath, ".git");

    try {
      await mkdir(workspacePath, { recursive: true });
      await mkdir(worktreeGitDir, { recursive: true });
      await writeFile(path.join(worktreeGitDir, "commondir"), "../..", "utf8");
      await writeFile(dotGitPath, "gitdir: ../repo/.git/worktrees/task-1\n", "utf8");

      await installManagedGitHooks(dotGitPath);

      for (const [hookName, content] of Object.entries(MANAGED_GIT_HOOKS)) {
        const hookPath = path.join(commonDir, "hooks", hookName);
        assert.equal(await readFile(hookPath, "utf8"), content);
        assert.equal((await stat(hookPath)).mode & 0o777, 0o755);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
