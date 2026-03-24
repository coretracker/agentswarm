import path from "node:path";

const gitLockPatterns = [
  /unable to create '([^']+\.lock)'/i,
  /could not lock(?: [^']+)? '([^']+\.lock)'/i
];

export const extractGitLockPathFromErrorMessage = (message: string): string | null => {
  for (const pattern of gitLockPatterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return path.normalize(match[1]);
    }
  }

  return null;
};

const normalizeAbsoluteArg = (value: string | undefined): string | null =>
  typeof value === "string" && path.isAbsolute(value) ? path.normalize(value) : null;

export const resolveGitTargetLockKey = (args: string[]): string | null => {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-C" || args[index] === "--git-dir") {
      const resolved = normalizeAbsoluteArg(args[index + 1]);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (args[0] === "clone") {
    return normalizeAbsoluteArg(args[args.length - 1]);
  }

  return null;
};

export const isPathInside = (root: string, candidate: string): boolean => {
  const normalizedRoot = path.normalize(root);
  const normalizedCandidate = path.normalize(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
