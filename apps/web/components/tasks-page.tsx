"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getTaskExecutionStatusLabel,
  getTaskTerminalSessionLabel,
  getTaskTypeLabel,
  isTaskWorking,
  type Task
} from "@verft/shared-types";
import { Button, Checkbox, DatePicker, Dropdown, Empty, Flex, Input, List, Modal, Select, Space, Spin, Tag, Typography, message, theme as antTheme } from "antd";
import { DeleteOutlined, MoreOutlined, PushpinFilled } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useTasks } from "../src/hooks/useTasks";
import { getSeenTaskVersions, isTaskSeen, markTaskSeen, migrateSeenTaskVersions, subscribeToSeenTasks, type SeenTaskVersions } from "../src/utils/seen-tasks";
import { useAuth } from "./auth-provider";

function getWorkingIndicatorLabel(task: Task): string {
  if (task.activeInteractiveSession) {
    return `${getTaskTerminalSessionLabel("terminal")} is running`;
  }

  return task.executionStatus !== "idle" ? getTaskExecutionStatusLabel(task.executionStatus) : `${getTaskTypeLabel(task.taskType)} task is working`;
}

function isTaskExecutionBusy(task: Task): boolean {
  return task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running";
}

function canOfferRemoteBranchDeletion(task: Task): boolean {
  const branchName = task.branchName?.trim();
  return Boolean(
    task.branchStrategy === "feature_branch" &&
      branchName &&
      branchName !== task.repoDefaultBranch &&
      branchName !== task.baseBranch
  );
}

function formatRelativeTime(value: string): string {
  const timestamp = dayjs(value);
  const now = dayjs();
  const minutes = now.diff(timestamp, "minute");

  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = now.diff(timestamp, "hour");
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = now.diff(timestamp, "day");
  if (days < 7) {
    return `${days} d ago`;
  }

  return timestamp.format("MMM D");
}

function getTaskStatusTag(task: Task): { label: string; color: string } {
  if (task.activeInteractiveSession) {
    return { label: getTaskTerminalSessionLabel("terminal"), color: "processing" };
  }
  if (task.executionStatus === "failed") {
    return { label: "Failed", color: "error" };
  }
  if (task.executionStatus === "cancelled") {
    return { label: "Cancelled", color: "default" };
  }
  if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
    return { label: getTaskExecutionStatusLabel(task.executionStatus), color: "processing" };
  }

  return { label: "Idle", color: "default" };
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

