import type { AuthSessionUser, Task } from "@agentswarm/shared-types";
import { SYSTEM_ADMIN_ROLE_ID } from "../services/role-store.js";

type AdminCheckUser = Pick<AuthSessionUser, "roles"> | null | undefined;
type TaskAccessUser = Pick<AuthSessionUser, "id" | "roles"> | null | undefined;
type RepositoryAccessUser = Pick<AuthSessionUser, "roles" | "repositoryIds"> | null | undefined;
type TaskOwnerRecord = Pick<Task, "ownerUserId">;

export const isAdminUser = (user: AdminCheckUser): boolean =>
  Boolean(user?.roles.some((role) => role.id === SYSTEM_ADMIN_ROLE_ID));

export const canUserAccessRepository = (user: RepositoryAccessUser, repositoryId: string): boolean => {
  if (!user) {
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  return (user.repositoryIds ?? []).includes(repositoryId);
};

export const canUserAccessTask = (user: TaskAccessUser, task: TaskOwnerRecord): boolean => {
  if (!user) {
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  return Boolean(task.ownerUserId && task.ownerUserId === user.id);
};
