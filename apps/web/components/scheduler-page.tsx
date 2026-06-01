"use client";

import { useEffect, useMemo, useState } from "react";
import { getTaskStartModeLabel, type Task, type TaskStartMode } from "@agentswarm/shared-types";
import { Button, Calendar, Card, Empty, Flex, Grid, Segmented, Space, Spin, Tag, Typography, theme as antTheme } from "antd";
import type { Dayjs, ManipulateType } from "dayjs";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useTasks } from "../src/hooks/useTasks";
import { useAuth } from "./auth-provider";
import { TaskCreateModal } from "./task-create-modal";

type CalendarView = "month" | "week" | "day";

interface ScheduledTaskEntry {
  task: Task;
  start: Dayjs;
  end: Dayjs;
}

const HOURS = Array.from({ length: 24 }, (_unused, index) => index);

const START_MODE_ORDER: TaskStartMode[] = ["idle", "run_now", "prepare_workspace"];

const getStartModeTagColor = (startMode: TaskStartMode): "default" | "blue" | "gold" => {
  if (startMode === "run_now") {
    return "blue";
  }
  if (startMode === "prepare_workspace") {
    return "gold";
  }
  return "default";
};

const parseScheduledTasks = (tasks: Task[]): ScheduledTaskEntry[] =>
  tasks
    .flatMap((task) => {
      if (task.status !== "scheduled" || !task.scheduledStartAt || !task.scheduledEndAt) {
        return [];
      }
      const start = dayjs(task.scheduledStartAt);
      const end = dayjs(task.scheduledEndAt);
      if (!start.isValid() || !end.isValid() || !start.isBefore(end)) {
        return [];
      }
      return [{ task, start, end }];
    })
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());

const resolveStartMode = (task: Task): TaskStartMode => task.startMode ?? "idle";

function formatWindow(entry: ScheduledTaskEntry): string {
  return `${entry.start.format("HH:mm")} - ${entry.end.format("HH:mm")}`;
}

function formatWindowWithDate(entry: ScheduledTaskEntry): string {
  return `${entry.start.format("ddd, MMM D • HH:mm")} - ${entry.end.format("HH:mm")}`;
}

function isOnCalendarDay(entry: ScheduledTaskEntry, date: Dayjs): boolean {
  const dayStart = date.startOf("day");
  const dayEnd = date.endOf("day");
  return entry.start.isBefore(dayEnd) && entry.end.isAfter(dayStart);
}

