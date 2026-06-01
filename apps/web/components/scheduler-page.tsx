"use client";

import { useMemo, useState } from "react";
import { type Task } from "@agentswarm/shared-types";
import { Button, Calendar, Card, Empty, Flex, Segmented, Space, Spin, Typography, theme as antTheme } from "antd";
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

function formatWindow(entry: ScheduledTaskEntry): string {
  return `${entry.start.format("HH:mm")} - ${entry.end.format("HH:mm")}`;
}

function isOnCalendarDay(entry: ScheduledTaskEntry, date: Dayjs): boolean {
  const dayStart = date.startOf("day");
  const dayEnd = date.endOf("day");
  return entry.start.isBefore(dayEnd) && entry.end.isAfter(dayStart);
}

export function SchedulerPage() {
  const router = useRouter();
  const { token } = antTheme.useToken();
  const { can } = useAuth();
  const canCreateTask = can("task:create") && (can("task:build") || can("task:ask"));
  const canEditTask = can("task:edit");
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(dayjs());
  const { tasks, loading } = useTasks({ view: "scheduled" });

  const scheduledTasks = useMemo(() => parseScheduledTasks(tasks), [tasks]);

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

  const renderMonthView = () => (
    <Calendar
      fullscreen={false}
      value={anchorDate}
      onSelect={(value) => setAnchorDate(value)}
      fullCellRender={(value) => {
        const entries = scheduledTasks.filter((entry) => isOnCalendarDay(entry, value));
        const visible = entries.slice(0, 3);

        return (
          <div style={{ minHeight: 84, padding: 4 }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: token.colorTextSecondary }}>{value.date()}</div>
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              {visible.map((entry) => (
                <Button
                  key={entry.task.id}
                  type="text"
                  size="small"
                  style={{
                    justifyContent: "flex-start",
                    width: "100%",
                    height: "auto",
                    padding: "0 4px",
                    borderRadius: 4,
                    background: token.colorPrimaryBg,
                    border: `1px solid ${token.colorPrimaryBorder}`,
                    overflow: "hidden"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    openScheduledTask(entry.task.id);
                  }}
                  title={`${entry.task.title} (${formatWindow(entry)})`}
                >
                  <span style={{ display: "block", fontSize: 11, textAlign: "left", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                    {entry.start.format("HH:mm")} {entry.task.title}
                  </span>
                </Button>
              ))}
              {entries.length > visible.length ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, paddingLeft: 4 }}>
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
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: days.length > 1 ? 980 : 520, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ width: 92, borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: 8, textAlign: "left" }} />
              {days.map((day) => (
                <th
                  key={day.toISOString()}
                  style={{
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    borderLeft: `1px solid ${token.colorBorderSecondary}`,
                    padding: 8,
                    textAlign: "left",
                    background: day.isSame(dayjs(), "day") ? token.colorPrimaryBg : token.colorBgContainer
                  }}
                >
                  <Typography.Text strong>{day.format("ddd")}</Typography.Text>
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
                    padding: "6px 8px",
                    color: token.colorTextSecondary,
                    fontSize: 12,
                    verticalAlign: "top"
                  }}
                >
                  {dayjs().hour(hour).minute(0).format("HH:mm")}
                </td>
                {days.map((day) => {
                  const slotEntries = scheduledTasks.filter(
                    (entry) => entry.start.isSame(day, "day") && entry.start.hour() === hour
                  );
                  return (
                    <td
                      key={`${day.toISOString()}-${hour}`}
                      style={{
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        borderLeft: `1px solid ${token.colorBorderSecondary}`,
                        verticalAlign: "top",
                        padding: 4,
                        minHeight: 52,
                        height: 52
                      }}
                    >
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        {slotEntries.map((entry) => (
                          <Button
                            key={entry.task.id}
                            type="text"
                            size="small"
                            style={{
                              justifyContent: "flex-start",
                              width: "100%",
                              height: "auto",
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: token.colorPrimaryBg,
                              border: `1px solid ${token.colorPrimaryBorder}`,
                              overflow: "hidden"
                            }}
                            onClick={() => openScheduledTask(entry.task.id)}
                            title={`${entry.task.title} (${formatWindow(entry)})`}
                          >
                            <span style={{ display: "block", textAlign: "left", fontSize: 11, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                              {entry.task.title}
                            </span>
                          </Button>
                        ))}
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex align="center" justify="space-between" gap={12} wrap="wrap">
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Scheduler
          </Typography.Title>
          <Typography.Text type="secondary">
            Plan tasks on a calendar, edit planned work, and start when ready.
          </Typography.Text>
        </Flex>
        {canCreateTask ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            Schedule Task
          </Button>
        ) : null}
      </Flex>

      <Card bordered={false}>
        <Flex align="center" justify="space-between" wrap="wrap" gap={12} style={{ marginBottom: 12 }}>
          <Space>
            <Button onClick={() => jumpWindow(-1)}>Previous</Button>
            <Button onClick={() => setAnchorDate(dayjs())}>Today</Button>
            <Button onClick={() => jumpWindow(1)}>Next</Button>
          </Space>
          <Typography.Text strong>{dayLabel}</Typography.Text>
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

        {loading ? (
          <Flex justify="center" style={{ padding: "48px 0" }}>
            <Spin />
          </Flex>
        ) : scheduledTasks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No scheduled tasks yet."
          />
        ) : view === "month" ? (
          renderMonthView()
        ) : view === "week" ? (
          renderGridView(weekDays)
        ) : (
          renderGridView([anchorDate.startOf("day")])
        )}
      </Card>

      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        schedulerMode
      />
    </Space>
  );
}
