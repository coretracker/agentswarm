"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { markTaskSeen } from "../utils/seen-tasks";
import { useSocket } from "./useSocket";

interface TaskLogPayload {
  taskId: string;
  line: string;
}

interface TaskDeletedPayload {
  id: string;
}

const MAX_LOG_LINES = 400;

export const useTask = (taskId: string) => {
  const socket = useSocket();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const activeTaskIdRef = useRef(taskId);

  useEffect(() => {
    activeTaskIdRef.current = taskId;
  }, [taskId]);

  const refetch = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<Task | null> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const item = await api.getTask(taskId);
        if (activeTaskIdRef.current !== taskId) {
          return null;
        }

        setTask(item);
        setLoading(false);
        return item;
      } catch {
        if (activeTaskIdRef.current !== taskId) {
          return null;
        }

        setTask(null);
        setLoading(false);
        return null;
      }
    },
    [taskId]
  );

  useEffect(() => {
    void refetch({ showLoading: true });
  }, [refetch]);

  useEffect(() => {
    if (!task) {
      return;
    }

    markTaskSeen(task);
  }, [task]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onConnect = () => {
      void refetch();
    };

    const onTaskUpdate = (nextTask: Task) => {
      if (nextTask.id !== taskId) {
        return;
      }

      setTask((current) =>
        current
          ? {
              ...current,
              ...nextTask,
              logs: nextTask.logs.length > 0 ? nextTask.logs : current.logs
            }
          : nextTask
      );

      void refetch();
    };

    const onTaskLog = (payload: TaskLogPayload) => {
      if (payload.taskId !== taskId) {
        return;
      }

      setTask((current) =>
        current
          ? {
              ...current,
              logs: [...current.logs, payload.line].slice(-MAX_LOG_LINES)
            }
          : current
      );
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }

      setTask(null);
    };

    socket.on("connect", onConnect);
    socket.on("task:updated", onTaskUpdate);
    socket.on("task:log", onTaskLog);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("connect", onConnect);
      socket.off("task:updated", onTaskUpdate);
      socket.off("task:log", onTaskLog);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [refetch, socket, taskId]);

  return { task, setTask, loading, refetch };
};
