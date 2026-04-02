"use client";

import { useState } from "react";
import type { Task, TaskSourceType } from "@agentswarm/shared-types";
import { App, Button, Form, Modal } from "antd";
import { createTaskFromDefinition, startMessageForDefinition } from "../src/utils/task-definition-submit";
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
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const canCreateAnyTaskMode = can("task:build") || can("task:ask") || can("task:interactive");

  const handleCancel = () => {
    if (submitting) {
      return;
    }

    form.resetFields();
    onClose();
  };

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    setSubmitting(true);
    try {
      const definition = buildTaskDefinitionInput(values);
      const task = await createTaskFromDefinition(definition);
      onCreated?.(task);
      message.success(startMessageForDefinition(definition));
      form.resetFields();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title="New Task"
      width={1180}
      destroyOnHidden
      maskClosable={!submitting}
      styles={{
        body: {
          maxHeight: "calc(100vh - 220px)",
          overflowY: "auto",
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
          {selectedSourceType === "issue"
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
        initialValues={getTaskDefinitionInitialValues()}
        onFinish={handleSubmit}
      >
        <TaskDefinitionFields form={form} />
      </Form>
    </Modal>
  );
}
