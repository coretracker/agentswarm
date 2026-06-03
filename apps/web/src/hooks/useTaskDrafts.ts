"use client";

import { useEffect, useState } from "react";
import type { TaskDraft } from "@agentswarm/shared-types";
import { api } from "../api/client";

const sortDrafts = (items: TaskDraft[]): TaskDraft[] => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const useTaskDrafts = (enabled = true) => {
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setDrafts([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void api
      .listTaskDrafts()
      .then((items) => {
        if (!active) {
          return;
        }
        setDrafts(sortDrafts(items));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setDrafts([]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return { drafts, setDrafts, loading };
};
