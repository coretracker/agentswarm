"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export const useSocket = (): Socket | null => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const nextSocket = io(socketUrl, {
      transports: ["websocket"]
    });

    setSocket(nextSocket);

    return () => {
      nextSocket.close();
      setSocket(null);
    };
  }, []);

  return socket;
};
