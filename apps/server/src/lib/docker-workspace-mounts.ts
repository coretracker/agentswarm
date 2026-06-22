import path from "node:path";

export type DockerMountMode = "ro" | "rw";

function normalizeVolumeSubpath(sourceRelativePath: string): string | null {
  const posixPath = sourceRelativePath.split(path.sep).join(path.posix.sep);
  const normalized = path.posix.normalize(posixPath);
  if (normalized === ".") {
    return null;
  }
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Invalid Docker volume subpath: ${sourceRelativePath}`);
  }
  return normalized;
}

export function isDockerNamedVolumeSource(sourceRoot: string): boolean {
  return !path.isAbsolute(sourceRoot);
}

export function buildDockerWorkspaceMountArgs(options: {
  sourceRoot: string;
  sourceRelativePath: string;
  targetPath: string;
  mode: DockerMountMode;
}): string[] {
  const sourceRelativePath = normalizeVolumeSubpath(options.sourceRelativePath);

  if (!isDockerNamedVolumeSource(options.sourceRoot)) {
    const sourcePath = sourceRelativePath ? path.join(options.sourceRoot, sourceRelativePath) : options.sourceRoot;
    return ["-v", `${sourcePath}:${options.targetPath}:${options.mode}`];
  }

  const mountOptions = [`type=volume`, `src=${options.sourceRoot}`, `dst=${options.targetPath}`];
  if (sourceRelativePath) {
    mountOptions.push(`volume-subpath=${sourceRelativePath}`);
  }
  if (options.mode === "ro") {
    mountOptions.push("readonly");
  }
  return ["--mount", mountOptions.join(",")];
}

