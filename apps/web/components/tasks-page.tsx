"use client";

import { useMemo, useState } from "react";
import {
  getAgentProviderLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  isActiveTaskStatus,
  type Task,
  type TaskStatus
} from "@agentswarm/shared-types";
import { Button, Card, DatePicker, Divider, Flex, Input, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useTasks } from "../src/hooks/useTasks";

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
  cancelled: "default",
  failed: "red"
};

export function TasksPage() {
  const router = useRouter();
  const { tasks, setTasks, loading } = useTasks();
  const { repositories } = useRepositories();
  const [titleFilter, setTitleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | undefined>();
  const [repoFilter, setRepoFilter] = useState<string | undefined>();
  const [createdAtFilter, setCreatedAtFilter] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
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
  }, [createdAtFilter, repoFilter, statusFilter, tasks, titleFilter]);

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

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Tasks
            </Typography.Title>
            <Typography.Text type="secondary">Track plan, review, and ask tasks across their execution lifecycle.</Typography.Text>
          </Flex>
          <Button type="primary" onClick={() => router.push("/tasks/new")}>
            New Task
          </Button>
        </Flex>

        <Card bordered={false}>
          <Space size={12} wrap>
            <Input placeholder="Filter by title" value={titleFilter} onChange={(event) => setTitleFilter(event.target.value)} />
            <Select
              allowClear
              placeholder="Filter by status"
              style={{ minWidth: 180 }}
              value={statusFilter}
              options={statusOptions}
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
                dataIndex: "title"
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
                width: 120,
                render: (_value, task) => (
                  <div onClick={(event) => event.stopPropagation()}>
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
                  </div>
                )
              }
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
