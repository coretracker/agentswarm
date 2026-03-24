"use client";

import type { TaskChangeProposal } from "@agentswarm/shared-types";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskDeletedPayload {
  id: string;
}

export const useTaskChangeProposals = (taskId: string) => {
  const socket = useSocket();
  const [proposals, setProposals] = useState<TaskChangeProposal[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    void api
      .listTaskChangeProposals(taskId)
      .then((items) => {
        setProposals(items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        setLoading(false);
      })
      .catch(() => {
        setProposals([]);
        setLoading(false);
      });
  }, [taskId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .listTaskChangeProposals(taskId)
      .then((items) => {
        if (!active) {
          return;
        }
        setProposals(items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setProposals([]);
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

    const onProposal = (payload: TaskChangeProposal) => {
      if (payload.taskId !== taskId) {
        return;
      }
      setProposals((current) => {
        const idx = current.findIndex((p) => p.id === payload.id);
        if (idx === -1) {
          return [...current, payload].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
        const next = [...current];
        next[idx] = payload;
        return next;
      });
    };

    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }
      setProposals([]);
    };

    socket.on("task:change_proposal", onProposal);
    socket.on("task:deleted", onTaskDelete);

    return () => {
      socket.off("task:change_proposal", onProposal);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [socket, taskId]);

  return { proposals, loading, refetch };
};
