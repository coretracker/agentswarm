"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../src/api/client";
import { useTask } from "../src/hooks/useTask";
import { useAuth } from "./auth-provider";
import { Alert, Button, Card, DatePicker, Flex, Form, Input, Result, Skeleton, Space, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";

interface SchedulerTaskEditPageProps {
  taskId: string;
}

interface EditFormValues {
  title: string;
  prompt: string;
  notes?: string;
  scheduledStartAt: Dayjs;
  scheduledEndAt: Dayjs;
}

export function SchedulerTaskEditPage({ taskId }: SchedulerTaskEditPageProps) {
  const router = useRouter();
  const { can } = useAuth();
  const { task, setTask, loading, refetch } = useTask(taskId);
  const [form] = Form.useForm<EditFormValues>();
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canEditTask = can("task:edit");

  const redirectTarget = useMemo(() => (task ? `/tasks/${task.id}` : `/tasks/${taskId}`), [task, taskId]);

  useEffect(() => {
    if (!loading && task && task.status !== "scheduled") {
      router.replace(redirectTarget);
    }
  }, [loading, redirectTarget, router, task]);

  useEffect(() => {
    if (!task || task.status !== "scheduled" || !task.scheduledStartAt || !task.scheduledEndAt) {
      return;
    }

    const start = dayjs(task.scheduledStartAt);
    const end = dayjs(task.scheduledEndAt);
    if (!start.isValid() || !end.isValid()) {
      return;
    }

    form.setFieldsValue({
      title: task.title,
      prompt: task.prompt,
      notes: task.notes ?? "",
      scheduledStartAt: start,
      scheduledEndAt: end
    });
  }, [form, task]);

  const handleSave = async () => {
    if (!task) {
      return;
    }

    try {
      const values = await form.validateFields();
      setSaving(true);
      const updated = await api.updateTaskSchedule(task.id, {
        title: values.title.trim(),
        prompt: values.prompt.trim(),
        notes: values.notes?.trim() ?? "",
        scheduledStartAt: values.scheduledStartAt.toISOString(),
        scheduledEndAt: values.scheduledEndAt.toISOString()
      });
      setTask((current) => (current && current.id === updated.id ? { ...current, ...updated } : updated));
      messageApi.success("Scheduled task updated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refetch({ showLoading: false });
        router.replace(redirectTarget);
        return;
      }
      if (error && typeof error === "object" && "errorFields" in error) {
        return;
      }
      messageApi.error(error instanceof Error ? error.message : "Failed to update scheduled task");
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    if (!task) {
      return;
    }

    try {
      setRunningNow(true);
      await api.runScheduledTaskNow(task.id);
      messageApi.success("Task started");
      router.push(`/tasks/${task.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refetch({ showLoading: false });
        router.replace(redirectTarget);
        return;
      }
      messageApi.error(error instanceof Error ? error.message : "Failed to start task");
    } finally {
      setRunningNow(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  if (!task) {
    return <Result status="404" title="Task Not Found" subTitle="This task could not be loaded." />;
  }

  if (task.status !== "scheduled") {
    return <Skeleton active paragraph={{ rows: 4 }} />;
  }

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={12} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Edit Scheduled Task
            </Typography.Title>
            <Typography.Text type="secondary">Update timing or details before you start this task.</Typography.Text>
          </Flex>
          <Space>
            <Button onClick={() => router.push("/scheduler")}>Back to Scheduler</Button>
            <Button onClick={handleRunNow} loading={runningNow} disabled={!canEditTask || saving}>
              Run Task Now
            </Button>
            <Button type="primary" onClick={handleSave} loading={saving} disabled={!canEditTask || runningNow}>
              Save
            </Button>
          </Space>
        </Flex>

        {!canEditTask ? (
          <Alert
            type="info"
            showIcon
            message="Read-only access"
            description="This account can view scheduled tasks but cannot edit or start them."
          />
        ) : null}

        <Card bordered={false}>
          <Form form={form} layout="vertical" disabled={!canEditTask || saving || runningNow}>
            <Form.Item name="title" label="Title" rules={[{ required: true, message: "Enter a task title" }]}>
              <Input />
            </Form.Item>

            <Form.Item name="prompt" label="Prompt" rules={[{ required: true, message: "Enter a prompt" }]}>
              <Input.TextArea autoSize={{ minRows: 8, maxRows: 20 }} style={{ resize: "none" }} />
            </Form.Item>

            <Form.Item name="notes" label="Notes (Markdown)">
              <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} style={{ resize: "none" }} />
            </Form.Item>

            <Form.Item
              name="scheduledStartAt"
              label="Start Date & Time"
              rules={[
                { required: true, message: "Select a start date and time" },
                ({ getFieldValue }) => ({
                  validator(_rule, value: Dayjs | undefined) {
                    const end = getFieldValue("scheduledEndAt") as Dayjs | undefined;
                    if (!value || !end || value.isBefore(end)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("Start must be before end"));
                  }
                })
              ]}
            >
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              name="scheduledEndAt"
              label="End Date & Time"
              rules={[
                { required: true, message: "Select an end date and time" },
                ({ getFieldValue }) => ({
                  validator(_rule, value: Dayjs | undefined) {
                    const start = getFieldValue("scheduledStartAt") as Dayjs | undefined;
                    if (!value || !start || value.isAfter(start)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("End must be after start"));
                  }
                })
              ]}
            >
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </>
  );
}
