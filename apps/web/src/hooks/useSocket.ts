"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "../../components/auth-provider";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export const useSocket = (): Socket | null => {
  const { session } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!session) {
      setSocket(null);
      return;
    }

    const nextSocket = io(socketUrl, {
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
