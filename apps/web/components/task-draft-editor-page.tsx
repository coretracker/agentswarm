"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Form, Space, Spin, Typography, message } from "antd";
import { api } from "../src/api/client";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import {
  buildTaskDraftDefinition,
  formValuesFromTaskDraft,
  promptImageFilesFromTaskDraft
} from "../src/utils/task-drafts";
import { encodeTaskPromptImageFiles, type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import {
  TaskDefinitionFields,
  buildTaskDefinitionInput,
  getTaskDefinitionInitialValues,
  type TaskDefinitionFormValues
} from "./task-definition-fields";
import { useAuth } from "./auth-provider";

export function TaskDraftEditorPage({ draftId }: { draftId: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const canCreateAnyTaskMode = can("task:build") || can("task:ask");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .getTaskDraft(draftId)
      .then((draft) => {
        if (!active) {
          return;
        }
        form.setFieldsValue(formValuesFromTaskDraft(draft));
        setPromptImageFiles(promptImageFilesFromTaskDraft(draft));
        setLoading(false);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        messageApi.error(error instanceof Error ? error.message : "Failed to load draft");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [draftId, form, messageApi]);

  const saveDraft = async () => {
    const values = form.getFieldsValue(true) as TaskDefinitionFormValues;
    setSaving(true);
    try {
      const definition = await buildTaskDraftDefinition(values, promptImageFiles);
      await api.updateTaskDraft(draftId, {
        title: values.title?.trim() || definition.prompt?.trim().split(/\r?\n/u)[0]?.slice(0, 120) || "Untitled Draft",
        definition
      });
      messageApi.success("Draft saved");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  const createTask = async (values: TaskDefinitionFormValues) => {
    setCreating(true);
    try {
      const encodedAttachments = await encodeTaskPromptImageFiles(promptImageFiles);
      const definition = buildTaskDefinitionInput(values, encodedAttachments);
      const task = await createTaskFromDefinition(definition);
      await api.deleteTaskDraft(draftId).catch(() => undefined);
      messageApi.success(startMessageForDefinition(definition));
      router.push(`/tasks/${task.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const deleteDraft = async () => {
    setDeleting(true);
    try {
      await api.deleteTaskDraft(draftId);
      messageApi.success("Draft deleted");
      router.push("/tasks/board");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to delete draft");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Form form={form} layout="vertical" initialValues={getTaskDefinitionInitialValues()} onFinish={createTask}>
        <Flex vertical gap={16}>
          <Flex align="center" justify="space-between" gap={16} wrap="wrap">
            <Flex vertical gap={0}>
              <Typography.Title level={2} style={{ margin: 0 }}>
                Edit Draft
              </Typography.Title>
              <Typography.Text type="secondary">Plan the task before turning it into runnable agent work.</Typography.Text>
            </Flex>
            <Space>
              <Button onClick={() => router.push("/tasks/board")}>Back to Board</Button>
              <Button danger loading={deleting} onClick={() => void deleteDraft()}>
                Delete Draft
              </Button>
              <Button loading={saving} onClick={() => void saveDraft()}>
                Save Draft
              </Button>
              <Button type="primary" htmlType="submit" loading={creating} disabled={!canCreateAnyTaskMode}>
                Create Task
              </Button>
            </Space>
          </Flex>
          {loading ? (
            <Flex justify="center" style={{ padding: 80 }}>
              <Spin />
            </Flex>
          ) : (
            <TaskDefinitionFields form={form} promptImageFiles={promptImageFiles} onPromptImageFilesChange={setPromptImageFiles} />
          )}
        </Flex>
      </Form>
    </>
  );
}
