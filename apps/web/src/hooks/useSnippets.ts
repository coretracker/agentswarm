"use client";

import { useEffect, useState } from "react";
import type { Snippet } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortSnippets = (items: Snippet[]): Snippet[] => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const useSnippets = (enabled = true) => {
  const socket = useSocket();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setSnippets([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void api
      .listSnippets()
      .then((items) => {
        if (!active) {
          return;
        }

        setSnippets(sortSnippets(items));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setSnippets([]);
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

    const onSnippetUpsert = (snippet: Snippet) => {
      setSnippets((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === snippet.id);
        if (index >= 0) {
          next[index] = snippet;
        } else {
          next.push(snippet);
        }
        return sortSnippets(next);
      });
    };

    const onSnippetDelete = (payload: { id: string }) => {
      setSnippets((current) => current.filter((item) => item.id !== payload.id));
    };

    socket.on("snippet:created", onSnippetUpsert);
    socket.on("snippet:updated", onSnippetUpsert);
    socket.on("snippet:deleted", onSnippetDelete);

    return () => {
      socket.off("snippet:created", onSnippetUpsert);
      socket.off("snippet:updated", onSnippetUpsert);
      socket.off("snippet:deleted", onSnippetDelete);
    };
  }, [enabled, socket]);

  return { snippets, setSnippets, loading };
};
