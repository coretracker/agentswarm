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
const sortRuns = (items: TaskRun[]): TaskRun[] => [...items].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

export const useTaskRuns = (taskId: string) => {
  const socket = useSocket();
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<TaskRun[]> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const items = await api.listTaskRuns(taskId);
        setRuns(sortRuns(items));
        setLoading(false);
        return items;
      } catch {
        setRuns([]);
        setLoading(false);
        return [];
      }
    },
    [taskId]
  );

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

      setRuns((current) => {
        const existingIndex = current.findIndex((item) => item.id === run.id);
        if (existingIndex === -1) {
          return sortRuns([...current, run]);
        }

        const next = [...current];
        next[existingIndex] = {
          ...next[existingIndex],
          ...run,
          logs: run.logs.length > 0 ? run.logs : next[existingIndex].logs
        };
        return sortRuns(next);
      });
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

  return { runs, loading, refetch };
};
