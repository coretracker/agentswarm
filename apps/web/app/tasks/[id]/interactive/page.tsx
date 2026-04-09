"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getProviderProfileLabel,
  getTaskTerminalSessionLabel,
  type TaskTerminalSessionMode
} from "@agentswarm/shared-types";
import { Flex, Typography, theme as antTheme } from "antd";
import { TaskInteractiveTerminalView } from "../../../../components/task-interactive-terminal-view";
import { useTask } from "../../../../src/hooks/useTask";

export default function TaskInteractiveRoutePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const taskId = typeof params.id === "string" ? params.id : "";
  const mode: TaskTerminalSessionMode = searchParams.get("mode") === "git" ? "git" : "interactive";
  const { token } = antTheme.useToken();
  const { task } = useTask(taskId);

  if (!taskId) {
    return null;
  }

  const providerLabel = task ? getAgentProviderLabel(task.provider) : "Interactive Terminal";
  const modelLabel = task ? task.modelOverride ?? getDefaultModelForProvider(task.provider) : null;
  const effortLabel = task ? getProviderProfileLabel(task.providerProfile) : null;
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
            {mode === "git"
              ? task
                ? `Git Terminal · ${task.branchName ?? task.repoDefaultBranch} in task workspace`
                : terminalLabel
              : task
                ? `Interactive · ${providerLabel} in task workspace`
                : terminalLabel}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {mode === "interactive" && task && modelLabel && effortLabel
              ? `Model: ${modelLabel} · Effort: ${effortLabel} · Terminal font: Ctrl/⌘ + +/− (numpad works); Ctrl/⌘ + 0 resets.`
              : mode === "git"
                ? "Workspace shell for manual git commands. Terminal font: Ctrl/⌘ + +/− (numpad works); Ctrl/⌘ + 0 resets."
                : "Terminal font: Ctrl/⌘ + +/− (numpad works); Ctrl/⌘ + 0 resets."}
          </Typography.Text>
        </Flex>
        <Link href={`/tasks/${taskId}`} style={{ color: token.colorLink, flexShrink: 0 }}>
          ← Back to task
        </Link>
      </Flex>
      <div style={{ flex: 1, minHeight: 0, padding: 8, background: "#1e1e1e" }}>
        <TaskInteractiveTerminalView taskId={taskId} mode={mode} />
      </div>
    </Flex>
  );
}
