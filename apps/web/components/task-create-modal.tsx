"use client";

import { useEffect, useState } from "react";
import type { Task, TaskDraft, TaskSourceType } from "@agentswarm/shared-types";
import { App, Button, Form, Modal } from "antd";
import { api } from "../src/api/client";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import { buildTaskDraftDefinition, formValuesFromTaskDraft, promptImageFilesFromTaskDraft } from "../src/utils/task-drafts";
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
  draft?: TaskDraft | null;
  onCreated?: (task: Task) => void;
  onDraftCreated?: (draft: TaskDraft) => void;
  onDraftUpdated?: (draft: TaskDraft) => void;
  onDraftDeleted?: (draftId: string) => void;
}

export function TaskCreateModal({ open, onClose, draft, onCreated, onDraftCreated, onDraftUpdated, onDraftDeleted }: TaskCreateModalProps) {
  const { message } = App.useApp();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask");
  const isEditingDraft = Boolean(draft);
  const busy = submitting || savingDraft || deletingDraft;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.resetFields();
    if (draft) {
      form.setFieldsValue(formValuesFromTaskDraft(draft));
      setPromptImageFiles(promptImageFilesFromTaskDraft(draft));
      return;
    }

    form.setFieldsValue(getTaskDefinitionInitialValues(undefined));
    setPromptImageFiles([]);
  }, [draft, form, open]);

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
          if (draft) {
            await api.deleteTaskDraft(draft.id).catch(() => undefined);
            onDraftDeleted?.(draft.id);
          }
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
    const values = form.getFieldsValue(true) as TaskDefinitionFormValues;
    setSavingDraft(true);
    try {
      const definition = await buildTaskDraftDefinition(values, promptImageFiles);
      const title = values.title?.trim() || definition.prompt?.trim().split(/\r?\n/u)[0]?.slice(0, 120) || "Untitled Draft";
      const savedDraft = draft
        ? await api.updateTaskDraft(draft.id, {
            title,
            definition
          })
        : await api.createTaskDraft({
            title,
            definition
          });
      form.resetFields();
      setPromptImageFiles([]);
      onClose();
      if (draft) {
        onDraftUpdated?.(savedDraft);
      } else {
        onDraftCreated?.(savedDraft);
      }
      message.success("Draft saved");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!draft) {
      return;
    }

    setDeletingDraft(true);
    try {
      await api.deleteTaskDraft(draft.id);
      form.resetFields();
      setPromptImageFiles([]);
      onClose();
      onDraftDeleted?.(draft.id);
      message.success("Draft deleted");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to delete draft");
    } finally {
      setDeletingDraft(false);
    }
  };

  const footer = [
    <Button key="cancel" onClick={handleCancel} disabled={busy}>
      Cancel
    </Button>,
    ...(isEditingDraft
      ? [
          <Button key="delete" danger loading={deletingDraft} disabled={submitting || savingDraft} onClick={() => void handleDeleteDraft()}>
            Delete Draft
          </Button>
        ]
      : []),
    <Button key="draft" loading={savingDraft} disabled={submitting || deletingDraft} onClick={() => void handleSaveDraft()}>
      Save Draft
    </Button>,
    <Button
      key="submit"
      type="primary"
      loading={submitting}
      disabled={!canCreateAnyTaskMode || savingDraft || deletingDraft}
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
      title={isEditingDraft ? "Edit Draft" : "New Task"}
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
