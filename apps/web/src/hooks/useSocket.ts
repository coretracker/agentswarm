"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getSocketPath, getSocketUrl } from "../lib/public-url";
import { useAuth } from "../../components/auth-provider";

export const useSocket = (): Socket | null => {
  const { session } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!session) {
      setSocket(null);
      return;
    }

    const nextSocket = io(getSocketUrl() ?? window.location.origin, {
      path: getSocketPath(),
      transports: ["websocket"],
      withCredentials: true
    });

    setSocket(nextSocket);

    return () => {
      nextSocket.close();
      setSocket(null);
    };
  }, [session]);

  return socket;
};
