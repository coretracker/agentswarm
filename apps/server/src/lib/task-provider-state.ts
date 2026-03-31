import { access, chmod, chown, constants, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { AgentProvider } from "@agentswarm/shared-types";
import { env } from "../config/env.js";

const TASK_PROVIDER_STATE_ROOT = ".task-state";
const LEGACY_INTERACTIVE_STATE_ROOT = ".interactive-homes";

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

export function resolveTaskProviderStatePaths(taskId: string, provider: AgentProvider): {
  serverPath: string;
  hostPath: string;
  legacyServerPath: string;
  legacyHostPath: string;
} {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const relativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment, providerStateDirName(provider));
  const legacyRelativePath = path.join(LEGACY_INTERACTIVE_STATE_ROOT, provider, taskSegment);

  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_HOST_ROOT, relativePath),
    legacyServerPath: path.join(env.TASK_WORKSPACE_ROOT, legacyRelativePath),
    legacyHostPath: path.join(env.TASK_WORKSPACE_HOST_ROOT, legacyRelativePath)
  };
}

export function resolveTaskStateRootPaths(taskId: string): { serverPath: string; hostPath: string } {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const relativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment);
  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_HOST_ROOT, relativePath)
  };
}

export async function ensureTaskProviderStatePaths(
  taskId: string,
  provider: AgentProvider,
  ownership?: { uid: number; gid: number }
): Promise<ReturnType<typeof resolveTaskProviderStatePaths>> {
  const paths = resolveTaskProviderStatePaths(taskId, provider);

  await mkdir(path.dirname(paths.serverPath), { recursive: true });

  if (!(await pathExists(paths.serverPath)) && (await pathExists(paths.legacyServerPath))) {
    await rename(paths.legacyServerPath, paths.serverPath).catch(() => undefined);
  }

  await mkdir(paths.serverPath, { recursive: true });

  if (ownership) {
    try {
      await chown(paths.serverPath, ownership.uid, ownership.gid);
      await chmod(paths.serverPath, 0o700);
    } catch {
      await chmod(paths.serverPath, 0o777).catch(() => undefined);
    }
  }

  return paths;
}
