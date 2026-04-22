"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ConfigProvider } from "antd";
import { getAppAntdTheme, isDarkAppTheme, type AppThemeMode } from "../src/theme/antd-theme";

const THEME_STORAGE_KEY = "agentswarm-theme-mode";

interface ThemeModeContextValue {
  mode: AppThemeMode;
  setMode: (mode: AppThemeMode) => void;
  isDarkTheme: boolean;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function resolveInitialThemeMode(): AppThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (
    storedMode === "light" ||
    storedMode === "dark" ||
    storedMode === "cyber" ||
    storedMode === "forge" ||
    storedMode === "forge-light" ||
    storedMode === "github" ||
    storedMode === "github-light" ||
    storedMode === "nord" ||
    storedMode === "solarized-light" ||
    storedMode === "gruvbox-dark" ||
    storedMode === "high-contrast" ||
    storedMode === "tokyo-night" ||
    storedMode === "solarized-dark" ||
    storedMode === "paper"
  ) {
    return storedMode;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppThemeMode>("light");

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
