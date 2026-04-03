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

function matchesTaskView(task: Task, view: "all" | "active" | "archived"): boolean {
  if (view === "active") {
    return task.status !== "archived";
  }
  if (view === "archived") {
    return task.status === "archived";
  }
  return true;
}

export const useTasks = ({
  enabled = true,
  view = "all",
  limit
}: {
  enabled?: boolean;
  view?: "all" | "active" | "archived";
  limit?: number;
} = {}) => {
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
      .listTasks({ view, limit })
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
  }, [enabled, limit, view]);

  useEffect(() => {
    if (!enabled || !socket) {
      return;
    }

    const onTaskUpdate = (task: Task) => {
      setTasks((current) => {
        const next = current.filter((item) => item.id !== task.id);
        if (matchesTaskView(task, view)) {
          next.unshift({ ...task, logs: [] });
        }
        const sorted = sortTasks(next);
        if (limit != null && Number.isFinite(limit)) {
          return sorted.slice(0, Math.max(0, limit));
        }
        return sorted;
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
  }, [enabled, limit, socket, view]);

  return { tasks, setTasks, loading };
};