export function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const { token } = antTheme.useToken();
  const archivedView = searchParams.get("view") === "archived";
  const { tasks, setTasks, loading } = useTasks({ view: archivedView ? "archived" : "active" });
  const { repositories } = useRepositories();
  const [seenTaskVersions, setSeenTaskVersions] = useState<SeenTaskVersions>({});
  const [titleFilter, setTitleFilter] = useState("");
  const [repoFilter, setRepoFilter] = useState<string | undefined>();
  const [createdAtFilter, setCreatedAtFilter] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateTask = can("task:create") && (can("task:build") || can("task:ask") || can("task:terminal"));
  const canEditTask = can("task:edit");
  const canDeleteTask = can("task:delete");
  useEffect(() => {
    const syncSeenTaskVersions = () => {
      setSeenTaskVersions(getSeenTaskVersions());
    };

    syncSeenTaskVersions();
    return subscribeToSeenTasks(syncSeenTaskVersions);
  }, []);

  useEffect(() => {
    const migratedSeenTaskVersions = migrateSeenTaskVersions(seenTaskVersions, tasks);
    if (migratedSeenTaskVersions) {
      setSeenTaskVersions(migratedSeenTaskVersions);
    }
  }, [seenTaskVersions, tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (titleFilter && !task.title.toLowerCase().includes(titleFilter.toLowerCase())) {
        return false;
      }
      if (repoFilter && task.repoId !== repoFilter) {
        return false;
      }
      if (createdAtFilter && !task.createdAt.startsWith(createdAtFilter)) {
        return false;
      }
      return true;
    });
  }, [archivedView, createdAtFilter, repoFilter, tasks, titleFilter]);

  const handleDeleteTask = async (task: Task, options?: { deleteRemoteBranch?: boolean }) => {
    setDeletingTaskId(task.id);
    try {
      await api.deleteTask(task.id, options);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      messageApi.success(`Deleted task "${task.title}"`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to delete task");
    } finally {
      setDeletingTaskId(null);
    }
  };

  const [archivingTaskId, setArchivingTaskId] = useState<string | null>(null);

  const handleArchiveTask = async (task: Task, options?: { deleteRemoteBranch?: boolean }) => {
    setArchivingTaskId(task.id);
    try {
      const updatedTask = await api.archiveTask(task.id, options);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, ...updatedTask, logs: updatedTask.logs.length > 0 ? updatedTask.logs : item.logs }
            : item
        )
      );
      messageApi.success(`Archived "${task.title}"`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to archive task");
    } finally {
      setArchivingTaskId(null);
    }
  };

  const confirmArchiveTask = (task: Task) => {
    let deleteRemoteBranch = false;
    const showBranchCleanup = canOfferRemoteBranchDeletion(task);

    Modal.confirm({
      title: "Archive task",
      content: (
        <Space direction="vertical" size={12}>
          <Typography.Text>{`Archive "${task.title}"?`}</Typography.Text>
          {showBranchCleanup ? (
            <Checkbox onChange={(event) => {
              deleteRemoteBranch = event.target.checked;
            }}>
              Delete remote branch <Typography.Text code>{task.branchName}</Typography.Text>
            </Checkbox>
          ) : null}
        </Space>
      ),
      okText: "Archive",
      onOk: () => handleArchiveTask(task, { deleteRemoteBranch })
    });
  };

  const confirmDeleteTask = (task: Task) => {
    let deleteRemoteBranch = false;
    const showBranchCleanup = canOfferRemoteBranchDeletion(task);

    Modal.confirm({
      title: "Delete task",
      content: (
        <Space direction="vertical" size={12}>
          <Typography.Text>{`Delete "${task.title}"?`}</Typography.Text>
          {showBranchCleanup ? (
            <Checkbox onChange={(event) => {
              deleteRemoteBranch = event.target.checked;
            }}>
              Delete remote branch <Typography.Text code>{task.branchName}</Typography.Text>
            </Checkbox>
          ) : null}
        </Space>
      ),
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => handleDeleteTask(task, { deleteRemoteBranch })
    });
  };

  const openTask = (task: Task) => {
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
    router.push(`/tasks/${task.id}`);
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {archivedView ? "Archived Tasks" : "Tasks"}
            </Typography.Title>
            <Space size={8} wrap>
              <Typography.Text type="secondary">
                {archivedView
                  ? "Archived tasks are kept out of the active work queue. They stay read-only, but you can still delete them."
                  : "Track build and ask tasks across their execution lifecycle."}
              </Typography.Text>
              <Typography.Link onClick={() => router.push(archivedView ? "/tasks" : "/tasks?view=archived")}>
                {archivedView ? "Active Tasks" : "Archived"}
              </Typography.Link>
            </Space>
          </Flex>
          <Space>
            {canCreateTask ? (
              <Button type="primary" onClick={() => router.push("/tasks/new")}>
                New Task
              </Button>
            ) : null}
          </Space>
        </Flex>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Flex align="center" justify="space-between" gap={12} wrap="wrap">
            <Flex align="center" gap={12} wrap="wrap" style={{ flex: "1 1 620px", minWidth: 0 }}>
              <Input
                allowClear
                placeholder="Filter by title"
                value={titleFilter}
                onChange={(event) => setTitleFilter(event.target.value)}
                style={{ flex: "1 1 360px", minWidth: 260 }}
              />
              <Select
                allowClear
                placeholder="Filter by repository"
                style={{ flex: "0 1 240px", minWidth: 180 }}
                value={repoFilter}
                options={repositories.map((repository) => ({ label: repository.name, value: repository.id }))}
                onChange={(value) => setRepoFilter(value)}
              />
              <DatePicker
                allowClear
                style={{ flex: "0 1 220px", minWidth: 180 }}
                placeholder="Filter by created date"
                onChange={(value) => setCreatedAtFilter(value ? value.format("YYYY-MM-DD") : null)}
              />
            </Flex>
            <Typography.Text type="secondary">
              {`${filteredTasks.length} ${filteredTasks.length === 1 ? "task" : "tasks"}`}
            </Typography.Text>
          </Flex>
          <List<Task>
            loading={loading}
            dataSource={filteredTasks}
            split={false}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={archivedView ? "No archived tasks" : "No tasks to show"} />
            }}
            renderItem={(task) => {
              const attentionMarker = getTaskAttentionMarker(task, seenTaskVersions);
              const branchLabel = task.branchName ?? task.baseBranch;
              const status = getTaskStatusTag(task);
              const showWorkingIndicator = isTaskWorking(task);
              const unseen = !isTaskSeen(task, seenTaskVersions);

              return (
                <List.Item style={{ padding: 0, borderBlockEnd: 0, marginBottom: 10 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openTask(task)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTask(task);
                      }
                    }}
                    style={{
                      position: "relative",
                      width: "100%",
                      padding: "14px 18px 14px 26px",
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusLG,
                      background: token.colorBgContainer,
                      boxShadow: token.boxShadowTertiary,
                      cursor: "pointer"
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        insetBlock: 10,
                        insetInlineStart: 10,
                        width: 3,
                        borderRadius: 999,
                        background: attentionMarker?.color ?? (showWorkingIndicator ? token.colorPrimary : token.colorBorderSecondary)
                      }}
                    />
                    <Flex align="center" justify="space-between" gap={16} wrap="wrap">
                      <Flex vertical gap={0} style={{ minWidth: 260, flex: "1 1 420px" }}>
                        <Space size={8} wrap>
                          {task.pinned ? <PushpinFilled style={{ color: "#1C8057" }} /> : null}
                          {showWorkingIndicator ? (
                            <span aria-label={getWorkingIndicatorLabel(task)} title={getWorkingIndicatorLabel(task)} style={{ display: "inline-flex" }}>
                              <Spin size="small" />
                            </span>
                          ) : null}
                          {attentionMarker ? (
                            <span
                              aria-label={attentionMarker.label}
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                backgroundColor: attentionMarker.color,
                                display: "inline-block",
                                flex: "0 0 auto"
                              }}
                            />
                          ) : null}
                          <Typography.Text strong>{task.title}</Typography.Text>
                          <Typography.Text type="secondary">{task.repoName}</Typography.Text>
                          <Typography.Text type="secondary">/</Typography.Text>
                          <Typography.Text code style={{ fontSize: 12 }}>
                            {branchLabel}
                          </Typography.Text>
                          {unseen ? <Tag color="green">New</Tag> : null}
                          {task.hasPendingCheckpoint ? <Tag color="warning">Checkpoint</Tag> : null}
                        </Space>
                      </Flex>
                      <Flex align="center" justify="flex-end" gap={12} wrap="wrap" style={{ flex: "0 1 auto" }}>
                        <Tag color={status.color}>{status.label}</Tag>
                        <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                          {formatRelativeTime(task.updatedAt)}
                        </Typography.Text>
                        <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              canEditTask && !archivedView
                                ? {
                                    key: "archive",
                                    label: "Archive",
                                    disabled: isTaskExecutionBusy(task) || archivingTaskId === task.id
                                  }
                                : null,
                              canDeleteTask
                                ? {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <DeleteOutlined />,
                                    danger: true,
                                    disabled: isTaskExecutionBusy(task) || deletingTaskId === task.id
                                  }
                                : null
                            ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
                            onClick: ({ domEvent, key }) => {
                              domEvent.stopPropagation();
                              if (key === "archive") {
                                confirmArchiveTask(task);
                              }
                              if (key === "delete") {
                                confirmDeleteTask(task);
                              }
                            }
                          }}
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            aria-label={`Task actions for ${task.title}`}
                            loading={archivingTaskId === task.id || deletingTaskId === task.id}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </Dropdown>
                      </Flex>
                    </Flex>
                  </div>
                </List.Item>
              );
            }}
          />
        </Space>
      </Space>
    </>
  );
}
