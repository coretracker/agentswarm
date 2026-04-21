import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildGitTerminalEnvEntries } from "./task-interactive-terminal-git-env.js";
import { buildGitTerminalStartScript } from "./task-interactive-terminal-start-script.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const gitTerminalShellPath = path.join(repoRoot, "tools/codex-web-terminal/git-terminal-shell.sh");
const gitTerminalDockerfilePath = path.join(repoRoot, "tools/codex-web-terminal/Dockerfile.git");

describe("buildGitTerminalStartScript", () => {
  it("generates shell syntax that parses under sh", () => {
    const script = buildGitTerminalStartScript();
    const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept git terminal start script");
    assert.match(script, /\n\s+printf '%s\\n'/);
    assert.doesNotMatch(script, /then;\s/);
    assert.match(script, /exec git-terminal-shell$/);
  });

  it("ships the git terminal wrapper with a restricted bash shell", () => {
    const shellScript = readFileSync(gitTerminalShellPath, "utf8");
    const dockerfile = readFileSync(gitTerminalDockerfilePath, "utf8");
    const result = spawnSync("sh", ["-n", gitTerminalShellPath], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept git terminal shell wrapper");
    assert.match(shellScript, /exec \/bin\/bash --noprofile --norc --restricted -i/);
    assert.match(dockerfile, /\bapk add --no-cache bash git vim diffutils ca-certificates\b/);
  });
});

describe("buildGitTerminalEnvEntries", () => {
  it("injects git identity as transient config for interactive commits", () => {
    const env = Object.fromEntries(
      buildGitTerminalEnvEntries({
        workspacePath: "/workspace",
        gitIdentity: {
          name: "Ada Lovelace",
          email: "ada@example.com"
        }
      })
    );

    assert.equal(env.GIT_CONFIG_COUNT, "3");
    assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_0, "/workspace");
    assert.equal(env.GIT_CONFIG_KEY_1, "user.name");
    assert.equal(env.GIT_CONFIG_VALUE_1, "Ada Lovelace");
    assert.equal(env.GIT_CONFIG_KEY_2, "user.email");
    assert.equal(env.GIT_CONFIG_VALUE_2, "ada@example.com");
    assert.equal(env.GIT_AUTHOR_NAME, "Ada Lovelace");
    assert.equal(env.GIT_AUTHOR_EMAIL, "ada@example.com");
    assert.equal(env.GIT_COMMITTER_NAME, "Ada Lovelace");
    assert.equal(env.GIT_COMMITTER_EMAIL, "ada@example.com");
  });

  it("keeps token auth and safe.directory when identity is unavailable", () => {
    const env = Object.fromEntries(
      buildGitTerminalEnvEntries({
        workspacePath: "/workspace",
        githubToken: "secret-token",
        gitUsername: "octocat"
      })
    );

    assert.equal(env.GIT_CONFIG_COUNT, "1");
    assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_0, "/workspace");
    assert.equal(env.GIT_TOKEN, "secret-token");
    assert.equal(env.GIT_USERNAME, "octocat");
    assert.equal(env.GIT_AUTHOR_NAME, undefined);
    assert.equal(env.GIT_AUTHOR_EMAIL, undefined);
    assert.equal(env.GIT_COMMITTER_NAME, undefined);
    assert.equal(env.GIT_COMMITTER_EMAIL, undefined);
  });
});
