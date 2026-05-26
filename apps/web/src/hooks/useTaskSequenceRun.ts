"use client";

import { useCallback, useEffect, useState } from "react";
import type { SequenceRun } from "@agentswarm/shared-types";
import { ApiError, api } from "../api/client";
import { useSocket } from "./useSocket";

interface TaskDeletedPayload {
  id: string;
}

export const useTaskSequenceRun = (taskId: string, enabled = true) => {
  const socket = useSocket();
  const [sequenceRun, setSequenceRun] = useState<SequenceRun | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async (): Promise<SequenceRun | null> => {
    if (!enabled) {
      setSequenceRun(null);
      setLoading(false);
      return null;
    }

    try {
      const run = await api.getTaskSequenceRun(taskId);
      setSequenceRun(run);
      setLoading(false);
      return run;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setSequenceRun(null);
        setLoading(false);
        return null;
      }
      setLoading(false);
      return null;
    }
  }, [enabled, taskId]);

  useEffect(() => {
    setLoading(true);
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!socket || !enabled) {
      return;
    }

    const onConnect = () => {
      void refetch();
    };
    const onRunUpdated = (run: SequenceRun) => {
      if (run.taskId !== taskId) {
        return;
      }
      setSequenceRun(run);
    };
    const onTaskDelete = (payload: TaskDeletedPayload) => {
      if (payload.id !== taskId) {
        return;
      }
      setSequenceRun(null);
    };

    socket.on("connect", onConnect);
    socket.on("sequence:run_updated", onRunUpdated);
    socket.on("task:deleted", onTaskDelete);
    return () => {
      socket.off("connect", onConnect);
      socket.off("sequence:run_updated", onRunUpdated);
      socket.off("task:deleted", onTaskDelete);
    };
  }, [enabled, refetch, socket, taskId]);

  return { sequenceRun, loading, refetch };
};
