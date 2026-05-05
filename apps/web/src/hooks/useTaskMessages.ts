"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskMessage } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskDeletedPayload {
  id: string;
}

const HISTORY_PAGE_SIZE = 25;

const sortMessages = (items: TaskMessage[]): TaskMessage[] => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const mergeMessages = (base: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] => {
  const merged = new Map<string, TaskMessage>();
  for (const item of base) {
    merged.set(item.id, item);
  }
  for (const item of incoming) {
    merged.set(item.id, item);
  }
  return sortMessages([...merged.values()]);
};

export const useTaskMessages = (taskId: string) => {
  const socket = useSocket();
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const refetch = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<TaskMessage[]> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const page = await api.listTaskMessages(taskId, { limit: HISTORY_PAGE_SIZE });
        setMessages(sortMessages(page.items));
        setHasMore(page.hasMore);
        setLoading(false);
        return page.items;
      } catch {
        setMessages([]);
        setHasMore(false);
        setLoading(false);
        return [];
      }
    },
    [taskId]
  );

  const loadMore = useCallback(async (): Promise<TaskMessage[]> => {
    if (loadingMore || !hasMore) {
      return [];
    }

    const oldest = messages[0] ?? null;
    if (!oldest) {
      return [];
    }

    setLoadingMore(true);
    try {
      const page = await api.listTaskMessages(taskId, {
        limit: HISTORY_PAGE_SIZE,
        before: oldest.createdAt,
        beforeId: oldest.id
      });
      setMessages((current) => mergeMessages(current, page.items));
      setHasMore(page.hasMore);
      return page.items;
    } catch {
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, messages, taskId]);

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

      setMessages((current) => mergeMessages(current, [message]));
    };

    const onTaskMessageUpdated = (message: TaskMessage) => {
      if (message.taskId !== taskId) {
        return;
      }

      setMessages((current) => mergeMessages(current, [message]));
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }

      setMessages([]);
      setHasMore(false);
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

  return { messages, setMessages, loading, loadingMore, hasMore, refetch, loadMore };
};
