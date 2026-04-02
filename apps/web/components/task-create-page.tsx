"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskDefinitionInput, TaskSourceType, TaskStartMode, TaskType } from "@agentswarm/shared-types";
import { Button, Flex, Form, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
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

  const startMessageForDefinition = (definition: TaskDefinitionInput): string => {
    if (definition.sourceType === "pull_request") {
      return "Pull request task created and started";
    }
    const mode: TaskStartMode = definition.startMode ?? "run_now";
    if (mode === "prepare_workspace") {
      return "Task created; preparing workspace in the background";
    }
    if (mode === "idle") {
      return "Task created; start a run from the task when you are ready";
    }
    if (definition.sourceType === "issue") {
      return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
    }
    return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
  };

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
        branchStrategy: definition.branchStrategy,
        startMode: definition.startMode ?? "run_now"
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
      startMode: definition.startMode ?? "run_now",
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
