"use client";

import { useEffect, useState } from "react";
import { getDefaultModelForProvider, type Task, type UpdateTaskDraftInput } from "@verft/shared-types";
import { App, Button, Form, Modal } from "antd";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
import { encodeTaskPromptImageFiles, type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { api } from "../src/api/client";
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
  onUpdated?: (task: Task) => void;
  draftTask?: Task | null;
}

const getDraftTaskInitialValues = (task: Task): Partial<TaskDefinitionFormValues> => ({
  title: task.title,
  repoId: task.repoId,
  prompt: task.prompt === "(No prompt provided.)" ? "" : task.prompt,
  taskType: task.taskType,
  provider: task.provider,
  model: task.modelOverride ?? getDefaultModelForProvider(task.provider),
  providerProfile: task.providerProfile,
  baseBranch: task.baseBranch,
  branchStrategy: task.branchStrategy,
});

const buildDraftUpdateInput = (values: TaskDefinitionFormValues): UpdateTaskDraftInput => ({
  title: values.title?.trim() ?? "",
  prompt: values.prompt?.trim() ?? "",
  taskType: values.taskType ?? "build",
  provider: values.provider ?? "codex",
  providerProfile: values.providerProfile ?? "high",
  modelOverride: values.model?.trim() || null,
  baseBranch: values.baseBranch?.trim() ?? "",
  branchStrategy: values.branchStrategy ?? "feature_branch"
});

export function TaskCreateModal({ open, onClose, onCreated, onUpdated, draftTask }: TaskCreateModalProps) {
  const { message } = App.useApp();
  const { can } = useAuth();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);
  const canCreateAnyTaskMode = can("task:build") || can("task:ask");
  const editingDraft = Boolean(draftTask);
  const busy = submitting || savingDraft;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.resetFields();
    form.setFieldsValue(draftTask ? getDraftTaskInitialValues(draftTask) : getTaskDefinitionInitialValues(undefined));
    setPromptImageFiles([]);
  }, [draftTask, form, open]);

  const handleCancel = () => {
    if (busy) {
      return;
    }

    form.resetFields();
    setPromptImageFiles([]);
    onClose();
  };

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    if (draftTask) {
      setSubmitting(true);
      try {
        const updatedTask = await api.updateTaskDraft(draftTask.id, buildDraftUpdateInput(values));
        form.resetFields();
        setPromptImageFiles([]);
        onClose();
        onUpdated?.(updatedTask);
        message.success("Draft updated");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "Failed to update draft");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const encodedAttachments = await encodeTaskPromptImageFiles(promptImageFiles);
      const definition = buildTaskDefinitionInput(values, encodedAttachments);

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
    ...(editingDraft
      ? []
      : [
          <Button key="draft" loading={savingDraft} disabled={submitting} onClick={() => void handleSaveDraft()}>
            Save Draft
          </Button>
        ]),
    <Button
      key="submit"
      type="primary"
      loading={submitting}
      disabled={!canCreateAnyTaskMode || savingDraft}
      onClick={() => form.submit()}
    >
      {editingDraft ? "Save Draft" : "Create Task"}
    </Button>
  ];

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={editingDraft ? "Edit Draft" : "New Task"}
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
        requiredMark={false}
        scrollToFirstError={{ focus: true }}
        initialValues={getTaskDefinitionInitialValues(undefined)}
        onFinish={handleSubmit}
      >
        <TaskDefinitionFields
          form={form}
          syncSettingsDefaults={!editingDraft}
          lockRepository={editingDraft}
          allowPromptAttachments={!editingDraft}
          showTeamSharing={!editingDraft}
          promptImageFiles={promptImageFiles}
          onPromptImageFilesChange={setPromptImageFiles}
        />
      </Form>
    </Modal>
  );
}
