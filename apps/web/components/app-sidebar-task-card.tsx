"use client";

import { useState, type FocusEvent, type KeyboardEvent } from "react";
import { Button, Flex, Spin, Typography, theme as antTheme } from "antd";
import { PushpinFilled, PushpinOutlined } from "@ant-design/icons";
import { getTaskExecutionStatusLabel, getTaskTerminalSessionLabel, isTaskWorking, type Task } from "@verft/shared-types";
import dayjs from "dayjs";
import { isTaskSeen, type SeenTaskVersions } from "../src/utils/seen-tasks";

function isLiveTask(task: Task): boolean {
  return isTaskWorking(task);
}

function getTaskStatusText(task: Task): string {
  if (task.activeInteractiveSession) {
    return `${getTaskTerminalSessionLabel("terminal")} Running`;
  }

  return getTaskExecutionStatusLabel(task.executionStatus);
}

function getStatusAccentColor(task: Task, token: ReturnType<typeof antTheme.useToken>["token"]): string {
  if (isLiveTask(task)) {
    return token.colorPrimary;
  }

  if (task.executionStatus === "failed") {
    return token.colorError;
  }

  if (task.executionStatus === "cancelled") {
    return token.colorWarning;
  }

  if (task.executionStatus === "idle") {
    return token.colorSuccess;
  }

  return token.colorTextSecondary;
}

function getTaskAttentionMarker(task: Task, seenTaskVersions: SeenTaskVersions): { color: string; label: string } | null {
  if (task.hasPendingCheckpoint) {
    return { color: "#FA8C16", label: "Pending checkpoint" };
  }

  if (!isTaskSeen(task, seenTaskVersions)) {
    return { color: "#1C8057", label: "Unseen task" };
  }

  return null;
}

function getTaskKindLabel(task: Task): string {
  if (task.activeInteractiveSession || task.executionAction === "terminal") {
    return "Terminal";
  }

  const action = task.executionAction ?? task.taskType;
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function AppSidebarTaskCard({
  task,
  selected,
  canEditTask,
  pinningTaskId,
  seenTaskVersions,
  onOpenTask,
  onTogglePin
}: {
  task: Task;
  selected: boolean;
  canEditTask: boolean;
  pinningTaskId: string | null;
  seenTaskVersions: SeenTaskVersions;
  onOpenTask: (task: Task) => void;
  onTogglePin: (task: Task) => void;
}) {
  const { token } = antTheme.useToken();
  const [pinControlVisible, setPinControlVisible] = useState(false);
  const statusAccentColor = getStatusAccentColor(task, token);
  const attentionMarker = getTaskAttentionMarker(task, seenTaskVersions);
  const railColor = attentionMarker?.color ?? statusAccentColor;
  const statusText = attentionMarker?.label ?? getTaskStatusText(task);
  const showPinControl = canEditTask && (task.pinned || pinControlVisible || pinningTaskId === task.id);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenTask(task);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setPinControlVisible(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenTask(task)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPinControlVisible(true)}
      onMouseLeave={() => setPinControlVisible(false)}
      onFocus={() => setPinControlVisible(true)}
      onBlur={onBlur}
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "11px 12px 11px 20px",
        borderRadius: token.borderRadiusLG + 2,
        border: `1px solid ${selected ? token.colorPrimaryBorder : "transparent"}`,
        background: selected ? `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})` : token.colorBgElevated,
        boxShadow: selected ? `inset 0 0 0 1px ${token.colorPrimaryBorder}` : "none",
        cursor: "pointer",
        fontFamily: token.fontFamily,
        transition: "border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease"
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          insetBlock: 8,
          insetInlineStart: 7,
          width: selected ? 4 : 3,
          borderRadius: 999,
          background: railColor,
          opacity: selected ? 1 : 0.82
        }}
      />
      <Flex vertical gap={8} style={{ minWidth: 0 }}>
        <Typography.Text
          type="secondary"
          ellipsis={{ tooltip: task.repoName }}
          style={{ fontSize: 12, display: "block", lineHeight: 1.2, marginBlockStart: -4 }}
        >
          {task.repoName}
        </Typography.Text>
        <Flex align="start" justify="space-between" gap={8}>
          <Typography.Text
            strong
            title={task.title}
            ellipsis
            style={{
              lineHeight: 1.28,
              minWidth: 0,
              color: token.colorTextHeading
            }}
          >
            {task.title}
          </Typography.Text>
          {canEditTask ? (
            <Button
              type="text"
              size="small"
              aria-label={task.pinned ? "Unpin task" : "Pin task"}
              icon={task.pinned ? <PushpinFilled style={{ color: token.colorPrimary }} /> : <PushpinOutlined />}
              loading={pinningTaskId === task.id}
              tabIndex={showPinControl ? 0 : -1}
              style={{
                marginBlockStart: -4,
                marginInlineEnd: -8,
                flex: "0 0 auto",
                opacity: showPinControl ? 1 : 0,
                pointerEvents: showPinControl ? "auto" : "none",
                transition: "opacity 120ms ease"
              }}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(task);
              }}
            />
          ) : null}
        </Flex>
        <Flex justify="space-between" align="center" gap={8} wrap={false} style={{ minWidth: 0 }}>
          <Flex align="center" gap={6} style={{ minWidth: 0 }}>
            <span
              title={statusText}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                maxWidth: 128,
                padding: "2px 7px",
                borderRadius: 999,
                color: railColor,
                background: token.colorFillTertiary,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: "16px"
              }}
            >
              {isLiveTask(task) ? <Spin size="small" /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: railColor, flex: "0 0 auto" }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{statusText}</span>
            </span>
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 999,
                color: token.colorTextSecondary,
                background: token.colorFillQuaternary,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: "16px",
                whiteSpace: "nowrap"
              }}
            >
              {getTaskKindLabel(task)}
            </span>
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap", lineHeight: 1.2 }}>
            {dayjs(task.updatedAt).format("MMM D, HH:mm")}
          </Typography.Text>
        </Flex>
      </Flex>
    </div>
  );
}
