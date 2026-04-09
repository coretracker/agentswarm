import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { buildGitProcessEnv } from "./git-env.js";

const execFile = promisify(execFileCallback);

async function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFile("git", args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env
  });
  return result.stdout;
}

describe("buildGitProcessEnv", () => {
  it("sets author and committer identity when provided", async () => {
    const env = await buildGitProcessEnv({
      workspacePath: "/tmp/workspace",
      gitIdentity: {
        name: "Ada Lovelace",
        email: "ada@example.com"
      }
    });

    assert.equal(env.GIT_AUTHOR_NAME, "Ada Lovelace");
    assert.equal(env.GIT_AUTHOR_EMAIL, "ada@example.com");
    assert.equal(env.GIT_COMMITTER_NAME, "Ada Lovelace");
    assert.equal(env.GIT_COMMITTER_EMAIL, "ada@example.com");
  });

  it("allows squash merges in a worktree without relying on global git config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-git-env-"));
    const originPath = path.join(root, "origin.git");
    const seedPath = path.join(root, "seed");
    const managedPath = path.join(root, "managed");
    const worktreePath = path.join(root, "merge-worktree");

    try {
      await git(["init", "--bare", originPath], root);
      await git(["clone", originPath, seedPath], root);

      await git(["checkout", "-b", "main"], seedPath);
      await git(["config", "user.name", "Repo Seeder"], seedPath);
      await git(["config", "user.email", "seed@example.com"], seedPath);
      await git(["config", "commit.gpgsign", "false"], seedPath);
      await git(["config", "tag.gpgsign", "false"], seedPath);
      await git(["config", "init.defaultBranch", "main"], seedPath);

      await git(["-c", "user.name=Repo Seeder", "-c", "user.email=seed@example.com", "commit", "--allow-empty", "-m", "base"], seedPath);
      await git(["push", "-u", "origin", "main"], seedPath);

      await git(["checkout", "-b", "feature"], seedPath);
      await git(["-c", "user.name=Repo Seeder", "-c", "user.email=seed@example.com", "commit", "--allow-empty", "-m", "feature"], seedPath);
      await git(["push", "-u", "origin", "feature"], seedPath);

      await git(["checkout", "main"], seedPath);
      await git(["-c", "user.name=Repo Seeder", "-c", "user.email=seed@example.com", "commit", "--allow-empty", "-m", "main"], seedPath);
      await git(["push", "origin", "main"], seedPath);

      await git(["clone", originPath, managedPath], root);
      await git(["fetch", "origin", "main", "feature"], managedPath);
      await git(["worktree", "add", "-b", "merge-branch", worktreePath, "origin/main"], managedPath);

      const gitEnv = await buildGitProcessEnv({
        workspacePath: worktreePath,
        gitIdentity: {
          name: "Task Owner",
          email: "owner@example.com"
        }
      });

      await git(["-C", worktreePath, "merge", "--squash", "--no-commit", "origin/feature"], root, gitEnv);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
