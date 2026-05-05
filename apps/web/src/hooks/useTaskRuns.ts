"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskRun } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskLogPayload {
  taskId: string;
  runId?: string | null;
  line: string;
}

interface TaskDeletedPayload {
  id: string;
}

const MAX_LOG_LINES = 400;
const HISTORY_PAGE_SIZE = 25;
const sortRuns = (items: TaskRun[]): TaskRun[] => [...items].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

const mergeRuns = (base: TaskRun[], incoming: TaskRun[]): TaskRun[] => {
  const merged = new Map<string, TaskRun>();
  for (const run of base) {
    merged.set(run.id, run);
  }
  for (const run of incoming) {
    const existing = merged.get(run.id);
    merged.set(run.id, existing ? { ...existing, ...run, logs: run.logs.length > 0 ? run.logs : existing.logs } : run);
  }
  return sortRuns([...merged.values()]);
};

export const useTaskRuns = (taskId: string) => {
  const socket = useSocket();
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const refetch = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<TaskRun[]> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const page = await api.listTaskRuns(taskId, { limit: HISTORY_PAGE_SIZE });
        setRuns(sortRuns(page.items));
        setHasMore(page.hasMore);
        setLoading(false);
        return page.items;
      } catch {
        setRuns([]);
        setHasMore(false);
        setLoading(false);
        return [];
      }
    },
    [taskId]
  );

  const loadMore = useCallback(async (): Promise<TaskRun[]> => {
    if (loadingMore || !hasMore) {
      return [];
    }

    const oldest = runs[0] ?? null;
    if (!oldest) {
      return [];
    }

    setLoadingMore(true);
    try {
      const page = await api.listTaskRuns(taskId, {
        limit: HISTORY_PAGE_SIZE,
        before: oldest.startedAt,
        beforeId: oldest.id
      });
      setRuns((current) => mergeRuns(current, page.items));
      setHasMore(page.hasMore);
      return page.items;
    } catch {
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, runs, taskId]);

  useEffect(() => {
    void refetch({ showLoading: true });
  }, [refetch]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onConnect = () => {
      void refetch();
    };

    const onTaskRunUpdate = (run: TaskRun) => {
      if (run.taskId !== taskId) {
        return;
      }

      setRuns((current) => mergeRuns(current, [run]));
    };

    const onTaskLog = (payload: TaskLogPayload) => {
      if (payload.taskId !== taskId || !payload.runId) {
        return;
      }

      setRuns((current) =>
        current.map((run) =>
          run.id === payload.runId
            ? {
                ...run,
                logs: [...run.logs, payload.line].slice(-MAX_LOG_LINES)
              }
            : run
        )
      );
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }

      setRuns([]);
      setHasMore(false);
    };

    socket.on("connect", onConnect);
    socket.on("task:run_updated", onTaskRunUpdate);
    socket.on("task:log", onTaskLog);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("connect", onConnect);
      socket.off("task:run_updated", onTaskRunUpdate);
      socket.off("task:log", onTaskLog);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [refetch, socket, taskId]);

  return { runs, loading, loadingMore, hasMore, refetch, loadMore };
};
