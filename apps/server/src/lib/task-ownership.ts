import type { AuthSessionUser, Task } from "@verft/shared-types";
import type { ListTasksOptions, TaskStore } from "../services/task-store.js";
import { SYSTEM_ADMIN_ROLE_ID } from "../services/role-store.js";

type AdminCheckUser = Pick<AuthSessionUser, "roles"> | null | undefined;
type TaskAccessUser = Pick<AuthSessionUser, "id" | "roles" | "repositoryIds" | "teamMemberUserIds"> | null | undefined;
type RepositoryAccessUser = Pick<AuthSessionUser, "roles" | "repositoryIds"> | null | undefined;
type TaskOwnerRecord = Pick<Task, "ownerUserId" | "repoId">;

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

  if (task.ownerUserId === user.id) {
    return true;
  }

  return Boolean(
    task.ownerUserId &&
      (user.teamMemberUserIds ?? []).includes(task.ownerUserId) &&
      canUserAccessRepository(user, task.repoId)
  );
};

const sortTasks = (tasks: Task[]): Task[] =>
  tasks.sort((left, right) => (left.pinned !== right.pinned ? (left.pinned ? -1 : 1) : right.createdAt.localeCompare(left.createdAt)));

export const listTasksAccessibleToUser = async (
  taskStore: TaskStore,
  user: AuthSessionUser,
  options: Omit<ListTasksOptions, "ownerUserId" | "ownerUserIds" | "repositoryIds"> = {}
): Promise<Task[]> => {
  if (isAdminUser(user)) {
    return taskStore.listTasks(options);
  }

  const ownTasks = await taskStore.listTasks({ ...options, ownerUserId: user.id });
  const teammateIds = (user.teamMemberUserIds ?? []).filter((id) => id !== user.id);
  if (teammateIds.length === 0 || user.repositoryIds.length === 0) {
    return ownTasks;
  }

  const teammateTasks = await taskStore.listTasks({
    ...options,
    ownerUserIds: teammateIds,
    repositoryIds: user.repositoryIds
  });
  const merged = sortTasks([...ownTasks, ...teammateTasks]);
  return options.limit == null ? merged : merged.slice(0, Math.max(0, options.limit));
};
