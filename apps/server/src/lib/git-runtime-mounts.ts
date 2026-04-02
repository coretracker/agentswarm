import path from "node:path";
import { env } from "../config/env.js";
import { isPathInside } from "./git-locks.js";
import type { GitPaths } from "./git-paths.js";
import { resolveGitPaths } from "./git-paths.js";

export function resolveGitRuntimeMountsForPaths(
  gitPaths: GitPaths,
  options: {
    repoCacheRoot?: string;
    repoCacheVolume?: string;
  } = {}
): string[] {
  const repoCacheRoot = options.repoCacheRoot?.trim() || env.REPO_CACHE_ROOT;
  const repoCacheVolume = options.repoCacheVolume?.trim() || env.REPO_CACHE_VOLUME;
  if (!gitPaths.usesLinkedWorktree || !repoCacheRoot || !repoCacheVolume) {
    return [];
  }

  const needsRepoCacheMount =
    isPathInside(repoCacheRoot, gitPaths.gitDir) || isPathInside(repoCacheRoot, gitPaths.commonDir);
  if (!needsRepoCacheMount) {
    return [];
  }

  return ["-v", `${repoCacheVolume}:${repoCacheRoot}:rw`];
}

export async function resolveWorkspaceGitRuntimeMounts(workspacePath: string): Promise<string[]> {
  const gitPaths = await resolveGitPaths(path.join(workspacePath, ".git")).catch(() => null);
  return gitPaths ? resolveGitRuntimeMountsForPaths(gitPaths) : [];
}
