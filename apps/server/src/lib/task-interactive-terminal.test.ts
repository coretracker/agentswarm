import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildTerminalDockerEnvEntries, buildTerminalEnvEntries, buildTaskRuntimeGitEnvEntries } from "./task-interactive-terminal-git-env.js";
import { buildTerminalStartScript } from "./task-interactive-terminal-start-script.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const composePath = path.join(repoRoot, "docker-compose.yml");
const runtimeDockerfilePath = path.join(repoRoot, "agent-runtime/Dockerfile");
const codexRunnerPath = path.join(repoRoot, "agent-runtime/run-task-codex.mjs");
const claudeRunnerPath = path.join(repoRoot, "agent-runtime/run-task-claude.mjs");
const providerPathNormalizerPath = path.join(repoRoot, "agent-runtime/normalize-provider-paths.mjs");

describe("buildTerminalStartScript", () => {
  it("generates shell syntax that parses under sh", () => {
    const script = buildTerminalStartScript();
    const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept terminal start script");
    assert.match(script, /\n\s+printf '%s\\n'/);
    assert.doesNotMatch(script, /then;\s/);
    assert.match(script, /Full toolbox shell available/);
    assert.doesNotMatch(script, /cp -a \/verft-base/);
    assert.match(script, /normalize-provider-paths\.mjs "\$HOME"/);
    assert.match(script, /chown -R agent:agent "\$TASK_INTERACTIVE_WORKSPACE"/);
    assert.doesNotMatch(script, /chown -R agent:agent "\$HOME"/);
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
    assert.match(dockerfile, /COPY normalize-provider-paths\.mjs/);
    assert.doesNotMatch(dockerfile, /COPY verft-base-state\.mjs/);
    assert.match(dockerfile, /COPY hostexec-proxy\.mjs/);
    assert.match(dockerfile, /groupmod --new-name agent node/);
    assert.match(dockerfile, /usermod --login agent --home \/home\/agent --move-home node/);
    assert.match(dockerfile, /test "\$\(id -u agent\)" = 1000/);
    assert.match(dockerfile, /test "\$\(id -g agent\)" = 1000/);
    assert.doesNotMatch(dockerfile, /adduser --system/);
  });

  it("stores task homes in a Docker-managed volume with safe legacy migration", () => {
    const compose = readFileSync(composePath, "utf8");

    assert.match(compose, /task_homes:\/task-homes/);
    assert.match(compose, /name: verft_task_homes/);
    assert.match(compose, /service_completed_successfully/);
    assert.match(compose, /find \/task-homes -mindepth 1 -print -quit/);
    assert.match(compose, /\.\/task-homes:\/legacy-task-homes:ro/);
    assert.match(compose, /chown -R 1000:1000 \/task-homes/);
    assert.doesNotMatch(compose, /\.\/task-homes:\/task-homes/);
  });

  it("uses the mounted persistent home without recopying host provider state", () => {
    const codexRunner = readFileSync(codexRunnerPath, "utf8");
    const claudeRunner = readFileSync(claudeRunnerPath, "utf8");

    assert.doesNotMatch(codexRunner, /HOST_CODEX_STATE/);
    assert.doesNotMatch(codexRunner, /AGENT_IDENTITY, homeDir/);
    assert.doesNotMatch(claudeRunner, /HOST_CLAUDE_STATE|HOST_CLAUDE_CONFIG/);
    assert.doesNotMatch(claudeRunner, /runtimeIdentity, runtimeHome/);
  });

  it("skips repeated provider runtime startup work when artifacts already exist", () => {
    const spawnerSource = readFileSync(path.join(repoRoot, "apps/server/src/services/spawner.ts"), "utf8");
    const codexRunner = readFileSync(codexRunnerPath, "utf8");
    const claudeRunner = readFileSync(claudeRunnerPath, "utf8");

    assert.match(spawnerSource, /"docker", \["image", "inspect", definition\.image\]/);
    assert.match(spawnerSource, /runtime prerequisites/);
    assert.match(spawnerSource, /Promise\.all\(\[\s*repoProfilePromise,\s*runtimeMcpPromise,\s*taskHomePromise/s);
    assert.match(codexRunner, /find "\$1" ! -user 1000 -print -quit/);
    assert.match(claudeRunner, /find "\$1" ! -user 1000 -print -quit/);
    assert.doesNotMatch(codexRunner, /if \(!isAsk\) \{\s*await runCommand\("chown", \["-R", AGENT_IDENTITY, manifest\.workspacePath\]\)/);
    assert.doesNotMatch(claudeRunner, /if \(!isAsk\) \{\s*await runCommand\("chown", \["-R", runtimeIdentity, manifest\.workspacePath\]\)/);
  });

  it("normalizes copied absolute Claude and Codex paths in text files", () => {
    const runtimeHome = mkdtempSync(path.join(tmpdir(), "verft-claude-home-"));
    const pluginsDir = path.join(runtimeHome, ".claude", "plugins");
    const configPath = path.join(pluginsDir, "known_marketplaces.json");
    const codexDir = path.join(runtimeHome, ".codex");
    const codexConfigPath = path.join(codexDir, "config.toml");
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        installLocation: "/home/coretracker/.claude/plugins/marketplaces/claude-plugins-official",
        installPath: "/home/coretracker/.claude/plugins/cache/claude-plugins-official/figma/2.2.81"
      })
    );
    writeFileSync(codexConfigPath, 'instructions = "/home/coretracker/.codex/instructions.md"\n');

    try {
      const result = spawnSync("node", [providerPathNormalizerPath, runtimeHome], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const normalized = JSON.parse(readFileSync(configPath, "utf8"));
      assert.equal(
        normalized.installLocation,
        path.join(runtimeHome, ".claude", "plugins", "marketplaces", "claude-plugins-official")
      );
      assert.equal(
        normalized.installPath,
        path.join(runtimeHome, ".claude", "plugins", "cache", "claude-plugins-official", "figma", "2.2.81")
      );
      assert.equal(
        readFileSync(codexConfigPath, "utf8"),
        `instructions = "${path.join(runtimeHome, ".codex", "instructions.md")}"\n`
      );
    } finally {
      rmSync(runtimeHome, { recursive: true, force: true });
    }
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
