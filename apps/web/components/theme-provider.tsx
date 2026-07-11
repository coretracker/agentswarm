"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ConfigProvider } from "antd";
import { getAppAntdTheme, isDarkAppTheme, type AppThemeMode } from "../src/theme/antd-theme";

const THEME_STORAGE_KEY = "verft-theme-mode";
const DEFAULT_THEME_MODE: AppThemeMode = "moss-dark";

interface ThemeModeContextValue {
  mode: AppThemeMode;
  setMode: (mode: AppThemeMode) => void;
  isDarkTheme: boolean;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function resolveInitialThemeMode(): AppThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_MODE;
  }

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (
    storedMode === "ember-light" ||
    storedMode === "ember-dark" ||
    storedMode === "moss-light" ||
    storedMode === "moss-dark" ||
    storedMode === "graphite-light" ||
    storedMode === "graphite-dark"
  ) {
    return storedMode;
  }

  return DEFAULT_THEME_MODE;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppThemeMode>(DEFAULT_THEME_MODE);

  useEffect(() => {
    setMode(resolveInitialThemeMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const contextValue = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode,
      isDarkTheme: isDarkAppTheme(mode)
    }),
    [mode]
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <ConfigProvider theme={getAppAntdTheme(mode)}>{children}</ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }

  return context;
}
