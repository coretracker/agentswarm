import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { env } from "../config/env.js";
import { clearTaskProviderSession, ensureTaskHome, rebuildTaskHome } from "./task-home.js";

describe("task-home", () => {
  let root: string;
  let originalHomeRoot: string;
  let originalHomeDockerSource: string;
  let originalWorkspaceRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "verft-task-home-"));
    originalHomeRoot = env.TASK_HOME_ROOT;
    originalHomeDockerSource = env.TASK_HOME_DOCKER_SOURCE;
    originalWorkspaceRoot = env.TASK_WORKSPACE_ROOT;
    env.TASK_HOME_ROOT = path.join(root, "homes");
    env.TASK_HOME_DOCKER_SOURCE = env.TASK_HOME_ROOT;
    env.TASK_WORKSPACE_ROOT = path.join(root, "workspaces");
  });

  afterEach(async () => {
    env.TASK_HOME_ROOT = originalHomeRoot;
    env.TASK_HOME_DOCKER_SOURCE = originalHomeDockerSource;
    env.TASK_WORKSPACE_ROOT = originalWorkspaceRoot;
    await rm(root, { recursive: true, force: true });
  });

  it("seeds once and reuses the existing home", async () => {
    let seeds = 0;
    const seed = async ({ serverPath }: { serverPath: string }) => {
      seeds += 1;
      await writeFile(path.join(serverPath, "marker"), `seed-${seeds}`);
    };
    await ensureTaskHome("task-1", seed);
    await ensureTaskHome("task-1", seed);
    assert.equal(seeds, 1);
    assert.equal(await readFile(path.join(env.TASK_HOME_ROOT, "task-1", "marker"), "utf8"), "seed-1");
  });

  it("migrates legacy agent-home state instead of seeding", async () => {
    const legacyHome = path.join(env.TASK_WORKSPACE_ROOT, ".task-state", "task-1", "agent-home");
    await mkdir(legacyHome, { recursive: true });
    await writeFile(path.join(legacyHome, "history"), "preserved");
    let seeded = false;
    await ensureTaskHome("task-1", async () => {
      seeded = true;
    });
    assert.equal(seeded, false);
    assert.equal(await readFile(path.join(env.TASK_HOME_ROOT, "task-1", "history"), "utf8"), "preserved");
  });

  it("keeps the existing home when replacement seeding fails", async () => {
    await ensureTaskHome("task-1", async ({ serverPath }) => {
      await writeFile(path.join(serverPath, "history"), "preserved");
    });
    await assert.rejects(
      rebuildTaskHome("task-1", async () => {
        throw new Error("seed failed");
      }),
      /seed failed/
    );
    assert.equal(await readFile(path.join(env.TASK_HOME_ROOT, "task-1", "history"), "utf8"), "preserved");
  });

  it("clears only the selected provider session marker", async () => {
    const home = path.join(env.TASK_HOME_ROOT, "task-1");
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(path.join(home, ".codex", "verft-session-id.txt"), "codex");
    await writeFile(path.join(home, ".claude", "verft-session-id.txt"), "claude");
    await writeFile(path.join(home, ".codex", "config.toml"), "preserved");

    await clearTaskProviderSession("task-1", "codex");

    await assert.rejects(readFile(path.join(home, ".codex", "verft-session-id.txt")));
    assert.equal(await readFile(path.join(home, ".claude", "verft-session-id.txt"), "utf8"), "claude");
    assert.equal(await readFile(path.join(home, ".codex", "config.toml"), "utf8"), "preserved");
  });
});
