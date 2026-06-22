import path from "node:path";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import type { TaskLinkedWorkspace } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { buildDockerWorkspaceMountArgs } from "./docker-workspace-mounts.js";
import { resolveGitPaths } from "./git-paths.js";

export const LINKED_WORKSPACE_DIRNAME = ".linked-workspace";

export interface LinkedWorkspaceMountPlan {
  mountArgs: string[];
  mounted: TaskLinkedWorkspace[];
  skipped: TaskLinkedWorkspace[];
}

export const isSafeLinkedWorkspaceAlias = (alias: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias) && alias !== "." && alias !== "..";

async function ensureLinkedWorkspaceGitExclude(rootWorkspacePath: string): Promise<void> {
  const gitPaths = await resolveGitPaths(path.join(rootWorkspacePath, ".git")).catch(() => null);
  if (!gitPaths) {
    return;
  }

  const excludePath = path.join(gitPaths.commonDir, "info", "exclude");
  await mkdir(path.dirname(excludePath), { recursive: true });
  const existing = await readFile(excludePath, "utf8").catch(() => "");
  const entry = `${LINKED_WORKSPACE_DIRNAME}/`;
  if (existing.split(/\r?\n/).includes(entry)) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${prefix}${entry}\n`, "utf8");
}

export async function buildLinkedWorkspaceMountPlan(options: {
  rootWorkspacePath: string;
  containerWorkspacePath: string;
  linkedWorkspaces?: TaskLinkedWorkspace[];
  taskWorkspaceRoot?: string;
  taskWorkspaceDockerSource?: string;
}): Promise<LinkedWorkspaceMountPlan> {
  const linkedWorkspaces = options.linkedWorkspaces ?? [];
  if (linkedWorkspaces.length === 0) {
    return { mountArgs: [], mounted: [], skipped: [] };
  }

  const mountRoot = path.join(options.rootWorkspacePath, LINKED_WORKSPACE_DIRNAME);
  await mkdir(mountRoot, { recursive: true });
  await ensureLinkedWorkspaceGitExclude(options.rootWorkspacePath);

  const mountArgs: string[] = [];
  const mounted: TaskLinkedWorkspace[] = [];
  const skipped: TaskLinkedWorkspace[] = [];
  const seenAliases = new Set<string>();

  for (const link of linkedWorkspaces) {
    if (!isSafeLinkedWorkspaceAlias(link.alias) || seenAliases.has(link.alias)) {
      skipped.push(link);
      continue;
    }
    seenAliases.add(link.alias);

    const taskWorkspaceRoot = options.taskWorkspaceRoot ?? env.TASK_WORKSPACE_ROOT;
    const taskWorkspaceDockerSource = options.taskWorkspaceDockerSource ?? env.TASK_WORKSPACE_DOCKER_SOURCE;
    const sourceOnServer = path.join(taskWorkspaceRoot, link.taskId);
    try {
      await access(sourceOnServer, constants.R_OK | constants.X_OK);
    } catch {
      skipped.push(link);
      continue;
    }

    await mkdir(path.join(mountRoot, link.alias), { recursive: true });
    const targetInContainer = path.posix.join(options.containerWorkspacePath, LINKED_WORKSPACE_DIRNAME, link.alias);
    mountArgs.push(
      ...buildDockerWorkspaceMountArgs({
        sourceRoot: taskWorkspaceDockerSource,
        sourceRelativePath: link.taskId,
        targetPath: targetInContainer,
        mode: "ro"
      })
    );
    mounted.push(link);
  }

  return { mountArgs, mounted, skipped };
}
