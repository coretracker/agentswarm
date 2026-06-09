"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface AppRightPanelConfig {
  title?: ReactNode;
  extra?: ReactNode;
  content?: ReactNode;
}

interface AppRightPanelContextValue {
  setRightPanel: (next: AppRightPanelConfig | null) => void;
}

const AppRightPanelContext = createContext<AppRightPanelContextValue | null>(null);

export function AppRightPanelProvider({
  value,
  children
}: {
  value: AppRightPanelContextValue;
  children: ReactNode;
}) {
  return <AppRightPanelContext.Provider value={value}>{children}</AppRightPanelContext.Provider>;
}

export function useAppRightPanel(): AppRightPanelContextValue {
  const context = useContext(AppRightPanelContext);
  if (context) {
    return context;
  }

  return {
    setRightPanel: () => {
      // No shell context (e.g. tests or public routes); ignore panel updates.
    }
  };
}
