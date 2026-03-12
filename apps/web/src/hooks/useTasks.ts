"use client";

import { useEffect, useState } from "react";
import type { Task } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortTasks = (items: Task[]): Task[] => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
interface TaskDeletedPayload {
  id: string;
}

export const useTasks = () => {
  const socket = useSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void api.listTasks().then((items) => {
      if (!active) {
        return;
      }

      setTasks(sortTasks(items));
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!socket) {
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
  }, [socket]);

  return { tasks, setTasks, loading };
};
