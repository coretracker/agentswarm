"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AuthSession, LoginInput, PermissionScope } from "@agentswarm/shared-types";
import { ApiError, api } from "../src/api/client";

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  refreshSession: () => Promise<AuthSession | null>;
  setSessionUser: (patch: Partial<AuthSession["user"]>) => void;
  login: (input: LoginInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  can: (scope: PermissionScope) => boolean;
  canAll: (scopes: PermissionScope[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = async (): Promise<AuthSession | null> => {
    setLoading(true);
    try {
      const nextSession = await api.getSession();
      setSession(nextSession);
      return nextSession;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        return null;
      }

      throw error;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession().catch(() => {
      setSession(null);
      setLoading(false);
    });
  }, []);

  const scopeSet = new Set(session?.user.scopes ?? []);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        refreshSession,
        setSessionUser: (patch) => {
          setSession((current) => (current ? { ...current, user: { ...current.user, ...patch } } : current));
        },
        login: async (input) => {
          const nextSession = await api.login(input);
          setSession(nextSession);
          return nextSession;
        },
        logout: async () => {
          try {
            await api.logout();
          } finally {
            setSession(null);
          }
        },
        can: (scope) => scopeSet.has(scope),
        canAll: (scopes) => scopes.every((scope) => scopeSet.has(scope))
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
