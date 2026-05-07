"use client";

import { useEffect, useState } from "react";
import type { FlowDefinition } from "@agentswarm/shared-types";
import { api } from "../api/client";

const sortFlows = (items: FlowDefinition[]): FlowDefinition[] => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const useFlows = (enabled = true) => {
  const [flows, setFlows] = useState<FlowDefinition[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setFlows([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void api
      .listFlows()
      .then((items) => {
        if (!active) {
          return;
        }

        setFlows(sortFlows(items));
        setLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setFlows([]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return { flows, setFlows, loading };
};
