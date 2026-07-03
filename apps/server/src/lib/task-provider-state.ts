import { access, chmod, chown, constants, copyFile, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentProvider } from "@verft/shared-types";
import { env } from "../config/env.js";

const TASK_PROVIDER_STATE_ROOT = ".task-state";
const LEGACY_INTERACTIVE_STATE_ROOT = ".interactive-homes";
const CLAUDE_HOME_DIRNAME = "claude-home";

function sanitizeTaskStateSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.length > 0 ? normalized : "unknown-task";
}

function providerStateDirName(provider: AgentProvider): string {
  return provider === "claude" ? ".claude" : ".codex";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findLatestClaudeConfigBackup(claudeStateDir: string): Promise<string | null> {
  const backupDir = path.join(claudeStateDir, "backups");
  if (!(await pathExists(backupDir))) {
    return null;
  }

  const entries = await readdir(backupDir).catch(() => []);
  const backups = entries
    .filter((entry) => entry.startsWith(".claude.json.backup."))
    .sort((left, right) => {
      const leftStamp = Number.parseInt(left.slice(".claude.json.backup.".length), 10);
      const rightStamp = Number.parseInt(right.slice(".claude.json.backup.".length), 10);
      return rightStamp - leftStamp;
    });

  return backups[0] ? path.join(backupDir, backups[0]) : null;
}

export function resolveTaskProviderStatePaths(taskId: string, provider: AgentProvider): {
  serverPath: string;
  hostPath: string;
  homeServerPath: string | null;
  homeHostPath: string | null;
  legacyServerPath: string;
  legacyHostPath: string;
  configServerPath: string | null;
  configHostPath: string | null;
} {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const stateRootRelativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment);
  const claudeHomeRelativePath = path.join(stateRootRelativePath, CLAUDE_HOME_DIRNAME);
  const relativePath =
    provider === "claude"
      ? path.join(claudeHomeRelativePath, providerStateDirName(provider))
      : path.join(stateRootRelativePath, providerStateDirName(provider));
  const legacyRelativePath = path.join(LEGACY_INTERACTIVE_STATE_ROOT, provider, taskSegment);
  const hasSidecarConfig = provider === "claude";

  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, relativePath),
    homeServerPath: provider === "claude" ? path.join(env.TASK_WORKSPACE_ROOT, claudeHomeRelativePath) : null,
    homeHostPath: provider === "claude" ? path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, claudeHomeRelativePath) : null,
    legacyServerPath: path.join(env.TASK_WORKSPACE_ROOT, legacyRelativePath),
    legacyHostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, legacyRelativePath),
    configServerPath: hasSidecarConfig ? path.join(env.TASK_WORKSPACE_ROOT, claudeHomeRelativePath, ".claude.json") : null,
    configHostPath: hasSidecarConfig ? path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, claudeHomeRelativePath, ".claude.json") : null
  };
}

export function resolveTaskStateRootPaths(taskId: string): { serverPath: string; hostPath: string } {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const relativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment);
  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, relativePath)
  };
}

export async function ensureTaskProviderStatePaths(
  taskId: string,
  provider: AgentProvider,
  ownership?: { uid: number; gid: number }
): Promise<ReturnType<typeof resolveTaskProviderStatePaths>> {
  const paths = resolveTaskProviderStatePaths(taskId, provider);
  const taskStateRootPaths = resolveTaskStateRootPaths(taskId);
  const legacyClaudeStateServerPath =
    provider === "claude" ? path.join(taskStateRootPaths.serverPath, providerStateDirName(provider)) : null;
  const legacyClaudeConfigServerPath = provider === "claude" ? path.join(taskStateRootPaths.serverPath, ".claude.json") : null;

  if (paths.homeServerPath) {
    await mkdir(paths.homeServerPath, { recursive: true });
  } else {
    await mkdir(path.dirname(paths.serverPath), { recursive: true });
  }

  if (!(await pathExists(paths.serverPath)) && (await pathExists(paths.legacyServerPath))) {
    await rename(paths.legacyServerPath, paths.serverPath).catch(() => undefined);
  }
  if (
    provider === "claude" &&
    legacyClaudeStateServerPath &&
    legacyClaudeStateServerPath !== paths.serverPath &&
    !(await pathExists(paths.serverPath)) &&
    (await pathExists(legacyClaudeStateServerPath))
  ) {
    await rename(legacyClaudeStateServerPath, paths.serverPath).catch(() => undefined);
  }
  if (
    provider === "claude" &&
    legacyClaudeConfigServerPath &&
    paths.configServerPath &&
    legacyClaudeConfigServerPath !== paths.configServerPath &&
    !(await pathExists(paths.configServerPath)) &&
    (await pathExists(legacyClaudeConfigServerPath))
  ) {
    await rename(legacyClaudeConfigServerPath, paths.configServerPath).catch(() => undefined);
  }

  await mkdir(paths.serverPath, { recursive: true });

  if (provider === "claude" && paths.configServerPath) {
    if (!(await pathExists(paths.configServerPath))) {
      const backupPath = await findLatestClaudeConfigBackup(paths.serverPath);
      if (backupPath) {
        await copyFile(backupPath, paths.configServerPath).catch(() => undefined);
      }
    }

    if (!(await pathExists(paths.configServerPath))) {
      await writeFile(paths.configServerPath, "{}\n", "utf8");
    }
  }

  if (ownership) {
    try {
      if (paths.homeServerPath) {
        await chown(paths.homeServerPath, ownership.uid, ownership.gid);
        await chmod(paths.homeServerPath, 0o700);
      }
      await chown(paths.serverPath, ownership.uid, ownership.gid);
      await chmod(paths.serverPath, 0o700);
      if (paths.configServerPath) {
        await chown(paths.configServerPath, ownership.uid, ownership.gid).catch(() => undefined);
        await chmod(paths.configServerPath, 0o600).catch(() => undefined);
      }
    } catch {
      if (paths.homeServerPath) {
        await chmod(paths.homeServerPath, 0o777).catch(() => undefined);
      }
      await chmod(paths.serverPath, 0o777).catch(() => undefined);
      if (paths.configServerPath) {
        await chmod(paths.configServerPath, 0o666).catch(() => undefined);
      }
    }
  }

  return paths;
}
