"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskDefinitionInput, TaskSourceType, TaskType } from "@agentswarm/shared-types";
import { Button, Flex, Form, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";
import {
  TaskDefinitionFields,
  type TaskDefinitionFormValues,
  getTaskDefinitionInitialValues,
  stripSaveAsPreset
} from "./task-definition-fields";

export function TaskCreatePage() {
  const router = useRouter();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";

  const pageTitle =
    selectedSourceType === "issue"
      ? "New Task From Issue"
      : selectedSourceType === "pull_request"
        ? "New Task From Pull Request"
        : selectedTaskType === "ask"
          ? "New Ask Task"
          : "New Build Task";

  const createTaskFromDefinition = (definition: TaskDefinitionInput) => {
    if (definition.sourceType === "issue") {
      return api.createTaskFromIssue({
        repoId: definition.repoId,
        issueNumber: definition.issueNumber,
        includeComments: definition.includeComments,
        taskType: definition.taskType,
        title: definition.title,
        provider: definition.provider,
        providerProfile: definition.providerProfile,
        modelOverride: definition.model || undefined,
        baseBranch: definition.baseBranch,
        branchStrategy: definition.branchStrategy
      });
    }

    if (definition.sourceType === "pull_request") {
      return api.createTaskFromPullRequest({
        repoId: definition.repoId,
        pullRequestNumber: definition.pullRequestNumber,
        title: definition.title,
        provider: definition.provider,
        providerProfile: definition.providerProfile,
        modelOverride: definition.model || undefined,
        // queue mode has been removed; tasks start with the initial action only
      });
    }

    return api.createTask({
      title: definition.title,
      repoId: definition.repoId,
      prompt: definition.prompt,
      taskType: definition.taskType,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy
    });
  };

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    setSubmitting(true);
    try {
      const definition = stripSaveAsPreset(values);
      const task = await createTaskFromDefinition(definition);

      messageApi.success(
        task.taskType === "ask" ? "Ask task created and started" : "Build task created and build started"
      );
      if (values.saveAsPreset) {
        try {
          await api.createPreset(definition);
          messageApi.success("Preset saved");
        } catch (error) {
          messageApi.warning(
            error instanceof Error ? `Task created, but preset was not saved: ${error.message}` : "Task created, but preset was not saved"
          );
        }
      }
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
              <Button type="primary" htmlType="submit" loading={submitting}>
                {isIssueSource ? "Create Task From Issue" : isPullRequestSource ? "Create Task From Pull Request" : "Create Task"}
              </Button>
            </Space>
          </Flex>

          <TaskDefinitionFields form={form} showSaveAsPreset={can("preset:create")} />
        </Flex>
      </Form>
    </>
  );
}
