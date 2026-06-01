"use client";

import { useState } from "react";
import type { Task, TaskSourceType } from "@agentswarm/shared-types";
import { App, Button, Form, Modal } from "antd";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import { useSnippets } from "../src/hooks/useSnippets";
import { trackEvent } from "../src/utils/analytics";
import { encodeTaskPromptImageFiles, type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { useAuth } from "./auth-provider";
import {
  TaskDefinitionFields,
  type TaskDefinitionFormValues,
  buildTaskDefinitionInput,
  getTaskDefinitionInitialValues
} from "./task-definition-fields";

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (task: Task) => void;
  schedulerMode?: boolean;
}

export function TaskCreateModal({ open, onClose, onCreated, schedulerMode = false }: TaskCreateModalProps) {
  const { message } = App.useApp();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask") || can("task:interactive");
  const canUseSnippets = can("snippet:list");
  const { snippets } = useSnippets(canUseSnippets);

  const handleCancel = () => {
    if (submitting) {
      return;
    }

    form.resetFields();
    setPromptImageFiles([]);
    onClose();
  };

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    setSubmitting(true);
    try {
      const encodedAttachments = await encodeTaskPromptImageFiles(promptImageFiles);
      const selectedSnippet = snippets.find((snippet) => snippet.id === values.snippetId) ?? null;
      const definition = buildTaskDefinitionInput(values, encodedAttachments, selectedSnippet?.content, selectedSnippet?.variables ?? []);
      trackEvent("task_create_submitted", { source: definition.sourceType });

      const creationPromise = schedulerMode
        ? (() => {
            if (!values.scheduledStartAt || !values.scheduledEndAt) {
              return Promise.reject(new Error("Select both start and end date/time."));
            }
            return createTaskFromDefinition(definition, {
              scheduledStartAt: values.scheduledStartAt.toISOString(),
              scheduledEndAt: values.scheduledEndAt.toISOString()
            });
          })()
        : createTaskFromDefinition(definition);
      form.resetFields();
      setPromptImageFiles([]);
      setSubmitting(false);
      onClose();

      void creationPromise
        .then((task) => {
          onCreated?.(task);
          message.success(schedulerMode ? "Task scheduled" : startMessageForDefinition(definition));
        })
        .catch((error) => {
          message.error(error instanceof Error ? error.message : "Failed to create task");
        });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to create task");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={schedulerMode ? "Schedule Task" : "New Task"}
      width="min(1180px, calc(100vw - 32px))"
      destroyOnHidden
      maskClosable={!submitting}
      styles={{
        body: {
          maxHeight: "calc(100vh - 220px)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingTop: 12
        }
      }}
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          disabled={!canCreateAnyTaskMode}
          onClick={() => form.submit()}
        >
          {schedulerMode
            ? "Schedule Task"
            : selectedSourceType === "issue"
              ? "Create Task From Issue"
              : selectedSourceType === "pull_request"
                ? "Create Task From Pull Request"
                : "Create Task"}
        </Button>
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={getTaskDefinitionInitialValues(undefined, { schedulerMode })}
        onFinish={handleSubmit}
      >
        <TaskDefinitionFields
          form={form}
          promptImageFiles={promptImageFiles}
          onPromptImageFilesChange={setPromptImageFiles}
          schedulerMode={schedulerMode}
        />
      </Form>
    </Modal>
  );
}
