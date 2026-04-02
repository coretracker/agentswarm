import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export interface GitPaths {
  gitDir: string;
  commonDir: string;
  usesLinkedWorktree: boolean;
}

async function resolveCommonDir(gitDir: string): Promise<string> {
  const raw = await readFile(path.join(gitDir, "commondir"), "utf8").catch(() => "");
  return raw.trim() ? path.resolve(gitDir, raw.trim()) : gitDir;
}

export async function resolveGitPaths(gitPath: string): Promise<GitPaths> {
  const stat = await lstat(gitPath);

  if (stat.isDirectory()) {
    const commonDir = await resolveCommonDir(gitPath);
    return {
      gitDir: gitPath,
      commonDir,
      usesLinkedWorktree: commonDir !== gitPath
    };
  }

  if (!stat.isFile()) {
    throw new Error(`Unsupported git path: ${gitPath}`);
  }

  const raw = await readFile(gitPath, "utf8");
  const match = raw.match(/^gitdir:\s*(.+)$/im);
  if (!match?.[1]) {
    throw new Error(`Unsupported .git file: ${gitPath}`);
  }

  const gitDir = path.resolve(path.dirname(gitPath), match[1].trim());
  const commonDir = await resolveCommonDir(gitDir);
  return {
    gitDir,
    commonDir,
    usesLinkedWorktree: true
  };
}
