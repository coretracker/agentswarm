import { cp, lchown, lstat, mkdir, mkdtemp, readdir, rename, rm, chmod } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { resolveTaskHomePaths, resolveTaskProviderStatePaths, validateTaskId } from "./task-provider-state.js";
import type { AgentProvider } from "@verft/shared-types";

const AGENT_UID = 1000;
const AGENT_GID = 1000;

export type SeedTaskHome = (paths: { serverPath: string; hostPath: string }) => Promise<void>;

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  return Boolean((await lstat(targetPath).catch(() => null))?.isDirectory());
}

async function chownForAgent(targetPath: string): Promise<void> {
  await lchown(targetPath, AGENT_UID, AGENT_GID).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EPERM") {
      throw error;
    }
  });
}

async function chownTree(targetPath: string): Promise<void> {
  const entries = await readdir(targetPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const childPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        await chownTree(childPath);
      } else {
        await chownForAgent(childPath);
      }
    })
  );
  await chownForAgent(targetPath);
}

function temporaryHostPath(serverPath: string): string {
  return path.join(env.TASK_HOME_DOCKER_SOURCE, path.basename(serverPath));
}

async function prepareReplacement(taskId: string, seed: SeedTaskHome, legacyPath?: string): Promise<string> {
  validateTaskId(taskId);
  await mkdir(env.TASK_HOME_ROOT, { recursive: true, mode: 0o700 });
  const temporaryServerPath = await mkdtemp(path.join(env.TASK_HOME_ROOT, `.${taskId}-`));
  try {
    if (legacyPath) {
      await cp(legacyPath, temporaryServerPath, { recursive: true, force: false });
    } else {
      await seed({ serverPath: temporaryServerPath, hostPath: temporaryHostPath(temporaryServerPath) });
    }
    await chmod(temporaryServerPath, 0o700);
    await chownTree(temporaryServerPath);
    return temporaryServerPath;
  } catch (error) {
    await rm(temporaryServerPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ensureTaskHome(taskId: string, seed: SeedTaskHome): Promise<ReturnType<typeof resolveTaskHomePaths>> {
  const paths = resolveTaskHomePaths(taskId);
  if (await pathIsDirectory(paths.serverPath)) {
    return paths;
  }

  const legacyPath = resolveTaskProviderStatePaths(taskId, "codex").homeServerPath;
  const hasLegacyHome = await pathIsDirectory(legacyPath);
  const replacement = await prepareReplacement(taskId, seed, hasLegacyHome ? legacyPath : undefined);
  try {
    await rename(replacement, paths.serverPath);
  } catch (error) {
    if (await pathIsDirectory(paths.serverPath)) {
      await rm(replacement, { recursive: true, force: true });
      return paths;
    }
    throw error;
  }
  if (hasLegacyHome) {
    await rm(legacyPath, { recursive: true, force: true });
  }
  return paths;
}

export async function rebuildTaskHome(taskId: string, seed: SeedTaskHome): Promise<void> {
  const paths = resolveTaskHomePaths(taskId);
  const replacement = await prepareReplacement(taskId, seed);
  const backup = path.join(env.TASK_HOME_ROOT, `.${taskId}-backup`);
  await rm(backup, { recursive: true, force: true });

  const hadExistingHome = await pathIsDirectory(paths.serverPath);
  try {
    if (hadExistingHome) {
      await rename(paths.serverPath, backup);
    }
    await rename(replacement, paths.serverPath);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(replacement, { recursive: true, force: true }).catch(() => undefined);
    if (hadExistingHome && !(await pathIsDirectory(paths.serverPath))) {
      await rename(backup, paths.serverPath).catch(() => undefined);
    }
    throw error;
  }
}

export async function deleteTaskHome(taskId: string): Promise<void> {
  await rm(resolveTaskHomePaths(taskId).serverPath, { recursive: true, force: true });
}

export async function clearTaskProviderSession(taskId: string, provider: AgentProvider): Promise<void> {
  const providerStatePath = path.join(
    resolveTaskHomePaths(taskId).serverPath,
    provider === "claude" ? ".claude" : ".codex"
  );
  await rm(path.join(providerStatePath, "verft-session-id.txt"), { force: true });
}
