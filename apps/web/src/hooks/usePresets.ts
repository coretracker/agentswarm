"use client";

import { useEffect, useState } from "react";
import type { Preset } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

const sortPresets = (items: Preset[]): Preset[] => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const usePresets = () => {
  const socket = useSocket();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void api.listPresets().then((items) => {
      if (!active) {
        return;
      }

      setPresets(sortPresets(items));
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

    const onPresetUpsert = (preset: Preset) => {
      setPresets((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.id === preset.id);
        if (index >= 0) {
          next[index] = preset;
        } else {
          next.push(preset);
        }
        return sortPresets(next);
      });
    };

    const onPresetDelete = (payload: { id: string }) => {
      setPresets((current) => current.filter((item) => item.id !== payload.id));
    };

    socket.on("preset:created", onPresetUpsert);
    socket.on("preset:updated", onPresetUpsert);
    socket.on("preset:deleted", onPresetDelete);

    return () => {
      socket.off("preset:created", onPresetUpsert);
      socket.off("preset:updated", onPresetUpsert);
      socket.off("preset:deleted", onPresetDelete);
    };
  }, [socket]);

  return { presets, setPresets, loading };
};
