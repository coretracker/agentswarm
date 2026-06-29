import type { SystemSettings } from "@agentswarm/shared-types";

export interface GitCommitIdentity {
  name: string;
  email: string;
}

export function resolveTaskGitCommitIdentity(
  settings: Pick<SystemSettings, "gitAuthorName" | "gitAuthorEmail">,
  fallback: GitCommitIdentity
): GitCommitIdentity {
  const name = settings.gitAuthorName?.trim() ?? "";
  const email = settings.gitAuthorEmail?.trim() ?? "";
  if (!name || !email) {
    return fallback;
  }

  return { name, email };
}
