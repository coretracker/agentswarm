"use client";

import type { TaskChangeProposal } from "@agentswarm/shared-types";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskDeletedPayload {
  id: string;
}

const HISTORY_PAGE_SIZE = 25;
const sortProposals = (items: TaskChangeProposal[]): TaskChangeProposal[] => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const mergeProposals = (base: TaskChangeProposal[], incoming: TaskChangeProposal[]): TaskChangeProposal[] => {
  const merged = new Map<string, TaskChangeProposal>();
  for (const proposal of base) {
    merged.set(proposal.id, proposal);
  }
  for (const proposal of incoming) {
    merged.set(proposal.id, proposal);
  }
  return sortProposals([...merged.values()]);
};

export const useTaskChangeProposals = (taskId: string) => {
  const socket = useSocket();
  const [proposals, setProposals] = useState<TaskChangeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const refetch = useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}): Promise<TaskChangeProposal[]> => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const page = await api.listTaskChangeProposals(taskId, { limit: HISTORY_PAGE_SIZE });
      setProposals(sortProposals(page.items));
      setHasMore(page.hasMore);
      setLoading(false);
      return page.items;
    } catch {
      setProposals([]);
      setHasMore(false);
      setLoading(false);
      return [];
    }
  }, [taskId]);

  useEffect(() => {
    void refetch({ showLoading: true });
  }, [refetch]);

  const loadMore = useCallback(async (): Promise<TaskChangeProposal[]> => {
    if (loadingMore || !hasMore) {
      return [];
    }

    const oldest = proposals[0] ?? null;
    if (!oldest) {
      return [];
    }

    setLoadingMore(true);
    try {
      const page = await api.listTaskChangeProposals(taskId, {
        limit: HISTORY_PAGE_SIZE,
        before: oldest.createdAt,
        beforeId: oldest.id
      });
      setProposals((current) => mergeProposals(current, page.items));
      setHasMore(page.hasMore);
      return page.items;
    } catch {
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, proposals, taskId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onConnect = () => {
      refetch();
    };

    const onProposal = (payload: TaskChangeProposal) => {
      if (payload.taskId !== taskId) {
        return;
      }
      setProposals((current) => mergeProposals(current, [payload]));
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }
      setProposals([]);
      setHasMore(false);
    };

    socket.on("connect", onConnect);
    socket.on("task:change_proposal", onProposal);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("connect", onConnect);
      socket.off("task:change_proposal", onProposal);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [refetch, socket, taskId]);

  return { proposals, loading, loadingMore, hasMore, refetch, loadMore };
};
