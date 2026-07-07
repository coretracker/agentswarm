import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { ensureTaskProviderStatePaths, resolveTaskProviderStatePaths, resolveTaskStateRootPaths } from "./task-provider-state.js";

describe("task-provider-state", () => {
  it("builds task-scoped provider state paths", () => {
    const paths = resolveTaskProviderStatePaths("task 123", "codex");
    assert.equal(paths.serverPath, "/task-workspaces/.task-state/task-123/agent-home/.codex");
    assert.equal(paths.hostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/agent-home/.codex"));
    assert.equal(paths.homeServerPath, "/task-workspaces/.task-state/task-123/agent-home");
    assert.equal(paths.homeHostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/agent-home"));
    assert.equal(paths.legacyServerPath, "/task-workspaces/.interactive-homes/codex/task-123");
    assert.equal(paths.configServerPath, null);
    assert.equal(paths.configHostPath, null);
  });

  it("builds Claude task-scoped home paths", () => {
    const paths = resolveTaskProviderStatePaths("task 123", "claude");
    assert.equal(paths.serverPath, "/task-workspaces/.task-state/task-123/agent-home/.claude");
    assert.equal(paths.hostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/agent-home/.claude"));
    assert.equal(paths.homeServerPath, "/task-workspaces/.task-state/task-123/agent-home");
    assert.equal(paths.homeHostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/agent-home"));
    assert.equal(paths.legacyServerPath, "/task-workspaces/.interactive-homes/claude/task-123");
    assert.equal(paths.configServerPath, "/task-workspaces/.task-state/task-123/agent-home/.claude.json");
    assert.equal(paths.configHostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-123/agent-home/.claude.json"));
  });

  it("builds the task state root path", () => {
    const paths = resolveTaskStateRootPaths("task/abc");
    assert.equal(paths.serverPath, "/task-workspaces/.task-state/task-abc");
    assert.equal(paths.hostPath, path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, ".task-state/task-abc"));
  });

  it("migrates legacy Claude task state into the task-scoped home", async () => {
    const originalTaskWorkspaceRoot = env.TASK_WORKSPACE_ROOT;
    const originalTaskWorkspaceDockerSource = env.TASK_WORKSPACE_DOCKER_SOURCE;
    const root = path.join("/tmp", `verft-provider-state-${Date.now()}`);
    env.TASK_WORKSPACE_ROOT = root;
    env.TASK_WORKSPACE_DOCKER_SOURCE = root;

    try {
      const legacyClaudeDir = path.join(root, ".task-state/task-legacy/.claude");
      const legacyConfigPath = path.join(root, ".task-state/task-legacy/.claude.json");
      await mkdir(legacyClaudeDir, { recursive: true });
      await writeFile(path.join(legacyClaudeDir, "verft-session-id.txt"), "session\n", "utf8");
      await writeFile(legacyConfigPath, "{\"legacy\":true}\n", "utf8");

      const paths = await ensureTaskProviderStatePaths("task legacy", "claude");

      assert.equal(await readFile(path.join(paths.serverPath, "verft-session-id.txt"), "utf8"), "session\n");
      assert.equal(await readFile(paths.configServerPath!, "utf8"), "{\"legacy\":true}\n");
    } finally {
      env.TASK_WORKSPACE_ROOT = originalTaskWorkspaceRoot;
      env.TASK_WORKSPACE_DOCKER_SOURCE = originalTaskWorkspaceDockerSource;
      await rm(root, { recursive: true, force: true });
    }
  });
});
