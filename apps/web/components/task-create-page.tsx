"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskSourceType, TaskStartMode, TaskType } from "@agentswarm/shared-types";
import { Button, Flex, Form, Space, Typography, message } from "antd";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import { useAuth } from "./auth-provider";
import {
  TaskDefinitionFields,
  type TaskDefinitionFormValues,
  buildTaskDefinitionInput,
  getTaskDefinitionInitialValues
} from "./task-definition-fields";

export function TaskCreatePage() {
  const router = useRouter();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const selectedStartMode = (Form.useWatch("startMode", form) as TaskStartMode | undefined) ?? "run_now";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const isBlankOrIssueInteractivePrep =
    (selectedSourceType === "blank" || selectedSourceType === "issue") && selectedStartMode === "prepare_workspace";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask") || can("task:interactive");

  const pageTitle =
    selectedSourceType === "issue"
      ? isBlankOrIssueInteractivePrep
        ? "New Interactive Task From Issue"
        : "New Task From Issue"
      : selectedSourceType === "pull_request"
        ? "New Task From Pull Request"
        : isBlankOrIssueInteractivePrep
          ? "New Interactive Task"
          : selectedTaskType === "ask"
            ? "New Ask Task"
            : "New Build Task";

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    setSubmitting(true);
    try {
      const definition = buildTaskDefinitionInput(values);
      const task = await createTaskFromDefinition(definition);

      messageApi.success(startMessageForDefinition(definition));
      router.push(`/tasks/${task.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        initialValues={getTaskDefinitionInitialValues()}
        onFinish={handleSubmit}
      >
        <Flex vertical gap={16}>
          <Flex align="center" justify="space-between" gap={16} wrap="wrap">
            <Flex vertical gap={0}>
              <Typography.Title level={2} style={{ margin: 0 }}>
                {pageTitle}
              </Typography.Title>
              <Typography.Text type="secondary">
                Configure the task on the left and write the prompt on the right.
              </Typography.Text>
            </Flex>
            <Space>
              <Button onClick={() => router.push("/tasks")}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting} disabled={!canCreateAnyTaskMode}>
                {isIssueSource ? "Create Task From Issue" : isPullRequestSource ? "Create Task From Pull Request" : "Create Task"}
              </Button>
            </Space>
          </Flex>

          <TaskDefinitionFields form={form} />
        </Flex>
      </Form>
    </>
  );
}
