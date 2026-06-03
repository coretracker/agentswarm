"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAgentProviderLabel,
  getTaskExecutionStatusLabel,
  getTaskTerminalSessionLabel,
  getTaskTypeLabel,
  isTaskWorking,
  type Task
} from "@agentswarm/shared-types";
import { Button, Card, Checkbox, DatePicker, Divider, Flex, Input, Modal, Select, Space, Spin, Table, Typography, message } from "antd";
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
    return `${getTaskTerminalSessionLabel(task.activeTerminalSessionMode === "git" ? "git" : "interactive")} is running`;
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

export function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const archivedView = searchParams.get("view") === "archived";
  const { tasks, setTasks, loading } = useTasks({ view: archivedView ? "archived" : "active" });
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
                      <Button size="small" loading={archivingTaskId === task.id} disabled={isTaskExecutionBusy(task)} onClick={() => confirmArchiveTask(task)}>
                        Archive
                      </Button>
                    ) : null}
                    {canDeleteTask ? (
                      <Button danger size="small" loading={deletingTaskId === task.id} disabled={isTaskExecutionBusy(task)} onClick={() => confirmDeleteTask(task)}>
                        Delete
                      </Button>
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
