"use client";

import { useEffect, useState } from "react";
import type { Task } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortTasks = (items: Task[]): Task[] =>
  [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
interface TaskDeletedPayload {
  id: string;
}

export const useTasks = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const socket = useSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setTasks([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void api
      .listTasks()
      .then((items) => {
        if (!active) {
          return;
        }

        setTasks(sortTasks(items));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !socket) {
      return;
    }

    const onTaskUpdate = (task: Task) => {
      setTasks((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === task.id);
        if (index >= 0) {
          next[index] = {
            ...next[index],
            ...task,
            logs: []
          };
        } else {
          next.unshift({ ...task, logs: [] });
        }
        return sortTasks(next);
      });
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      setTasks((current) => current.filter((task) => task.id !== payload.id));
    };

    socket.on("task:created", onTaskUpdate);
    socket.on("task:updated", onTaskUpdate);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("task:created", onTaskUpdate);
      socket.off("task:updated", onTaskUpdate);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [enabled, socket]);

  return { tasks, setTasks, loading };
};
