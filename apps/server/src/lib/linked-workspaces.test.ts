import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildLinkedWorkspaceMountPlan, isSafeLinkedWorkspaceAlias, LINKED_WORKSPACE_DIRNAME } from "./linked-workspaces.js";

describe("linked workspaces", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentswarm-linked-workspaces-"));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds read-only mount args for existing linked task workspaces", async () => {
    const taskWorkspaceRoot = path.join(root, "server");
    const taskWorkspaceHostRoot = path.join(root, "host");
    const rootWorkspacePath = path.join(taskWorkspaceRoot, "root-task");
    await mkdir(rootWorkspacePath, { recursive: true });
    await mkdir(path.join(rootWorkspacePath, ".git", "info"), { recursive: true });
    await mkdir(path.join(taskWorkspaceRoot, "linked-task"), { recursive: true });

    const plan = await buildLinkedWorkspaceMountPlan({
      rootWorkspacePath,
      containerWorkspacePath: "/workspace",
      taskWorkspaceRoot,
      taskWorkspaceHostRoot,
      linkedWorkspaces: [
        {
          taskId: "linked-task",
          alias: "linked-task",
          title: "Linked task",
          repoName: "repo",
          linkedAt: "2026-06-17T00:00:00.000Z",
          linkedByUserId: "user-1"
        }
      ]
    });

    assert.deepEqual(plan.mountArgs, ["-v", `${path.join(taskWorkspaceHostRoot, "linked-task")}:/workspace/.linked-workspace/linked-task:ro`]);
    assert.equal(plan.mounted.length, 1);
    assert.equal(plan.skipped.length, 0);
    assert.match(await readFile(path.join(rootWorkspacePath, ".git", "info", "exclude"), "utf8"), /^\.linked-workspace\/$/m);
  });

  it("builds read-only volume subpath mounts for named workspace volumes", async () => {
    const taskWorkspaceRoot = path.join(root, "server-named-volume");
    const rootWorkspacePath = path.join(taskWorkspaceRoot, "root-task");
    await mkdir(rootWorkspacePath, { recursive: true });
    await mkdir(path.join(taskWorkspaceRoot, "linked-task"), { recursive: true });

    const plan = await buildLinkedWorkspaceMountPlan({
      rootWorkspacePath,
      containerWorkspacePath: "/workspace",
      taskWorkspaceRoot,
      taskWorkspaceHostRoot: "agentswarm_task_workspaces",
      linkedWorkspaces: [
        {
          taskId: "linked-task",
          alias: "linked-task",
          title: "Linked task",
          repoName: "repo",
          linkedAt: "2026-06-17T00:00:00.000Z",
          linkedByUserId: "user-1"
        }
      ]
    });

    assert.deepEqual(plan.mountArgs, [
      "--mount",
      "type=volume,src=agentswarm_task_workspaces,dst=/workspace/.linked-workspace/linked-task,volume-subpath=linked-task,readonly"
    ]);
  });

  it("skips missing linked task workspaces and unsafe aliases", async () => {
    const taskWorkspaceRoot = path.join(root, "server-skip");
    const rootWorkspacePath = path.join(taskWorkspaceRoot, "root-task");
    await mkdir(rootWorkspacePath, { recursive: true });

    const plan = await buildLinkedWorkspaceMountPlan({
      rootWorkspacePath,
      containerWorkspacePath: "/workspace",
      taskWorkspaceRoot,
      taskWorkspaceHostRoot: path.join(root, "host-skip"),
      linkedWorkspaces: [
        {
          taskId: "missing-task",
          alias: "missing-task",
          title: "Missing task",
          repoName: "repo",
          linkedAt: "2026-06-17T00:00:00.000Z",
          linkedByUserId: "user-1"
        },
        {
          taskId: "bad-task",
          alias: "../bad",
          title: "Bad task",
          repoName: "repo",
          linkedAt: "2026-06-17T00:00:00.000Z",
          linkedByUserId: "user-1"
        }
      ]
    });

    assert.deepEqual(plan.mountArgs, []);
    assert.equal(plan.mounted.length, 0);
    assert.equal(plan.skipped.length, 2);
  });

  it("uses the expected linked workspace folder name", () => {
    assert.equal(LINKED_WORKSPACE_DIRNAME, ".linked-workspace");
    assert.equal(isSafeLinkedWorkspaceAlias("task_123-abc"), true);
    assert.equal(isSafeLinkedWorkspaceAlias("../task"), false);
  });
});
