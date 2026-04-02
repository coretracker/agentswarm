"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import {
  App,
  Button,
  Empty,
  Flex,
  Input,
  Spin,
  Typography,
  theme as antTheme
} from "antd";
import { PushpinFilled, PushpinOutlined, SearchOutlined } from "@ant-design/icons";
import {
  getTaskStatusLabel,
  isQueuedTaskStatus,
  isTaskWorking,
  type Task
} from "@agentswarm/shared-types";
import dayjs from "dayjs";
import { api } from "../src/api/client";
import { useTasks } from "../src/hooks/useTasks";
import { useAuth } from "./auth-provider";

interface AppSidebarProps {
  pathname: string;
  onNavigate: (path: string) => void;
}

function isLiveTask(task: Task): boolean {
  return isQueuedTaskStatus(task.status) || isTaskWorking(task);
}

function getTaskStatusText(task: Task): string {
  if (task.activeInteractiveSession) {
    return "Interactive Terminal Running";
  }

  return getTaskStatusLabel(task.status);
}

function getStatusAccentColor(task: Task, token: ReturnType<typeof antTheme.useToken>["token"]): string {
  if (isLiveTask(task)) {
    return token.colorPrimary;
  }

  if (task.status === "failed") {
    return token.colorError;
  }

  if (task.status === "completed" || task.status === "answered" || task.status === "accepted") {
    return token.colorSuccess;
  }

  return token.colorTextSecondary;
}

function getSelectedTaskId(pathname: string): string | null {
  const match = pathname.match(/^\/tasks\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return null;
  }

  return match[1] === "new" ? null : match[1];
}

function TaskSection({
  title,
  tasks,
  selectedTaskId,
  canEditTask,
  pinningTaskId,
  onOpenTask,
  onTogglePin
}: {
  title: string;
  tasks: Task[];
  selectedTaskId: string | null;
  canEditTask: boolean;
  pinningTaskId: string | null;
  onOpenTask: (taskId: string) => void;
  onTogglePin: (task: Task) => void;
}) {
  const { token } = antTheme.useToken();

  if (tasks.length === 0) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, taskId: string) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenTask(taskId);
  };

  return (
    <Flex vertical gap={8}>
      <Typography.Text
        strong
        style={{
          fontSize: 12,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: token.colorTextTertiary
        }}
      >
        {title}
      </Typography.Text>
      <Flex vertical gap={8}>
        {tasks.map((task) => {
          const selected = task.id === selectedTaskId;
          const statusAccentColor = getStatusAccentColor(task, token);

          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTask(task.id)}
              onKeyDown={(event) => onKeyDown(event, task.id)}
              style={{
                padding: "10px 12px",
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: "pointer",
                transition: "border-color 0.2s ease, background-color 0.2s ease"
              }}
            >
              <Flex align="start" gap={8}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 14, paddingTop: 3 }}>
                  {isLiveTask(task) ? (
                    <Spin size="small" />
                  ) : (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: statusAccentColor,
                        display: "inline-block"
                      }}
                    />
                  )}
                </div>
                <Flex vertical gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="start" justify="space-between" gap={6}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text strong ellipsis={{ tooltip: task.title }} style={{ display: "block", lineHeight: 1.25 }}>
                        {task.title}
                      </Typography.Text>
                    </div>
                    {canEditTask ? (
                      <Button
                        type="text"
                        size="small"
                        aria-label={task.pinned ? "Unpin task" : "Pin task"}
                        icon={task.pinned ? <PushpinFilled style={{ color: token.colorPrimary }} /> : <PushpinOutlined />}
                        loading={pinningTaskId === task.id}
                        style={{ marginInlineEnd: -8 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTogglePin(task);
                        }}
                      />
                    ) : null}
                  </Flex>
                  <Typography.Text
                    type="secondary"
                    ellipsis={{ tooltip: task.repoName }}
                    style={{ fontSize: 12, display: "block", lineHeight: 1.2 }}
                  >
                    {task.repoName}
                  </Typography.Text>
                  <Flex justify="space-between" align="center" gap={8} wrap={false}>
                    <Typography.Text
                      ellipsis={{ tooltip: getTaskStatusText(task) }}
                      style={{ fontSize: 12, color: statusAccentColor, flex: 1, minWidth: 0, lineHeight: 1.2 }}
                    >
                      {getTaskStatusText(task)}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap", lineHeight: 1.2 }}>
                      {dayjs(task.updatedAt).format("MMM D, HH:mm")}
                    </Typography.Text>
                  </Flex>
                </Flex>
              </Flex>
            </div>
          );
        })}
      </Flex>
    </Flex>
  );
}

