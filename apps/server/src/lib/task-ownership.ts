import type { AuthSessionUser, Task } from "@agentswarm/shared-types";
import { SYSTEM_ADMIN_ROLE_ID } from "../services/role-store.js";

type TaskAccessUser = Pick<AuthSessionUser, "id" | "roles"> | null | undefined;
type TaskOwnerRecord = Pick<Task, "ownerUserId">;

export const isAdminUser = (user: TaskAccessUser): boolean => Boolean(user?.roles.some((role) => role.id === SYSTEM_ADMIN_ROLE_ID));

export const canUserAccessTask = (user: TaskAccessUser, task: TaskOwnerRecord): boolean => {
  if (!user) {
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  return Boolean(task.ownerUserId && task.ownerUserId === user.id);
};
