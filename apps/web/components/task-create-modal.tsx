"use client";

import { useEffect, useState } from "react";
import type { Task, TaskSourceType } from "@agentswarm/shared-types";
import { App, Button, Form, Modal } from "antd";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
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
}

export function TaskCreateModal({ open, onClose, onCreated }: TaskCreateModalProps) {
  const { message } = App.useApp();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask");
  const busy = submitting || savingDraft;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.resetFields();
    form.setFieldsValue(getTaskDefinitionInitialValues(undefined));
    setPromptImageFiles([]);
  }, [form, open]);

  const handleCancel = () => {
    if (busy) {
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
      const definition = buildTaskDefinitionInput(values, encodedAttachments);
      trackEvent("task_create_submitted", { source: definition.sourceType });

      const creationPromise = createTaskFromDefinition(definition);
      form.resetFields();
      setPromptImageFiles([]);
      setSubmitting(false);
      onClose();

      void creationPromise
        .then(async (task) => {
          onCreated?.(task);
          message.success(startMessageForDefinition(definition));
        })
        .catch((error) => {
          message.error(error instanceof Error ? error.message : "Failed to create task");
        });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to create task");
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const values = form.getFieldsValue(true) as TaskDefinitionFormValues;
      const encodedAttachments = await encodeTaskPromptImageFiles(promptImageFiles);
      const definition = buildTaskDefinitionInput(values, encodedAttachments);
      const savedDraft = await createTaskFromDefinition(definition, { draft: true });
      form.resetFields();
      setPromptImageFiles([]);
      onClose();
      onCreated?.(savedDraft);
      message.success("Draft saved");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const footer = [
    <Button key="cancel" onClick={handleCancel} disabled={busy}>
      Cancel
    </Button>,
    <Button key="draft" loading={savingDraft} disabled={submitting} onClick={() => void handleSaveDraft()}>
      Save Draft
    </Button>,
    <Button
      key="submit"
      type="primary"
      loading={submitting}
      disabled={!canCreateAnyTaskMode || savingDraft}
      onClick={() => form.submit()}
    >
      {selectedSourceType === "issue"
        ? "Create Task From Issue"
        : selectedSourceType === "pull_request"
          ? "Create Task From Pull Request"
          : "Create Task"}
    </Button>
  ];

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title="New Task"
      width="min(1180px, calc(100vw - 32px))"
      destroyOnHidden
      maskClosable={!busy}
      styles={{
        body: {
          maxHeight: "calc(100vh - 220px)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingTop: 12
        }
      }}
      footer={footer}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={getTaskDefinitionInitialValues(undefined)}
        onFinish={handleSubmit}
      >
        <TaskDefinitionFields form={form} promptImageFiles={promptImageFiles} onPromptImageFilesChange={setPromptImageFiles} />
      </Form>
    </Modal>
  );
}
