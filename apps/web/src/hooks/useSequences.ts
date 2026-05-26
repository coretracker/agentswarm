"use client";

import { useEffect, useState } from "react";
import type { Sequence } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortSequences = (items: Sequence[]): Sequence[] => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const useSequences = (enabled = true) => {
  const socket = useSocket();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setSequences([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void api
      .listSequences()
      .then((items) => {
        if (!active) {
          return;
        }
        setSequences(sortSequences(items));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setSequences([]);
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

    const onSequenceUpsert = (sequence: Sequence) => {
      setSequences((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === sequence.id);
        if (index >= 0) {
          next[index] = sequence;
        } else {
          next.push(sequence);
        }
        return sortSequences(next);
      });
    };

    const onSequenceDelete = (payload: { id: string }) => {
      setSequences((current) => current.filter((item) => item.id !== payload.id));
    };

    socket.on("sequence:created", onSequenceUpsert);
    socket.on("sequence:updated", onSequenceUpsert);
    socket.on("sequence:deleted", onSequenceDelete);

    return () => {
      socket.off("sequence:created", onSequenceUpsert);
      socket.off("sequence:updated", onSequenceUpsert);
      socket.off("sequence:deleted", onSequenceDelete);
    };
  }, [enabled, socket]);

  return { sequences, setSequences, loading };
};
