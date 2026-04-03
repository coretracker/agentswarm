"use client";

import type { CSSProperties } from "react";
import { useThemeMode } from "./theme-provider";

export function AppLogo({
  width,
  height,
  style
}: {
  width: number | string;
  height: number | string;
  style?: CSSProperties;
}) {
  const { isDarkTheme } = useThemeMode();

  return (
    <img
      src="/logo.svg"
      alt="AgentSwarm logo"
      style={{
        width,
        height,
        display: "block",
        filter: isDarkTheme ? "brightness(0) invert(0.95)" : undefined,
        transition: "filter 160ms ease",
        ...style
      }}
    />
  );
}
