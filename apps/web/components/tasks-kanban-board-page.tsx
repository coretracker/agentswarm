"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { PlusOutlined } from "@ant-design/icons";
import {
  getTaskExecutionStatusLabel,
  getTaskTypeLabel,
  getTaskWorkflowStatusLabel,
  type Task,
  type TaskDraft,
  type UpdateTaskStateInput
} from "@agentswarm/shared-types";
import { Button, Card, Empty, Flex, Space, Spin, Tag, Typography, message, theme as antTheme } from "antd";
import dayjs from "dayjs";
import { api } from "../src/api/client";
import { useTaskDrafts } from "../src/hooks/useTaskDrafts";
import { useTasks } from "../src/hooks/useTasks";
import { useAuth } from "./auth-provider";
import { TaskCreateModal } from "./task-create-modal";

type BoardColumnId = "backlog" | "ready" | "in_progress" | "review" | "done";
type BoardTaskStatus = UpdateTaskStateInput["status"];
type BoardItem =
  | { id: string; type: "draft"; draft: TaskDraft; column: BoardColumnId }
  | { id: string; type: "task"; task: Task; column: BoardColumnId };

const columns: Array<{ id: BoardColumnId; title: string; taskStatus?: BoardTaskStatus; acceptsTasks: boolean }> = [
  { id: "backlog", title: "Backlog", acceptsTasks: false },
  { id: "ready", title: getTaskWorkflowStatusLabel("ready"), taskStatus: "open", acceptsTasks: true },
  { id: "in_progress", title: getTaskWorkflowStatusLabel("in_progress"), taskStatus: "in_progress", acceptsTasks: true },
  { id: "review", title: getTaskWorkflowStatusLabel("review"), taskStatus: "in_review", acceptsTasks: true },
  { id: "done", title: getTaskWorkflowStatusLabel("done"), taskStatus: "done", acceptsTasks: true }
];

const taskColumn = (task: Task): BoardColumnId => {
  if (task.workflowStatus === "done") {
    return "done";
  }
  if (task.workflowStatus === "review") {
    return "review";
  }
  if (task.workflowStatus === "in_progress") {
    return "in_progress";
  }
  return "ready";
};

const getItemDeadline = (item: BoardItem): string | null =>
  item.type === "task" ? item.task.deadline : item.draft.definition.deadline ?? null;

const getItemTitle = (item: BoardItem): string => (item.type === "task" ? item.task.title : item.draft.title);

const compareItemsByDeadline = (left: BoardItem, right: BoardItem): number => {
  const leftDeadline = getItemDeadline(left);
  const rightDeadline = getItemDeadline(right);
  if (leftDeadline && rightDeadline) {
    const deadlineComparison = leftDeadline.localeCompare(rightDeadline);
    if (deadlineComparison !== 0) {
      return deadlineComparison;
    }
  } else if (leftDeadline) {
    return -1;
  } else if (rightDeadline) {
    return 1;
  }

  return getItemTitle(left).localeCompare(getItemTitle(right));
};

