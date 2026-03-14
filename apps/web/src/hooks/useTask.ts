"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let active = true;
    setLoading(true);

    void api
      .getTask(taskId)
      .then((item) => {
        if (!active) {
          return;
        }

        setTask(item);
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setTask(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [taskId]);

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

    socket.on("task:updated", onTaskUpdate);
    socket.on("task:log", onTaskLog);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("task:updated", onTaskUpdate);
      socket.off("task:log", onTaskLog);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [socket, taskId]);

  return { task, setTask, loading };
};
