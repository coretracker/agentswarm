"use client";

import { Typography, theme as antTheme } from "antd";

export function AppFooterNote() {
  const { token } = antTheme.useToken();

  return (
    <Typography.Text
      style={{
        display: "block",
        textAlign: "center",
        color: token.colorTextTertiary,
        fontSize: 12,
        letterSpacing: 0.2
      }}
    >
      Vibe-coded with love in Austria ❤️🇦🇹
    </Typography.Text>
  );
}