function KanbanColumn({
  column,
  canCreate,
  onAdd,
  children
}: {
  column: (typeof columns)[number];
  canCreate: boolean;
  onAdd: (column: (typeof columns)[number]) => void;
  children: ReactNode;
}) {
  const { token } = antTheme.useToken();
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    disabled: !column.acceptsTasks
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 290,
        width: 320,
        flex: "0 0 320px",
        background: isOver ? token.colorPrimaryBg : token.colorFillQuaternary,
        border: `1px solid ${isOver ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: 8,
        padding: 12,
        minHeight: "calc(100vh - 220px)"
      }}
    >
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center">
          <Typography.Text strong>{column.title}</Typography.Text>
          {canCreate ? (
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              aria-label={`Create in ${column.title}`}
              title={`Create in ${column.title}`}
              onClick={() => onAdd(column)}
            />
          ) : null}
        </Flex>
        {children}
      </Flex>
    </div>
  );
}

function KanbanCard({ item, onOpen }: { item: BoardItem; onOpen: (item: BoardItem) => void }) {
  const draggable = useDraggable({
    id: item.id,
    disabled: item.type !== "task",
    data: item
  });
  const style = {
    transform: CSS.Translate.toString(draggable.transform),
    opacity: draggable.isDragging ? 0.65 : 1,
    cursor: item.type === "task" ? "grab" : "pointer"
  };
  const task = item.type === "task" ? item.task : null;
  const draft = item.type === "draft" ? item.draft : null;
  const deadline = getItemDeadline(item);

  return (
    <Card
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      size="small"
      hoverable
      onClick={() => onOpen(item)}
      style={{ ...style, borderRadius: 8 }}
      bodyStyle={{ padding: 12 }}
    >
      <Flex vertical gap={8}>
        <Typography.Text strong ellipsis={{ tooltip: task?.title ?? draft?.title }}>
          {task?.title ?? draft?.title}
        </Typography.Text>
        <Space size={[6, 6]} wrap>
          {draft ? <Tag color="default">Draft</Tag> : null}
          {task ? <Tag>{getTaskTypeLabel(task.taskType)}</Tag> : null}
          {task && task.executionStatus !== "idle" ? <Tag color={task.executionStatus === "failed" ? "red" : "blue"}>{getTaskExecutionStatusLabel(task.executionStatus)}</Tag> : null}
          {task?.reviewReason ? <Tag color="gold">{task.reviewReason}</Tag> : null}
        </Space>
        {task ? (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {task.repoName}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Deadline {deadline ? dayjs(deadline).format("YYYY-MM-DD HH:mm") : "None"}
            </Typography.Text>
          </>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Deadline {deadline ? dayjs(deadline).format("YYYY-MM-DD HH:mm") : "None"}
          </Typography.Text>
        )}
      </Flex>
    </Card>
  );
}

export function TasksKanbanBoardPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [messageApi, contextHolder] = message.useMessage();
  const { tasks, setTasks, loading: tasksLoading } = useTasks({ view: "active" });
  const { drafts, setDrafts, loading: draftsLoading } = useTaskDrafts();
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [taskCreateModalOpen, setTaskCreateModalOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<TaskDraft | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const loading = tasksLoading || draftsLoading;
  const canCreateTask = can("task:create");

  const items = useMemo<BoardItem[]>(() => {
    const taskItems: BoardItem[] = tasks
      .filter((task) => task.status !== "archived")
      .map((task) => ({ id: `task:${task.id}`, type: "task", task, column: taskColumn(task) }));
    const draftItems: BoardItem[] = drafts.map((draft) => ({ id: `draft:${draft.id}`, type: "draft", draft, column: "backlog" }));
    return [...draftItems, ...taskItems];
  }, [drafts, tasks]);

  const itemsByColumn = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.id,
          items.filter((item) => item.column === column.id).sort(compareItemsByDeadline)
        ])
      ) as Record<BoardColumnId, BoardItem[]>,
    [items]
  );

  const openItem = (item: BoardItem) => {
    if (item.type === "draft") {
      setSelectedDraft(item.draft);
      setTaskCreateModalOpen(true);
      return;
    }

    router.push(`/tasks/${item.task.id}`);
  };

  const openCreateModal = () => {
    setSelectedDraft(null);
    setTaskCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setTaskCreateModalOpen(false);
    setSelectedDraft(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const item = event.active.data.current as BoardItem | undefined;
    const column = columns.find((entry) => entry.id === event.over?.id);
    if (!item || item.type !== "task" || !column?.taskStatus || item.column === column.id) {
      return;
    }

    setMovingTaskId(item.task.id);
    try {
      const updated = await api.updateTaskState(item.task.id, { status: column.taskStatus });
      setTasks((current) => current.map((task) => (task.id === updated.id ? { ...task, ...updated, logs: task.logs } : task)));
      messageApi.success(`Moved to ${column.title}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Could not move task");
    } finally {
      setMovingTaskId(null);
    }
  };

  return (
    <>
      {contextHolder}
      <Flex vertical gap={16}>
        <Flex justify="space-between" align="center" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Task Board
            </Typography.Title>
            <Typography.Text type="secondary">Plan drafts and move active tasks through the workflow.</Typography.Text>
          </Flex>
          <Space>
            <Button onClick={() => router.push("/tasks")}>Table</Button>
            {canCreateTask ? <Button type="primary" onClick={openCreateModal}>New Task</Button> : null}
          </Space>
        </Flex>
        {loading ? (
          <Flex justify="center" style={{ padding: 80 }}>
            <Spin />
          </Flex>
        ) : (
          <DndContext sensors={sensors} onDragEnd={(event) => void handleDragEnd(event)}>
            <Flex gap={16} align="stretch" style={{ overflowX: "auto", paddingBottom: 12 }}>
              {columns.map((column) => (
                <KanbanColumn key={column.id} column={column} canCreate={canCreateTask} onAdd={openCreateModal}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {itemsByColumn[column.id].length} item{itemsByColumn[column.id].length === 1 ? "" : "s"}
                  </Typography.Text>
                  {itemsByColumn[column.id].length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cards" />
                  ) : (
                    <Flex vertical gap={10}>
                      {itemsByColumn[column.id].map((item) => (
                        <KanbanCard key={item.id} item={item} onOpen={openItem} />
                      ))}
                    </Flex>
                  )}
                </KanbanColumn>
              ))}
            </Flex>
          </DndContext>
        )}
        {movingTaskId ? <Typography.Text type="secondary">Moving task...</Typography.Text> : null}
      </Flex>
      <TaskCreateModal
        open={taskCreateModalOpen}
        draft={selectedDraft}
        onClose={closeCreateModal}
        onCreated={(task) => {
          setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        }}
        onDraftCreated={(draft) => {
          setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
        }}
        onDraftUpdated={(draft) => {
          setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
        }}
        onDraftDeleted={(draftId) => {
          setDrafts((current) => current.filter((item) => item.id !== draftId));
        }}
      />
    </>
  );
}
