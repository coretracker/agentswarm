"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAgentProviderLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  isActiveTaskStatus,
  isTaskWorking,
  type Task
} from "@agentswarm/shared-types";
import { Button, Card, DatePicker, Divider, Flex, Input, Popconfirm, Select, Space, Spin, Table, Typography, message } from "antd";
import { PushpinFilled } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useTasks } from "../src/hooks/useTasks";
import { getSeenTaskVersions, isTaskSeen, markTaskSeen, migrateSeenTaskVersions, subscribeToSeenTasks, type SeenTaskVersions } from "../src/utils/seen-tasks";
import { useAuth } from "./auth-provider";

function getWorkingIndicatorLabel(task: Task): string {
  if (task.activeInteractiveSession) {
    return "Interactive terminal is running";
  }

  return isActiveTaskStatus(task.status) ? getTaskStatusLabel(task.status) : `${getTaskTypeLabel(task.taskType)} task is working`;
}

export function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const { tasks, setTasks, loading } = useTasks();
  const { repositories } = useRepositories();
  const [seenTaskVersions, setSeenTaskVersions] = useState<SeenTaskVersions>({});
  const [titleFilter, setTitleFilter] = useState("");
  const [repoFilter, setRepoFilter] = useState<string | undefined>();
  const [createdAtFilter, setCreatedAtFilter] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateTask = can("task:create") && (can("task:build") || can("task:ask") || can("task:interactive"));
  const canEditTask = can("task:edit");
  const canDeleteTask = can("task:delete");
  const archivedView = searchParams.get("view") === "archived";
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
      if (archivedView ? task.status !== "archived" : task.status === "archived") {
        return false;
      }
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

  const handleDeleteTask = async (task: Task) => {
    setDeletingTaskId(task.id);
    try {
      await api.deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      messageApi.success(`Deleted task "${task.title}"`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to delete task");
    } finally {
      setDeletingTaskId(null);
    }
  };

  const [archivingTaskId, setArchivingTaskId] = useState<string | null>(null);

  const handleArchiveTask = async (task: Task) => {
    setArchivingTaskId(task.id);
    try {
      const updatedTask = await api.archiveTask(task.id);
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
          {canCreateTask ? (
            <Button type="primary" onClick={() => router.push("/tasks/new")}>
              New Task
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Space size={12} wrap>
            <Input placeholder="Filter by title" value={titleFilter} onChange={(event) => setTitleFilter(event.target.value)} />
            <Select
              allowClear
              placeholder="Filter by repository"
              style={{ minWidth: 220 }}
              value={repoFilter}
              options={repositories.map((repository) => ({ label: repository.name, value: repository.id }))}
              onChange={(value) => setRepoFilter(value)}
            />
            <DatePicker
              style={{ minWidth: 220 }}
              placeholder="Filter by created date"
              onChange={(value) => setCreatedAtFilter(value ? value.format("YYYY-MM-DD") : null)}
            />
          </Space>
          <Divider />
          <Table<Task>
            rowKey="id"
            loading={loading}
            dataSource={filteredTasks}
            pagination={{ pageSize: 10 }}
            style={{ cursor: "pointer" }}
            onRow={(record) => ({
              onClick: () => {
                markTaskSeen(record);
                setSeenTaskVersions((current) => {
                  if (current[record.id] === record.updatedAt) {
                    return current;
                  }

                  return {
                    ...current,
                    [record.id]: record.updatedAt
                  };
                });
                router.push(`/tasks/${record.id}`);
              }
            })}
            columns={[
              {
                title: "Title",
                dataIndex: "title",
                render: (value: string, task) => {
                  const markerColor = task.hasPendingCheckpoint ? "#FA8C16" : !isTaskSeen(task, seenTaskVersions) ? "#1C8057" : null;
                  const markerLabel = task.hasPendingCheckpoint ? "Pending checkpoint" : "Unseen task";
                  const showWorkingIndicator = isTaskWorking(task);

                  return (
                    <Space size={8}>
                      {task.pinned ? <PushpinFilled style={{ color: "#1C8057" }} /> : null}
                      {showWorkingIndicator ? (
                        <span aria-label={getWorkingIndicatorLabel(task)} title={getWorkingIndicatorLabel(task)} style={{ display: "inline-flex" }}>
                          <Spin size="small" />
                        </span>
                      ) : null}
                      {markerColor ? (
                        <span
                          aria-label={markerLabel}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: markerColor,
                            display: "inline-block",
                            flex: "0 0 auto"
                          }}
                        />
                      ) : null}
                      <span>{value}</span>
                    </Space>
                  );
                }
              },
              {
                title: "Repository",
                dataIndex: "repoName"
              },
              {
                title: "Type",
                dataIndex: "taskType",
                render: (value: Task["taskType"]) => getTaskTypeLabel(value)
              },
              {
                title: "Provider",
                dataIndex: "provider",
                render: (value: Task["provider"]) => getAgentProviderLabel(value)
              },
              {
                title: "Action",
                dataIndex: "lastAction",
                render: (value: Task["lastAction"]) => value ?? "draft"
              },
              {
                title: "Created At",
                dataIndex: "createdAt",
                sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
                render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm")
              },
              {
                title: "Actions",
                key: "actions",
                width: 170,
                render: (_value, task) => (
                  <Space onClick={(event) => event.stopPropagation()}>
                    {canEditTask && !archivedView ? (
                      <Popconfirm
                        title="Archive task"
                        description={`Archive "${task.title}"?`}
                        okText="Archive"
                        okButtonProps={{ loading: archivingTaskId === task.id }}
                        onConfirm={() => void handleArchiveTask(task)}
                      >
                        <Button size="small" disabled={isActiveTaskStatus(task.status)}>
                          Archive
                        </Button>
                      </Popconfirm>
                    ) : null}
                    {canDeleteTask ? (
                      <Popconfirm
                        title="Delete task"
                        description={`Delete "${task.title}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingTaskId === task.id }}
                        onConfirm={() => handleDeleteTask(task)}
                      >
                        <Button danger size="small" disabled={isActiveTaskStatus(task.status)}>
                          Delete
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
