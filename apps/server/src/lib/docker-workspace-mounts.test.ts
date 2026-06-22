import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDockerWorkspaceMountArgs } from "./docker-workspace-mounts.js";

describe("buildDockerWorkspaceMountArgs", () => {
  it("uses bind mounts for absolute host workspace roots", () => {
    assert.deepEqual(
      buildDockerWorkspaceMountArgs({
        sourceRoot: "/var/lib/agentswarm/task-workspaces",
        sourceRelativePath: "task-123",
        targetPath: "/task-workspaces/task-123",
        mode: "rw"
      }),
      ["-v", "/var/lib/agentswarm/task-workspaces/task-123:/task-workspaces/task-123:rw"]
    );
  });

  it("uses Docker volume subpaths for named workspace volume roots", () => {
    assert.deepEqual(
      buildDockerWorkspaceMountArgs({
        sourceRoot: "agentswarm_task_workspaces",
        sourceRelativePath: "task-123",
        targetPath: "/task-workspaces/task-123",
        mode: "rw"
      }),
      ["--mount", "type=volume,src=agentswarm_task_workspaces,dst=/task-workspaces/task-123,volume-subpath=task-123"]
    );
  });

  it("marks named volume subpath mounts readonly when requested", () => {
    assert.deepEqual(
      buildDockerWorkspaceMountArgs({
        sourceRoot: "agentswarm_task_workspaces",
        sourceRelativePath: ".task-state/task-123/.codex",
        targetPath: "/home/codex/.codex",
        mode: "ro"
      }),
      [
        "--mount",
        "type=volume,src=agentswarm_task_workspaces,dst=/home/codex/.codex,volume-subpath=.task-state/task-123/.codex,readonly"
      ]
    );
  });
});

