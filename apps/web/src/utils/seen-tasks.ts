import { isActiveTaskStatus, isQueuedTaskStatus, type Task } from "@agentswarm/shared-types";

const SEEN_TASKS_STORAGE_KEY = "agentswarm.seen-task-ids";
const SEEN_TASKS_UPDATED_EVENT = "agentswarm:seen-task-ids-updated";
const LEGACY_SEEN_TASK_VERSION = "__legacy__";

export type SeenTaskVersions = Record<string, string>;

const persistSeenTaskVersions = (seenTaskVersions: SeenTaskVersions): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SEEN_TASKS_STORAGE_KEY, JSON.stringify(seenTaskVersions));
    window.dispatchEvent(new CustomEvent(SEEN_TASKS_UPDATED_EVENT));
  } catch {
    // Ignore storage write failures and keep the rest of the UI responsive.
  }
};

const readSeenTaskVersions = (): SeenTaskVersions => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SEEN_TASKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.reduce<SeenTaskVersions>((seenTasks, item) => {
        if (typeof item === "string" && item) {
          seenTasks[item] = LEGACY_SEEN_TASK_VERSION;
        }

        return seenTasks;
      }, {});
    }

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed).reduce<SeenTaskVersions>((seenTasks, [taskId, version]) => {
      if (taskId && typeof version === "string" && version) {
        seenTasks[taskId] = version;
      }

      return seenTasks;
    }, {});
  } catch {
    return {};
  }
};

export const getSeenTaskVersions = (): SeenTaskVersions => readSeenTaskVersions();

export const isTaskSeen = (task: Pick<Task, "id" | "status" | "updatedAt">, seenTaskVersions: SeenTaskVersions): boolean => {
  const version = seenTaskVersions[task.id];
  if (!version) {
    return false;
  }

  if (version === LEGACY_SEEN_TASK_VERSION) {
    return true;
  }

  if (isQueuedTaskStatus(task.status) || isActiveTaskStatus(task.status)) {
    return true;
  }

  return version === task.updatedAt;
};

export const migrateSeenTaskVersions = (
  seenTaskVersions: SeenTaskVersions,
  tasks: Array<Pick<Task, "id" | "updatedAt">>
): SeenTaskVersions | null => {
  let changed = false;
  const nextSeenTaskVersions = { ...seenTaskVersions };

  for (const task of tasks) {
    if (nextSeenTaskVersions[task.id] !== LEGACY_SEEN_TASK_VERSION) {
      continue;
    }

    nextSeenTaskVersions[task.id] = task.updatedAt;
    changed = true;
  }

  if (!changed) {
    return null;
  }

  persistSeenTaskVersions(nextSeenTaskVersions);
  return nextSeenTaskVersions;
};

export const markTaskSeen = (task: Pick<Task, "id" | "updatedAt">): void => {
  if (typeof window === "undefined" || !task.id) {
    return;
  }

  const seenTaskVersions = getSeenTaskVersions();
  if (seenTaskVersions[task.id] === task.updatedAt) {
    return;
  }

  seenTaskVersions[task.id] = task.updatedAt;
  persistSeenTaskVersions(seenTaskVersions);
};

export const subscribeToSeenTasks = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleSeenTaskIdsUpdated: EventListener = () => {
    onChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SEEN_TASKS_STORAGE_KEY) {
      return;
    }

    onChange();
  };

  window.addEventListener(SEEN_TASKS_UPDATED_EVENT, handleSeenTaskIdsUpdated);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SEEN_TASKS_UPDATED_EVENT, handleSeenTaskIdsUpdated);
    window.removeEventListener("storage", handleStorage);
  };
};
