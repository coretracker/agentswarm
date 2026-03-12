"use client";

import { useEffect, useState } from "react";
import type { Repository } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortRepositories = (items: Repository[]): Repository[] => [...items].sort((a, b) => a.name.localeCompare(b.name));

export const useRepositories = () => {
  const socket = useSocket();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api.listRepositories().then((items) => {
      if (!active) {
        return;
      }
      setRepositories(sortRepositories(items));
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

    const onRepositoryUpsert = (repository: Repository) => {
      setRepositories((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === repository.id);
        if (index >= 0) {
          next[index] = repository;
        } else {
          next.push(repository);
        }
        return sortRepositories(next);
      });
    };

    const onRepositoryDelete = (payload: { id: string }) => {
      setRepositories((current) => current.filter((item) => item.id !== payload.id));
    };

    socket.on("repository:created", onRepositoryUpsert);
    socket.on("repository:updated", onRepositoryUpsert);
    socket.on("repository:deleted", onRepositoryDelete);

    return () => {
      socket.off("repository:created", onRepositoryUpsert);
      socket.off("repository:updated", onRepositoryUpsert);
      socket.off("repository:deleted", onRepositoryDelete);
    };
  }, [socket]);

  return { repositories, setRepositories, loading };
};
