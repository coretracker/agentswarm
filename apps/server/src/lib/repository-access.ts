import type { AuthSessionUser, Repository } from "@agentswarm/shared-types";
import { isAdminUser } from "./task-ownership.js";

type RepositoryAccessUser = Pick<AuthSessionUser, "id" | "roles"> | null | undefined;
type RepositoryAccessRecord = Pick<Repository, "id" | "userIds">;

export const canUserAccessRepository = (user: RepositoryAccessUser, repository: RepositoryAccessRecord): boolean => {
  if (!user) {
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  return repository.userIds.includes(user.id);
};
