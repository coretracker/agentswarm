"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskMessage } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskDeletedPayload {
  id: string;
}

export const useTaskMessages = (taskId: string) => {
  const socket = useSocket();
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<TaskMessage[]> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const items = await api.listTaskMessages(taskId);
        setMessages(items);
        setLoading(false);
        return items;
      } catch {
        setMessages([]);
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

    const onTaskMessage = (message: TaskMessage) => {
      if (message.taskId !== taskId) {
        return;
      }

      setMessages((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === message.id);
        if (existingIndex === -1) {
          return [...current, message];
        }

        const next = [...current];
        next[existingIndex] = message;
        return next;
      });
    };

    const onTaskMessageUpdated = (message: TaskMessage) => {
      if (message.taskId !== taskId) {
        return;
      }

      setMessages((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === message.id);
        if (existingIndex === -1) {
          return [...current, message];
        }

        const next = [...current];
        next[existingIndex] = message;
        return next;
      });
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }

      setMessages([]);
    };

    socket.on("connect", onConnect);
    socket.on("task:message", onTaskMessage);
    socket.on("task:message_updated", onTaskMessageUpdated);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("connect", onConnect);
      socket.off("task:message", onTaskMessage);
      socket.off("task:message_updated", onTaskMessageUpdated);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [refetch, socket, taskId]);

  return { messages, setMessages, loading, refetch };
};
