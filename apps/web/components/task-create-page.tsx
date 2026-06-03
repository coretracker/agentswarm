"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskSourceType, TaskType } from "@agentswarm/shared-types";
import { Button, Flex, Form, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import { buildTaskDraftDefinition } from "../src/utils/task-drafts";
import { trackEvent } from "../src/utils/analytics";
import { encodeTaskPromptImageFiles, type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
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
  const [savingDraft, setSavingDraft] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask");

  const pageTitle =
    selectedSourceType === "issue"
      ? "New Task From Issue"
      : selectedSourceType === "pull_request"
        ? "New Task From Pull Request"
        : selectedTaskType === "ask"
            ? "New Ask Task"
            : "New Build Task";

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    setSubmitting(true);
    try {
      const encodedAttachments = await encodeTaskPromptImageFiles(promptImageFiles);
      const definition = buildTaskDefinitionInput(values, encodedAttachments);
      trackEvent("task_create_submitted", { source: definition.sourceType });
      const task = await createTaskFromDefinition(definition);

      messageApi.success(startMessageForDefinition(definition));
      setPromptImageFiles([]);
      router.push(`/tasks/${task.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    const values = form.getFieldsValue(true) as TaskDefinitionFormValues;
    setSavingDraft(true);
    try {
      const definition = await buildTaskDraftDefinition(values, promptImageFiles);
      const draft = await api.createTaskDraft({
        title: values.title?.trim() || definition.prompt?.trim().split(/\r?\n/u)[0]?.slice(0, 120) || "Untitled Draft",
        definition
      });
      messageApi.success("Draft saved");
      router.push(`/tasks/drafts/${draft.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
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
              <Button loading={savingDraft} onClick={() => void handleSaveDraft()}>
                Save Draft
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting} disabled={!canCreateAnyTaskMode}>
                {isIssueSource ? "Create Task From Issue" : isPullRequestSource ? "Create Task From Pull Request" : "Create Task"}
              </Button>
            </Space>
          </Flex>

          <TaskDefinitionFields form={form} promptImageFiles={promptImageFiles} onPromptImageFilesChange={setPromptImageFiles} />
        </Flex>
      </Form>
    </>
  );
}