export function AppSidebar({ pathname, onNavigate }: AppSidebarProps) {
  const { token } = antTheme.useToken();
  const { message } = App.useApp();
  const { can } = useAuth();
  const canListTasks = can("task:list");
  const canEditTask = can("task:edit");
  const { tasks, setTasks, loading } = useTasks({ enabled: canListTasks });
  const [query, setQuery] = useState("");
  const [pinningTaskId, setPinningTaskId] = useState<string | null>(null);
  const selectedTaskId = getSelectedTaskId(pathname);

  const visibleTasks = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return tasks
      .filter((task) => task.status !== "archived")
      .filter((task) => (trimmedQuery ? task.title.toLowerCase().includes(trimmedQuery) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [query, tasks]);

  const pinnedTasks = useMemo(() => visibleTasks.filter((task) => task.pinned), [visibleTasks]);
  const runningTasks = useMemo(
    () => visibleTasks.filter((task) => !task.pinned && isLiveTask(task)),
    [visibleTasks]
  );
  const recentTasks = useMemo(
    () => visibleTasks.filter((task) => !task.pinned && !isLiveTask(task)),
    [visibleTasks]
  );

  const handleTogglePin = async (task: Task) => {
    if (!canEditTask) {
      return;
    }

    setPinningTaskId(task.id);
    try {
      const updatedTask = await api.updateTaskPin(task.id, { pinned: !task.pinned });
      setTasks((current) =>
        current
          .map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  ...updatedTask,
                  logs: updatedTask.logs.length > 0 ? updatedTask.logs : item.logs
                }
              : item
          )
          .sort((a, b) => {
            if (a.pinned !== b.pinned) {
              return a.pinned ? -1 : 1;
            }

            return b.createdAt.localeCompare(a.createdAt);
          })
      );
      message.success(updatedTask.pinned ? "Task pinned" : "Task unpinned");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to update task pin");
    } finally {
      setPinningTaskId(null);
    }
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: token.colorBgContainer
      }}
    >
      {canListTasks ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={{ padding: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <Flex vertical gap={12}>
              <Input
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by task name"
                prefix={<SearchOutlined />}
              />
            </Flex>
          </div>
          <div style={{ minHeight: 0, overflowY: "auto", padding: 16 }}>
            {loading ? (
              <Flex align="center" justify="center" style={{ minHeight: 160 }}>
                <Spin tip="Loading tasks" />
              </Flex>
            ) : visibleTasks.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query.trim() ? "No matching tasks" : "No tasks to show"}
                style={{ marginTop: 32 }}
              />
            ) : (
              <Flex vertical gap={16}>
                <TaskSection
                  title="Pinned"
                  tasks={pinnedTasks}
                  selectedTaskId={selectedTaskId}
                  canEditTask={canEditTask}
                  pinningTaskId={pinningTaskId}
                  onOpenTask={(taskId) => onNavigate(`/tasks/${taskId}`)}
                  onTogglePin={handleTogglePin}
                />
                <TaskSection
                  title="Running"
                  tasks={runningTasks}
                  selectedTaskId={selectedTaskId}
                  canEditTask={canEditTask}
                  pinningTaskId={pinningTaskId}
                  onOpenTask={(taskId) => onNavigate(`/tasks/${taskId}`)}
                  onTogglePin={handleTogglePin}
                />
                <TaskSection
                  title="Recent"
                  tasks={recentTasks}
                  selectedTaskId={selectedTaskId}
                  canEditTask={canEditTask}
                  pinningTaskId={pinningTaskId}
                  onOpenTask={(taskId) => onNavigate(`/tasks/${taskId}`)}
                  onTogglePin={handleTogglePin}
                />
              </Flex>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
