const SEEN_TASK_IDS_STORAGE_KEY = "agentswarm.seen-task-ids";
const SEEN_TASK_IDS_UPDATED_EVENT = "agentswarm:seen-task-ids-updated";

const readSeenTaskIds = (): string[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SEEN_TASK_IDS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

export const getSeenTaskIds = (): Set<string> => new Set(readSeenTaskIds());

export const markTaskSeen = (taskId: string): void => {
  if (typeof window === "undefined" || !taskId) {
    return;
  }

  const seenTaskIds = getSeenTaskIds();
  if (seenTaskIds.has(taskId)) {
    return;
  }

  seenTaskIds.add(taskId);
  try {
    window.localStorage.setItem(SEEN_TASK_IDS_STORAGE_KEY, JSON.stringify([...seenTaskIds]));
    window.dispatchEvent(new CustomEvent(SEEN_TASK_IDS_UPDATED_EVENT));
  } catch {
    // Ignore storage write failures and keep the rest of the UI responsive.
  }
};

export const subscribeToSeenTasks = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleSeenTaskIdsUpdated: EventListener = () => {
    onChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SEEN_TASK_IDS_STORAGE_KEY) {
      return;
    }

    onChange();
  };

  window.addEventListener(SEEN_TASK_IDS_UPDATED_EVENT, handleSeenTaskIdsUpdated);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SEEN_TASK_IDS_UPDATED_EVENT, handleSeenTaskIdsUpdated);
    window.removeEventListener("storage", handleStorage);
  };
};
