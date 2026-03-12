"use client";

import { useEffect, useState } from "react";
import type { SystemSettings } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { useSocket } from "./useSocket";

export const useSettings = () => {
  const socket = useSocket();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api.getSettings().then((value) => {
      if (!active) {
        return;
      }
      setSettings(value);
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

    const onSettingsUpdate = (value: SystemSettings) => {
      setSettings(value);
    };

    socket.on("settings:updated", onSettingsUpdate);
    return () => {
      socket.off("settings:updated", onSettingsUpdate);
    };
  }, [socket]);

  return { settings, setSettings, loading };
};
