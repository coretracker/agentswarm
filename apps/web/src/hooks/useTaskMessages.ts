"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let active = true;
    setLoading(true);

    void api
      .listTaskMessages(taskId)
      .then((items) => {
        if (!active) {
          return;
        }

        setMessages(items);
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setMessages([]);
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

    const onTaskMessage = (message: TaskMessage) => {
      if (message.taskId !== taskId) {
        return;
      }

      setMessages((current) => [...current, message]);
    };

    const onTaskMessageUpdated = (message: TaskMessage) => {
      if (message.taskId !== taskId) {
        return;
      }

      setMessages((current) => current.map((entry) => (entry.id === message.id ? message : entry)));
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }

      setMessages([]);
    };

    socket.on("task:message", onTaskMessage);
    socket.on("task:message_updated", onTaskMessageUpdated);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("task:message", onTaskMessage);
      socket.off("task:message_updated", onTaskMessageUpdated);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [socket, taskId]);

  return { messages, setMessages, loading };
};
