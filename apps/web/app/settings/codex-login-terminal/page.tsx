"use client";

import Link from "next/link";
import { Flex, Typography, theme as antTheme } from "antd";
import { TaskInteractiveTerminalView } from "../../../components/task-interactive-terminal-view";

function closeWindowAfterSuccessfulLogin(event: { code: number; reason: string }): void {
  if (event.code === 1000 && event.reason === "terminal exited 0") {
    window.setTimeout(() => window.close(), 750);
  }
}

export default function CodexLoginTerminalPage() {
  const { token } = antTheme.useToken();

  return (
    <Flex vertical style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
      <Flex
        align="center"
        justify="space-between"
        style={{
          flexShrink: 0,
          padding: "8px 12px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          gap: 12
        }}
      >
        <Flex vertical gap={0} style={{ minWidth: 0 }}>
          <Typography.Text strong style={{ color: token.colorText }}>
            Sign in to Codex
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Running <code>codex login</code>. Window will close when complete.
          </Typography.Text>
        </Flex>
        <Link href="/settings" style={{ color: token.colorLink, flexShrink: 0 }}>
          ← Back to settings
        </Link>
      </Flex>
      <div style={{ flex: 1, minHeight: 0, padding: 8, background: "#1e1e1e" }}>
        <TaskInteractiveTerminalView
          webSocketPath="/settings/providers/codex-login/terminal"
          disconnectHint="Codex login complete. You may close this window."
          showDisconnectHintOnCleanClose
          onDisconnected={closeWindowAfterSuccessfulLogin}
        />
      </div>
    </Flex>
  );
}
