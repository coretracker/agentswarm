import type { Task, User } from "@agentswarm/shared-types";

export interface GitCommitIdentity {
  name: string;
  email: string;
}

type UserLookup = {
  getUser(userId: string): Promise<Pick<User, "name" | "email"> | null>;
};

export async function resolveTaskGitCommitIdentity(
  task: Pick<Task, "ownerUserId">,
  userLookup: UserLookup,
  fallback: GitCommitIdentity
): Promise<GitCommitIdentity> {
  if (!task.ownerUserId) {
    return fallback;
  }

  const user = await userLookup.getUser(task.ownerUserId);
  if (!user) {
    return fallback;
  }

  const name = user.name.trim();
  const email = user.email.trim();
  if (!name || !email) {
    return fallback;
  }

  return { name, email };
}
