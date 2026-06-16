"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import type { Task } from "@agentswarm/shared-types";
import { App, Button, Form, Modal } from "antd";
import { api } from "../src/api/client";
import {
  TaskWorkspaceAttachmentsEditor,
  type TaskDefinitionFormValues
} from "./task-definition-fields";

interface TaskWorkspaceAttachmentsModalProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (task: Task) => void;
}

export function TaskWorkspaceAttachmentsModal({ task, open, onClose, onUpdated }: TaskWorkspaceAttachmentsModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !task) {
      return;
    }

    form.setFieldsValue({
      repoId: task.repoId,
      attachedRepositories: task.attachedRepositories.map((attachment) => ({
        repositoryId: attachment.repositoryId,
        mountName: attachment.mountName,
        accessMode: attachment.accessMode,
        purpose: attachment.purpose
      })),
      deadline: task.deadline ? dayjs(task.deadline) : null,
      title: task.title,
      prompt: task.prompt,
      notes: task.notes ?? "",
      taskType: task.taskType,
      provider: task.provider,
      model: task.modelOverride ?? undefined,
      providerProfile: task.providerProfile,
      codexCredentialSource: task.codexCredentialSource ?? "auto",
      baseBranch: task.baseBranch,
      branchStrategy: task.branchStrategy
    });
  }, [form, open, task]);

  const handleCancel = () => {
    if (saving) {
      return;
    }

    form.resetFields();
    onClose();
  };

  const handleSubmit = async () => {
    if (!task) {
      return;
    }

    setSaving(true);
    try {
      await form.validateFields();
      const values = form.getFieldsValue(true) as TaskDefinitionFormValues;
      const updatedTask = await api.updateTaskWorkspaceAttachments(task.id, {
        attachedRepositories: (values.attachedRepositories ?? []).map((attachment) => ({
          repositoryId: attachment.repositoryId,
          mountName: attachment.mountName,
          accessMode: "read-only" as const,
          purpose: attachment.purpose ?? null
        }))
      });
      onUpdated?.(updatedTask);
      form.resetFields();
      onClose();
      message.success("Attached repositories updated");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to update attached repositories");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Attached repositories"
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width="min(1180px, calc(100vw - 32px))"
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void handleSubmit()}>
          Save changes
        </Button>
      ]}
    >
      <Form form={form} layout="vertical">
        <TaskWorkspaceAttachmentsEditor form={form} rootRepositoryId={task?.repoId ?? null} />
      </Form>
    </Modal>
  );
}
