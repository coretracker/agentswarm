"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAgentProviderLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  isActiveTaskStatus,
  type Task,
  type TaskStatus
} from "@agentswarm/shared-types";
import { Button, Card, DatePicker, Divider, Flex, Input, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { PushpinFilled, PushpinOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useTasks } from "../src/hooks/useTasks";
import { useAuth } from "./auth-provider";

const statusOptions: Array<{ label: string; value: TaskStatus }> = [
  { label: "Plan Queued", value: "plan_queued" },
  { label: "Planning", value: "planning" },
  { label: "Planned", value: "planned" },
  { label: "Build Queued", value: "build_queued" },
  { label: "Building", value: "building" },
  { label: "Review Queued", value: "review_queued" },
  { label: "Reviewing", value: "reviewing" },
  { label: "Ask Queued", value: "ask_queued" },
  { label: "Answering", value: "asking" },
  { label: "In Review", value: "review" },
  { label: "Answered", value: "answered" },
  { label: "Accepted", value: "accepted" },
  { label: "Archived", value: "archived" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Failed", value: "failed" }
];

const statusColor: Record<TaskStatus, string> = {
  plan_queued: "gold",
  planning: "processing",
  planned: "purple",
  build_queued: "cyan",
  building: "blue",
  review_queued: "geekblue",
  reviewing: "geekblue",
  ask_queued: "magenta",
  asking: "magenta",
  review: "orange",
  answered: "lime",
  accepted: "green",
  archived: "default",
  cancelled: "default",
  failed: "red"
};

export function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const { tasks, setTasks, loading } = useTasks();
  const { repositories } = useRepositories();
  const [titleFilter, setTitleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | undefined>();
  const [repoFilter, setRepoFilter] = useState<string | undefined>();
  const [createdAtFilter, setCreatedAtFilter] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateTask = can("task:create");
  const canEditTask = can("task:edit");
  const canDeleteTask = can("task:delete");
  const archivedView = searchParams.get("view") === "archived";
  const visibleStatusOptions = useMemo(
    () => (archivedView ? statusOptions.filter((option) => option.value === "archived") : statusOptions.filter((option) => option.value !== "archived")),
    [archivedView]
  );

  useEffect(() => {
    if (statusFilter && !visibleStatusOptions.some((option) => option.value === statusFilter)) {
      setStatusFilter(undefined);
    }
  }, [statusFilter, visibleStatusOptions]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (archivedView ? task.status !== "archived" : task.status === "archived") {
        return false;
      }
      if (titleFilter && !task.title.toLowerCase().includes(titleFilter.toLowerCase())) {
        return false;
      }
      if (statusFilter && task.status !== statusFilter) {
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
  }, [archivedView, createdAtFilter, repoFilter, statusFilter, tasks, titleFilter]);

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

  const handleTogglePin = async (task: Task) => {
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
      messageApi.success(updatedTask.pinned ? `Pinned "${task.title}"` : `Unpinned "${task.title}"`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to update task pin");
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
                  ? "Archived tasks are read-only and kept out of the active work queue."
                  : "Track plan, review, and ask tasks across their execution lifecycle."}
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
              placeholder="Filter by status"
              style={{ minWidth: 180 }}
              value={statusFilter}
              options={visibleStatusOptions}
              onChange={(value) => setStatusFilter(value)}
            />
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
              onClick: () => router.push(`/tasks/${record.id}`)
            })}
            columns={[
              {
                title: "Title",
                dataIndex: "title",
                render: (value: string, task) => (
                  <Space size={8}>
                    {task.pinned ? <PushpinFilled style={{ color: "#1C8057" }} /> : null}
                    <span>{value}</span>
                  </Space>
                )
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
                title: "Status",
                dataIndex: "status",
                render: (value: TaskStatus, task) => {
                  const tag = <Tag color={statusColor[value]}>{getTaskStatusLabel(value)}</Tag>;
                  if (value !== "failed" || !task.errorMessage?.trim()) {
                    return tag;
                  }

                  return <Tooltip title={task.errorMessage}>{tag}</Tooltip>;
                }
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
                    {canEditTask ? (
                      <Button
                        size="small"
                        icon={task.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        onClick={() => void handleTogglePin(task)}
                        disabled={task.status === "archived"}
                      />
                    ) : null}
                    {canDeleteTask ? (
                      <Popconfirm
                        title="Delete task"
                        description={`Delete "${task.title}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingTaskId === task.id }}
                        onConfirm={() => handleDeleteTask(task)}
                      >
                        <Button danger size="small" disabled={isActiveTaskStatus(task.status) || task.status === "archived"}>
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
