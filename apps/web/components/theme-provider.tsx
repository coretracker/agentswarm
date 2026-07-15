"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConfigProvider } from "antd";
import { getAppAntdTheme, isDarkAppTheme, type AppThemeMode } from "../src/theme/antd-theme";

const THEME_STORAGE_KEY = "verft-theme-mode";
const DEFAULT_THEME_MODE: AppThemeMode = "graphite-dark";

interface ThemeModeContextValue {
  mode: AppThemeMode;
  setMode: (mode: AppThemeMode) => void;
  isDarkTheme: boolean;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function getSystemThemeMode(): AppThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_MODE;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "graphite-light" : "graphite-dark";
}

function resolveStoredThemeMode(): AppThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedMode === "graphite-light" || storedMode === "graphite-dark") {
    return storedMode;
  }

  if (storedMode) {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  }

  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppThemeMode>(DEFAULT_THEME_MODE);
  const [hasStoredPreference, setHasStoredPreference] = useState(false);

  useEffect(() => {
    const storedMode = resolveStoredThemeMode();
    setHasStoredPreference(Boolean(storedMode));
    setMode(storedMode ?? getSystemThemeMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    document.documentElement.dataset.theme = mode;
    if (hasStoredPreference) {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  }, [hasStoredPreference, mode]);

  useEffect(() => {
    if (typeof window === "undefined" || hasStoredPreference) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemThemeChange = () => setMode(getSystemThemeMode());

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [hasStoredPreference]);

  const setExplicitMode = useCallback((nextMode: AppThemeMode) => {
    setHasStoredPreference(true);
    setMode(nextMode);
  }, []);

  const contextValue = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode: setExplicitMode,
      isDarkTheme: isDarkAppTheme(mode)
    }),
    [mode, setExplicitMode]
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
