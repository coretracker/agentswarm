"use client";

import { useEffect, useMemo, useState } from "react";
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
import { SearchOutlined } from "@ant-design/icons";
import { isTaskWorking, type Task } from "@verft/shared-types";
import { api } from "../src/api/client";
import { useTasks } from "../src/hooks/useTasks";
import {
  getSeenTaskVersions,
  markTaskSeen,
  migrateSeenTaskVersions,
  subscribeToSeenTasks,
  type SeenTaskVersions
} from "../src/utils/seen-tasks";
import { AppSidebarTaskCard } from "./app-sidebar-task-card";
import { useAuth } from "./auth-provider";
import { TaskCreateModal } from "./task-create-modal";

interface AppSidebarProps {
  pathname: string;
  onNavigate: (path: string) => void;
}

function isLiveTask(task: Task): boolean {
  return isTaskWorking(task);
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
  seenTaskVersions,
  onOpenTask,
  onTogglePin
}: {
  title: string;
  tasks: Task[];
  selectedTaskId: string | null;
  canEditTask: boolean;
  pinningTaskId: string | null;
  seenTaskVersions: SeenTaskVersions;
  onOpenTask: (task: Task) => void;
  onTogglePin: (task: Task) => void;
}) {
  const { token } = antTheme.useToken();

  if (tasks.length === 0) {
    return null;
  }

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

          return (
            <AppSidebarTaskCard
              key={task.id}
              task={task}
              selected={selected}
              canEditTask={canEditTask}
              pinningTaskId={pinningTaskId}
              seenTaskVersions={seenTaskVersions}
              onOpenTask={onOpenTask}
              onTogglePin={onTogglePin}
            />
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
  const canCreateTask = can("task:create") && (can("task:build") || can("task:ask") || can("task:terminal"));
  const { tasks, setTasks, loading } = useTasks({ enabled: canListTasks, view: "active" });
  const [query, setQuery] = useState("");
  const [pinningTaskId, setPinningTaskId] = useState<string | null>(null);
  const [taskCreateModalOpen, setTaskCreateModalOpen] = useState(false);
  const [seenTaskVersions, setSeenTaskVersions] = useState<SeenTaskVersions>({});
  const selectedTaskId = getSelectedTaskId(pathname);

  useEffect(() => {
    if (!canListTasks) {
      setSeenTaskVersions({});
      return;
    }

    const syncSeenTaskVersions = () => {
      setSeenTaskVersions(getSeenTaskVersions());
    };

    syncSeenTaskVersions();
    return subscribeToSeenTasks(syncSeenTaskVersions);
  }, [canListTasks]);

  useEffect(() => {
    const migratedSeenTaskVersions = migrateSeenTaskVersions(seenTaskVersions, tasks);
    if (migratedSeenTaskVersions) {
      setSeenTaskVersions(migratedSeenTaskVersions);
    }
  }, [seenTaskVersions, tasks]);

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

  const handleOpenTask = (task: Task) => {
    markTaskSeen(task);
    setSeenTaskVersions((current) => {
      if (current[task.id] === task.updatedAt) {
        return current;
      }

      return {
        ...current,
        [task.id]: task.updatedAt
      };
    });
    onNavigate(`/tasks/${task.id}`);
  };

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
          <div style={{ padding: 8, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <Flex vertical gap={12}>
              <Input
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by task name"
                prefix={<SearchOutlined />}
              />
              {canCreateTask ? (
                <Button type="primary" block onClick={() => setTaskCreateModalOpen(true)}>
                  New Task
                </Button>
              ) : null}
            </Flex>
          </div>
          <div style={{ minHeight: 0, overflowY: "auto", padding: 8 }}>
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
                  seenTaskVersions={seenTaskVersions}
                  onOpenTask={handleOpenTask}
                  onTogglePin={handleTogglePin}
                />
                <TaskSection
                  title="Running"
                  tasks={runningTasks}
                  selectedTaskId={selectedTaskId}
                  canEditTask={canEditTask}
                  pinningTaskId={pinningTaskId}
                  seenTaskVersions={seenTaskVersions}
                  onOpenTask={handleOpenTask}
                  onTogglePin={handleTogglePin}
                />
                <TaskSection
                  title="Recent"
                  tasks={recentTasks}
                  selectedTaskId={selectedTaskId}
                  canEditTask={canEditTask}
                  pinningTaskId={pinningTaskId}
                  seenTaskVersions={seenTaskVersions}
                  onOpenTask={handleOpenTask}
                  onTogglePin={handleTogglePin}
                />
              </Flex>
            )}
          </div>
        </div>
      ) : null}
      <TaskCreateModal
        open={taskCreateModalOpen}
        onClose={() => setTaskCreateModalOpen(false)}
        onCreated={(task) => {
          setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        }}
      />
    </div>
  );
}
