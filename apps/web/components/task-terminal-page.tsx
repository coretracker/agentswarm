"use client";

import Link from "next/link";
import {
  getTaskTerminalSessionLabel,
  type TaskTerminalSessionMode
} from "@verft/shared-types";
import { Flex, Typography, theme as antTheme } from "antd";
import { TaskInteractiveTerminalView } from "./task-interactive-terminal-view";
import { useTask } from "../src/hooks/useTask";

export function TaskTerminalPage({ taskId }: { taskId: string }) {
  const mode: TaskTerminalSessionMode = "terminal";
  const { token } = antTheme.useToken();
  const { task } = useTask(taskId);

  if (!taskId) {
    return null;
  }

  const terminalLabel = getTaskTerminalSessionLabel(mode);

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
            {task ? `Terminal - ${task.branchName ?? task.repoDefaultBranch} in task workspace` : terminalLabel}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Workspace shell for manual commands. Terminal font: Ctrl/Cmd + +/-; Ctrl/Cmd + 0 resets.
          </Typography.Text>
        </Flex>
        <Link href={`/tasks/${taskId}`} style={{ color: token.colorLink, flexShrink: 0 }}>
          Back to task
        </Link>
      </Flex>
      <div style={{ flex: 1, minHeight: 0, padding: 8, background: "#1e1e1e" }}>
        <TaskInteractiveTerminalView taskId={taskId} mode={mode} />
      </div>
    </Flex>
  );
}