export function SchedulerPage() {
  const router = useRouter();
  const { token } = antTheme.useToken();
  const screens = Grid.useBreakpoint();
  const isWide = Boolean(screens.lg);
  const { can } = useAuth();
  const canCreateTask = can("task:create") && (can("task:build") || can("task:ask"));
  const canEditTask = can("task:edit");
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(dayjs());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { tasks, loading } = useTasks({ view: "scheduled" });

  const scheduledTasks = useMemo(() => parseScheduledTasks(tasks), [tasks]);

  useEffect(() => {
    if (scheduledTasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !scheduledTasks.some((entry) => entry.task.id === selectedTaskId)) {
      setSelectedTaskId(scheduledTasks[0]?.task.id ?? null);
    }
  }, [scheduledTasks, selectedTaskId]);

  const selectedEntry = useMemo(
    () => scheduledTasks.find((entry) => entry.task.id === selectedTaskId) ?? null,
    [scheduledTasks, selectedTaskId]
  );

  const visibleStartModes = useMemo(() => {
    const set = new Set<TaskStartMode>();
    for (const entry of scheduledTasks) {
      set.add(resolveStartMode(entry.task));
    }
    return START_MODE_ORDER.filter((mode) => set.has(mode));
  }, [scheduledTasks]);

  const weekDays = useMemo(() => {
    const start = anchorDate.startOf("week");
    return Array.from({ length: 7 }, (_unused, index) => start.add(index, "day"));
  }, [anchorDate]);

  const dayLabel = useMemo(() => {
    if (view === "month") {
      return anchorDate.format("MMMM YYYY");
    }
    if (view === "day") {
      return anchorDate.format("dddd, MMM D, YYYY");
    }
    const start = weekDays[0] ?? anchorDate.startOf("week");
    const end = weekDays[6] ?? start.add(6, "day");
    return `${start.format("MMM D")} - ${end.format("MMM D, YYYY")}`;
  }, [anchorDate, view, weekDays]);

  const jumpWindow = (direction: -1 | 1) => {
    const unit: ManipulateType = view === "month" ? "month" : view === "week" ? "week" : "day";
    setAnchorDate((current) => current.add(direction, unit));
  };

  const openScheduledTask = (taskId: string) => {
    if (canEditTask) {
      router.push(`/scheduler/tasks/${taskId}`);
      return;
    }
    router.push(`/tasks/${taskId}`);
  };

  const renderEntry = (entry: ScheduledTaskEntry, options?: { compact?: boolean; showTime?: boolean; showMode?: boolean }) => {
    const compact = options?.compact === true;
    const showTime = options?.showTime !== false;
    const showMode = options?.showMode !== false;
    const isSelected = entry.task.id === selectedTaskId;
    const startMode = resolveStartMode(entry.task);

    return (
      <button
        key={entry.task.id}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setSelectedTaskId(entry.task.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          openScheduledTask(entry.task.id);
        }}
        title={`${entry.task.title} (${formatWindow(entry)}) • ${getTaskStartModeLabel(startMode)}`}
        style={{
          width: "100%",
          textAlign: "left",
          borderRadius: compact ? 6 : 8,
          border: `1px solid ${isSelected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
          background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
          padding: compact ? "4px 6px" : "6px 8px",
          cursor: "pointer"
        }}
      >
        <Flex vertical gap={2}>
          <Typography.Text
            strong
            style={{
              fontSize: compact ? 11 : 12,
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden"
            }}
          >
            {entry.task.title}
          </Typography.Text>
          {showTime ? (
            <Typography.Text type="secondary" style={{ fontSize: compact ? 10 : 11, lineHeight: 1.2 }}>
              {formatWindow(entry)}
            </Typography.Text>
          ) : null}
          {showMode ? (
            <span
              style={{
                fontSize: compact ? 10 : 11,
                color: token.colorTextSecondary,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden"
              }}
            >
              Start: {getTaskStartModeLabel(startMode)}
            </span>
          ) : null}
        </Flex>
      </button>
    );
  };

  const renderMonthView = () => (
    <Calendar
      fullscreen={false}
      value={anchorDate}
      onSelect={(value) => setAnchorDate(value)}
      headerRender={() => null}
      fullCellRender={(value) => {
        const entries = scheduledTasks.filter((entry) => isOnCalendarDay(entry, value));
        const visible = entries.slice(0, 2);

        return (
          <div
            style={{
              minHeight: 90,
              padding: 6,
              borderRadius: 8,
              background: value.isSame(dayjs(), "day") ? token.colorBgTextHover : token.colorBgContainer
            }}
          >
            <div style={{ fontSize: 12, marginBottom: 6, color: token.colorTextSecondary }}>{value.date()}</div>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {visible.map((entry) => renderEntry(entry, { compact: true, showTime: true, showMode: true }))}
              {entries.length > visible.length ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, paddingLeft: 2 }}>
                  +{entries.length - visible.length} more
                </Typography.Text>
              ) : null}
            </Space>
          </div>
        );
      }}
    />
  );

  const renderGridView = (days: Dayjs[]) => {
    return (
      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          background: token.colorBgContainer
        }}
      >
        <table style={{ width: "100%", minWidth: days.length > 1 ? 980 : 560, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th
                style={{
                  width: 74,
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  padding: "10px 8px",
                  textAlign: "right",
                  background: token.colorBgContainer
                }}
              />
              {days.map((day) => (
                <th
                  key={day.toISOString()}
                  style={{
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    borderLeft: `1px solid ${token.colorBorderSecondary}`,
                    padding: "8px 10px",
                    textAlign: "left",
                    background: day.isSame(dayjs(), "day") ? token.colorBgTextHover : token.colorBgContainer
                  }}
                >
                  <Typography.Text strong style={{ fontSize: 12 }}>
                    {day.format("ddd")}
                  </Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {day.format("MMM D")}
                  </Typography.Text>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td
                  style={{
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    padding: "8px 8px 0 8px",
                    color: token.colorTextSecondary,
                    fontSize: 11,
                    verticalAlign: "top",
                    textAlign: "right",
                    letterSpacing: 0.3
                  }}
                >
                  {dayjs().hour(hour).minute(0).format("HH:mm")}
                </td>
                {days.map((day) => {
                  const slotEntries = scheduledTasks.filter(
                    (entry) => entry.start.isSame(day, "day") && entry.start.hour() === hour
                  );
                  const visible = slotEntries.slice(0, 2);
                  return (
                    <td
                      key={`${day.toISOString()}-${hour}`}
                      style={{
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        borderLeft: `1px solid ${token.colorBorderSecondary}`,
                        verticalAlign: "top",
                        padding: 4,
                        minHeight: 56,
                        height: 56,
                        background: slotEntries.some((entry) => entry.task.id === selectedTaskId) ? token.colorPrimaryBg : token.colorBgContainer
                      }}
                    >
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        {visible.map((entry) => renderEntry(entry, { compact: true, showTime: false, showMode: true }))}
                        {slotEntries.length > visible.length ? (
                          <Typography.Text type="secondary" style={{ fontSize: 10, paddingLeft: 2 }}>
                            +{slotEntries.length - visible.length} more
                          </Typography.Text>
                        ) : null}
                      </Space>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const selectedCard = selectedEntry ? (
    <Card
      bordered
      style={{
        borderColor: token.colorBorderSecondary,
        borderRadius: 12,
        background: token.colorBgContainer,
        width: isWide ? 300 : "100%"
      }}
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.3 }}>
          Selected Task
        </Typography.Text>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {selectedEntry.task.title}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatWindowWithDate(selectedEntry)}
        </Typography.Text>
        <Tag color={getStartModeTagColor(resolveStartMode(selectedEntry.task))} style={{ width: "fit-content" }}>
          {getTaskStartModeLabel(resolveStartMode(selectedEntry.task))}
        </Tag>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} ellipsis={{ rows: 4 }}>
          {selectedEntry.task.executionSummary}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" onClick={() => openScheduledTask(selectedEntry.task.id)}>
            Open Task
          </Button>
          <Button onClick={() => setSelectedTaskId(null)}>Clear</Button>
        </Space>
      </Space>
    </Card>
  ) : (
    <Card
      bordered
      style={{
        borderColor: token.colorBorderSecondary,
        borderRadius: 12,
        background: token.colorBgContainer,
        width: isWide ? 300 : "100%"
      }}
    >
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a task to preview details." />
    </Card>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex align="center" justify="space-between" gap={12} wrap="wrap">
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Scheduler
          </Typography.Title>
          <Typography.Text type="secondary">Plan tasks on a calendar, then start them when you are ready.</Typography.Text>
        </Flex>
        {canCreateTask ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            Schedule Task
          </Button>
        ) : null}
      </Flex>

      <Card
        bordered
        style={{ borderRadius: 14, borderColor: token.colorBorderSecondary, background: token.colorBgLayout }}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
            <Space>
              <Button onClick={() => jumpWindow(-1)}>{"<"}</Button>
              <Button onClick={() => setAnchorDate(dayjs())}>Today</Button>
              <Button onClick={() => jumpWindow(1)}>{">"}</Button>
            </Space>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {dayLabel}
            </Typography.Text>
            <Segmented<CalendarView>
              options={[
                { label: "Month", value: "month" },
                { label: "Week", value: "week" },
                { label: "Day", value: "day" }
              ]}
              value={view}
              onChange={(value) => setView(value)}
            />
          </Flex>

          {visibleStartModes.length > 0 ? (
            <Flex align="center" gap={8} wrap="wrap">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Start modes:
              </Typography.Text>
              {visibleStartModes.map((mode) => (
                <Tag key={mode} color={getStartModeTagColor(mode)}>
                  {getTaskStartModeLabel(mode)}
                </Tag>
              ))}
            </Flex>
          ) : null}

          {loading ? (
            <Flex justify="center" style={{ padding: "48px 0" }}>
              <Spin />
            </Flex>
          ) : scheduledTasks.length === 0 ? (
            <Card
              bordered
              style={{ borderColor: token.colorBorderSecondary, borderRadius: 12, background: token.colorBgContainer }}
            >
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No scheduled tasks yet." />
            </Card>
          ) : (
            <Flex gap={16} vertical={!isWide} align="stretch">
              <div style={{ flex: 1, minWidth: 0 }}>
                {view === "month" ? renderMonthView() : view === "week" ? renderGridView(weekDays) : renderGridView([anchorDate.startOf("day")])}
              </div>
              {selectedCard}
            </Flex>
          )}
        </Space>
      </Card>

      <TaskCreateModal open={createOpen} onClose={() => setCreateOpen(false)} schedulerMode />
    </Space>
  );
}
