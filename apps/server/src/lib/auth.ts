import type { IncomingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthSession, PermissionScope, RealtimeEvent } from "@agentswarm/shared-types";
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { SessionStore } from "../services/session-store.js";
import type { UserStore } from "../services/user-store.js";

const realtimeScopesByEventType: Record<RealtimeEvent["type"], PermissionScope[]> = {
  "task:created": ["task:list", "task:read"],
  "task:updated": ["task:list", "task:read"],
  "task:deleted": ["task:list", "task:read"],
  "task:log": ["task:read"],
  "task:message": ["task:read"],
  "task:run_updated": ["task:read"],
  "task:change_proposal": ["task:read"],
  "preset:created": ["preset:list"],
  "preset:updated": ["preset:list"],
  "preset:deleted": ["preset:list"],
  "repository:created": ["repo:list"],
  "repository:updated": ["repo:list"],
  "repository:deleted": ["repo:list"],
  "settings:updated": ["settings:read"]
};

const parseCookieHeader = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((cookies, chunk) => {
    const [namePart, ...valueParts] = chunk.split("=");
    const name = namePart?.trim();
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join("=").trim());
    return cookies;
  }, {});
};

const scopeRoom = (scope: PermissionScope): string => `scope:${scope}`;

export interface RequestAuthContext {
  user: AuthSession["user"];
  scopes: Set<PermissionScope>;
  sessionToken: string;
  expiresAt: string;
  session: AuthSession;
}

export interface AuthService {
  requireAuth: () => AuthPreHandler;
  requireAllScopes: (scopes: PermissionScope[]) => AuthPreHandler;
  /** Cookie-based auth for raw Node HTTP upgrades (e.g. interactive terminal WebSocket). */
  authenticateCookieHeader: (headers: IncomingHttpHeaders) => Promise<RequestAuthContext | null>;
  setSessionCookie: (reply: FastifyReply, token: string, expiresAt: string) => void;
  clearSessionCookie: (reply: FastifyReply) => void;
  clearSessionFromRequest: (request: FastifyRequest) => Promise<void>;
  buildSessionResponse: (userId: string, expiresAt: string) => Promise<AuthSession>;
  authorizeSocket: () => (
    socket: Socket,
    next: (error?: Error) => void
  ) => void | Promise<void>;
  onSocketConnection: (socket: Socket) => void;
  emitScopedRealtimeEvent: (io: SocketIOServer, event: RealtimeEvent) => void;
}

type AuthPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export const createAuthService = ({
  cookieName,
  sessionStore,
  userStore
}: {
  cookieName: string;
  sessionStore: SessionStore;
  userStore: UserStore;
}): AuthService => {
  const getRequestToken = (request: FastifyRequest): string | null => {
    const token = request.cookies?.[cookieName];
    return token?.trim() ? token.trim() : null;
  };

  const buildAuthContext = async (token: string | null): Promise<RequestAuthContext | null> => {
    if (!token) {
      return null;
    }

    const session = await sessionStore.getSession(token);
    if (!session) {
      return null;
    }

    const user = await userStore.getAuthSessionUser(session.userId);
    if (!user) {
      await sessionStore.deleteSession(token);
      return null;
    }

    return {
      user,
      scopes: new Set(user.scopes),
      sessionToken: token,
      expiresAt: session.expiresAt,
      session: {
        user,
        expiresAt: session.expiresAt
      }
    };
  };

  const loadRequestAuth = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RequestAuthContext | null> => {
    const token = getRequestToken(request);
    const auth = await buildAuthContext(token);
    if (token && !auth) {
      reply.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
    }

    request.auth = auth;
    return auth;
  };

  const requireAuth =
    (): AuthPreHandler =>
    async (request, reply) => {
      const auth = await loadRequestAuth(request, reply);
      if (!auth) {
        return reply.status(401).send({ message: "Authentication required" });
      }
    };

  const requireAllScopes =
    (requiredScopes: PermissionScope[]): AuthPreHandler =>
    async (request, reply) => {
      const auth = await loadRequestAuth(request, reply);
      if (!auth) {
        return reply.status(401).send({ message: "Authentication required" });
      }

      const missingScopes = requiredScopes.filter((scope) => !auth.scopes.has(scope));
      if (missingScopes.length > 0) {
        return reply.status(403).send({ message: "Forbidden" });
      }
    };

  return {
    requireAuth,
    requireAllScopes,
    async authenticateCookieHeader(headers) {
      const raw = headers.cookie;
      const cookieHeader = Array.isArray(raw) ? raw.join("; ") : raw;
      const cookies = parseCookieHeader(cookieHeader);
      const token = cookies[cookieName]?.trim() ? cookies[cookieName].trim() : null;
      return buildAuthContext(token);
    },
    setSessionCookie(reply, token, expiresAt) {
      reply.setCookie(cookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: new Date(expiresAt)
      });
    },
    clearSessionCookie(reply) {
      reply.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
    },
    async clearSessionFromRequest(request) {
      const token = request.auth?.sessionToken ?? getRequestToken(request);
      if (!token) {
        request.auth = null;
        return;
      }

      await sessionStore.deleteSession(token);
      request.auth = null;
    },
    async buildSessionResponse(userId, expiresAt) {
      const user = await userStore.getAuthSessionUser(userId);
      if (!user) {
        throw new Error("Active session user not found");
      }

      return {
        user,
        expiresAt
      };
    },
    authorizeSocket() {
      return async (socket, next) => {
        try {
          const token = parseCookieHeader(socket.handshake.headers.cookie)[cookieName] ?? null;
          const auth = await buildAuthContext(token);
          if (!auth) {
            return next(new Error("Unauthorized"));
          }

          socket.data.auth = auth;
          return next();
        } catch (error) {
          return next(error instanceof Error ? error : new Error("Unauthorized"));
        }
      };
    },
    onSocketConnection(socket) {
      const auth = socket.data.auth as RequestAuthContext | undefined;
      if (!auth) {
        socket.disconnect(true);
        return;
      }

      for (const scope of auth.scopes) {
        socket.join(scopeRoom(scope));
      }
    },
    emitScopedRealtimeEvent(io, event) {
      const requiredScopes = realtimeScopesByEventType[event.type] ?? [];
      if (requiredScopes.length === 0) {
        return;
      }

      let emitter = io.to(scopeRoom(requiredScopes[0]));
      for (const scope of requiredScopes.slice(1)) {
        emitter = emitter.to(scopeRoom(scope));
      }

      emitter.emit(event.type, event.payload);
    }
  };
};
