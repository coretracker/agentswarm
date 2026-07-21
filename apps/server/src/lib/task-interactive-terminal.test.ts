import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildTerminalDockerEnvEntries, buildTerminalEnvEntries, buildTaskRuntimeGitEnvEntries } from "./task-interactive-terminal-git-env.js";
import { buildTerminalStartScript } from "./task-interactive-terminal-start-script.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const runtimeDockerfilePath = path.join(repoRoot, "agent-runtime/Dockerfile");

describe("buildTerminalStartScript", () => {
  it("generates shell syntax that parses under sh", () => {
    const script = buildTerminalStartScript();
    const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept terminal start script");
    assert.match(script, /\n\s+printf '%s\\n'/);
    assert.doesNotMatch(script, /then;\s/);
    assert.match(script, /Full toolbox shell available/);
    assert.match(script, /cp -a \/verft-base\/codex "\$HOME\/\.codex"/);
    assert.match(script, /cp -a \/verft-base\/claude "\$HOME\/\.claude"/);
    assert.match(script, /cp -a \/verft-base\/claude\.json "\$HOME\/\.claude\.json"/);
    assert.match(script, /chown -R agent:agent "\$HOME" "\$TASK_INTERACTIVE_WORKSPACE"/);
    assert.match(script, /\$HOME\/\.claude\/mcp-config\.json/);
    assert.match(script, /\/tmp\/verft-bin\/claude/);
    assert.match(script, /chown -R agent:agent \/tmp\/verft-bin/);
    assert.match(script, /chmod 755 \/tmp\/verft-bin \/tmp\/verft-bin\/claude/);
    assert.match(script, /HOSTEXEC_BIN_PATH/);
    assert.match(script, /export PATH="\$\{HOSTEXEC_BIN_PATH\}:\$PATH"/);
    assert.match(script, /su-exec agent:agent bash -lc/);
    assert.match(script, /exec bash -i/);
    assert.match(script, /su-exec agent:agent sh -lc/);
    assert.match(script, /exec sh -i'$/);
  });

  it("ships the unified runtime toolbox with shell and git tooling", () => {
    const dockerfile = readFileSync(runtimeDockerfilePath, "utf8");

    assert.match(dockerfile, /FROM node:20-bookworm/);
    assert.match(dockerfile, /\bgh\b/);
    assert.match(dockerfile, /https:\/\/download\.docker\.com\/linux\/debian/);
    assert.match(dockerfile, /\bdocker-ce-cli\b/);
    assert.match(dockerfile, /\bdocker-buildx-plugin\b/);
    assert.match(dockerfile, /\bdocker-compose-plugin\b/);
    assert.doesNotMatch(dockerfile, /\bdocker\.io\b/);
    assert.match(dockerfile, /COPY run-task-codex\.mjs/);
    assert.match(dockerfile, /COPY run-task-claude\.mjs/);
    assert.doesNotMatch(dockerfile, /COPY verft-base-state\.mjs/);
    assert.match(dockerfile, /COPY hostexec-proxy\.mjs/);
  });
});

describe("buildTerminalEnvEntries", () => {
  it("builds Git runtime env entries for automated task containers", () => {
    const env = Object.fromEntries(
      buildTaskRuntimeGitEnvEntries({
        workspacePath: "/workspace",
        githubToken: "secret-token",
        gitUsername: "octocat",
        gitIdentity: {
          name: "Ada Lovelace",
          email: "ada@example.com"
        }
      })
    );

    assert.equal(env.GIT_OPTIONAL_LOCKS, "0");
    assert.equal(env.GIT_CONFIG_COUNT, "3");
    assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_0, "/workspace");
    assert.equal(env.GIT_CONFIG_KEY_1, "user.name");
    assert.equal(env.GIT_CONFIG_VALUE_1, "Ada Lovelace");
    assert.equal(env.GIT_CONFIG_KEY_2, "user.email");
    assert.equal(env.GIT_CONFIG_VALUE_2, "ada@example.com");
    assert.equal(env.GIT_TOKEN, "secret-token");
    assert.equal(env.GH_TOKEN, "secret-token");
    assert.equal(env.GIT_USERNAME, "octocat");
    assert.equal(env.GIT_AUTHOR_NAME, "Ada Lovelace");
    assert.equal(env.GIT_COMMITTER_EMAIL, "ada@example.com");
    assert.equal(env.TERM, undefined);
    assert.equal(env.HOME, undefined);
  });

  it("injects git identity as transient config for interactive commits", () => {
    const env = Object.fromEntries(
      buildTerminalEnvEntries({
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
    assert.equal(env.HOME, "/home/agent");
  });

  it("keeps token auth and safe.directory when identity is unavailable", () => {
    const env = Object.fromEntries(
      buildTerminalEnvEntries({
        workspacePath: "/workspace",
        githubToken: "secret-token",
        gitUsername: "octocat"
      })
    );

    assert.equal(env.GIT_CONFIG_COUNT, "1");
    assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_0, "/workspace");
    assert.equal(env.GIT_TOKEN, "secret-token");
    assert.equal(env.GH_TOKEN, "secret-token");
    assert.equal(env.GIT_USERNAME, "octocat");
    assert.equal(env.GIT_AUTHOR_NAME, undefined);
    assert.equal(env.GIT_AUTHOR_EMAIL, undefined);
    assert.equal(env.GIT_COMMITTER_NAME, undefined);
    assert.equal(env.GIT_COMMITTER_EMAIL, undefined);
  });
});

describe("buildTerminalDockerEnvEntries", () => {
  it("appends repository runtime env entries to terminal runtime env entries", () => {
    const envEntries = buildTerminalDockerEnvEntries({
      runtimeEnvEntries: [
        ["TERM", "xterm-256color"],
        ["TASK_INTERACTIVE_WORKSPACE", "/workspace"]
      ],
      repositoryEnvEntries: [
        ["FOO", "bar"],
        ["EMPTY_OK", ""],
        ["API_TOKEN", "token-123"]
      ]
    });

    assert.deepEqual(envEntries, [
      ["TERM", "xterm-256color"],
      ["TASK_INTERACTIVE_WORKSPACE", "/workspace"],
      ["FOO", "bar"],
      ["EMPTY_OK", ""],
      ["API_TOKEN", "token-123"]
    ]);
  });
});
