"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getSocketPath, getSocketUrl } from "../lib/public-url";
import { useAuth } from "../../components/auth-provider";

let sharedSocket: Socket | null = null;
let sharedSocketSessionKey: string | null = null;

function closeSharedSocket(): void {
  if (!sharedSocket) {
    sharedSocketSessionKey = null;
    return;
  }

  sharedSocket.close();
  sharedSocket = null;
  sharedSocketSessionKey = null;
}

function ensureSharedSocket(sessionKey: string): Socket {
  if (sharedSocket && sharedSocketSessionKey === sessionKey) {
    return sharedSocket;
  }

  closeSharedSocket();

  sharedSocket = io(getSocketUrl() ?? window.location.origin, {
    path: getSocketPath(),
    transports: ["websocket"],
    withCredentials: true
  });
  sharedSocketSessionKey = sessionKey;
  return sharedSocket;
}

export const useSocket = (): Socket | null => {
  const { session } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const sessionKey = session ? `${session.user.id}:${session.expiresAt}` : null;

  useEffect(() => {
    if (!sessionKey) {
      closeSharedSocket();
      setSocket(null);
      return;
    }

    const nextSocket = ensureSharedSocket(sessionKey);
    setSocket(nextSocket);

    return () => {
      setSocket((current) => (current === nextSocket ? null : current));
    };
  }, [sessionKey]);

  return socket;
};
