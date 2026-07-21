import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { env } from "../config/env.js";
import { resolveTaskProviderStatePaths, resolveTaskStateRootPaths } from "./task-provider-state.js";

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
});
