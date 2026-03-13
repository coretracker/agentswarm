"use client";

import { useEffect, useState } from "react";
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

export const useTaskRuns = (taskId: string) => {
  const socket = useSocket();
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    void api
      .listTaskRuns(taskId)
      .then((items) => {
        if (!active) {
          return;
        }

        setRuns(items);
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setRuns([]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onTaskRunUpdate = (run: TaskRun) => {
      if (run.taskId !== taskId) {
        return;
      }

      setRuns((current) => {
        const existingIndex = current.findIndex((item) => item.id === run.id);
        if (existingIndex === -1) {
          return [...current, run].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        }

        const next = [...current];
        next[existingIndex] = {
          ...next[existingIndex],
          ...run,
          logs: run.logs.length > 0 ? run.logs : next[existingIndex].logs
        };
        return next;
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

    socket.on("task:run_updated", onTaskRunUpdate);
    socket.on("task:log", onTaskLog);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("task:run_updated", onTaskRunUpdate);
      socket.off("task:log", onTaskLog);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [socket, taskId]);

  return { runs, loading };
};
