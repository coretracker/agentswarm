import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function normalizeSafeWorkspaceRelativePath(userRelativePath: string): string | null {
  const trimmed = userRelativePath.trim();
  if (!trimmed) {
    return null;
  }

  if (path.isAbsolute(trimmed) || trimmed.includes("\0") || trimmed.includes(":")) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0 || parts.some((p) => p === "..")) {
    return null;
  }

  return parts.join("/");
}

/**
 * Resolves a repo-relative file path inside a task workspace root.
 * Rejects absolute paths, `..` segments, and paths that escape the workspace (including via symlinks).
 */
export function resolveSafeWorkspaceFilePath(workspaceRoot: string, userRelativePath: string): string | null {
  const normalizedRelativePath = normalizeSafeWorkspaceRelativePath(userRelativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  let workspaceReal: string;
  try {
    workspaceReal = realpathSync.native(path.resolve(workspaceRoot));
  } catch {
    return null;
  }

  const candidate = path.resolve(workspaceReal, ...normalizedRelativePath.split("/"));

  let probe = candidate;
  for (;;) {
    if (existsSync(probe)) {
      try {
        const rp = realpathSync.native(probe);
        const rel = path.relative(workspaceReal, rp);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          return null;
        }
        return candidate;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(probe);
    if (parent === probe) {
      break;
    }
    probe = parent;
  }

  const rel = path.relative(workspaceReal, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return candidate;
}

export async function readSafeWorkspaceFileBuffer(workspaceRoot: string, userRelativePath: string): Promise<Buffer | null> {
  const full = resolveSafeWorkspaceFilePath(workspaceRoot, userRelativePath);
  if (!full) {
    return null;
  }

  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function readSafeWorkspaceFile(workspaceRoot: string, userRelativePath: string): Promise<string | null> {
  const buffer = await readSafeWorkspaceFileBuffer(workspaceRoot, userRelativePath);
  return buffer ? buffer.toString("utf8") : null;
}

export async function writeSafeWorkspaceFile(
  workspaceRoot: string,
  userRelativePath: string,
  content: string
): Promise<{ path: string } | null> {
  const full = resolveSafeWorkspaceFilePath(workspaceRoot, userRelativePath);
  if (!full) {
    return null;
  }

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
  return { path: full };
}
