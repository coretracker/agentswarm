"use client";

import { useState } from "react";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import type { Preset } from "@agentswarm/shared-types";
import { Button, Card, Flex, Form, Modal, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { usePresets } from "../src/hooks/usePresets";
import { useAuth } from "./auth-provider";
import {
  TaskDefinitionFields,
  type TaskDefinitionFormValues,
  getTaskDefinitionInitialValues,
  stripSaveAsPreset
} from "./task-definition-fields";

const sourceTypeLabel: Record<Preset["sourceType"], string> = {
  blank: "Blank",
  issue: "Issue",
  pull_request: "Pull Request"
};

export function PresetsPage() {
  const router = useRouter();
  const { presets, loading } = usePresets();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [spawningId, setSpawningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreatePreset = can("preset:create") && can("repo:list") && can("repo:read");
  const canEditPreset = can("preset:edit") && can("repo:list") && can("repo:read");
  const canDeletePreset = can("preset:delete");
  const canSpawnPreset = can("preset:read") && can("task:create");

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(getTaskDefinitionInitialValues());
    setOpen(true);
  };

  const openEdit = (preset: Preset) => {
    setEditing(preset);
    form.setFieldsValue(preset.definition);
    setOpen(true);
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Presets
            </Typography.Title>
            <Typography.Text type="secondary">
              Store reusable task definitions and spawn them into fresh tasks whenever you need them.
            </Typography.Text>
          </Flex>
          {canCreatePreset ? (
            <Button type="primary" onClick={openCreate}>
              Add Preset
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Table<Preset>
            rowKey="id"
            loading={loading}
            dataSource={presets}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "Name",
                dataIndex: "name"
              },
              {
                title: "Repository",
                dataIndex: "repoName"
              },
              {
                title: "Source",
                dataIndex: "sourceType",
                render: (value: Preset["sourceType"]) => sourceTypeLabel[value]
              },
              {
                title: "Updated At",
                dataIndex: "updatedAt",
                sorter: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
                defaultSortOrder: "descend",
                render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm")
              },
              {
                title: "Actions",
                key: "actions",
                width: 220,
                render: (_value, preset) => (
                  <Space>
                    {canSpawnPreset ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={spawningId === preset.id}
                        onClick={async () => {
                          setSpawningId(preset.id);
                          try {
                            const task = await api.spawnPreset(preset.id);
                            messageApi.success("Task created from preset");
                            router.push(`/tasks/${task.id}`);
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to spawn preset");
                          } finally {
                            setSpawningId(null);
                          }
                        }}
                      >
                        Spawn
                      </Button>
                    ) : null}
                    {canEditPreset ? (
                      <Button size="small" onClick={() => openEdit(preset)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDeletePreset ? (
                      <Popconfirm
                        title="Delete preset?"
                        description={`Delete "${preset.name}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingId === preset.id }}
                        onConfirm={async () => {
                          setDeletingId(preset.id);
                          try {
                            await api.deletePreset(preset.id);
                            messageApi.success("Preset deleted");
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to delete preset");
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                      >
                        <Button danger size="small">
                          Delete
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Space>

      <Modal
        open={open}
        title={editing ? "Edit Preset" : "Add Preset"}
        footer={null}
        width={1200}
        destroyOnClose
        onCancel={closeModal}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={getTaskDefinitionInitialValues()}
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              const input = stripSaveAsPreset(values);
              if (editing) {
                await api.updatePreset(editing.id, input);
                messageApi.success("Preset updated");
              } else {
                await api.createPreset(input);
                messageApi.success("Preset created");
              }
              closeModal();
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : "Failed to save preset");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {open ? <TaskDefinitionFields form={form} syncSettingsDefaults={!editing} /> : null}
          <Flex justify="flex-end" gap={12} style={{ marginTop: 24 }}>
            <Button onClick={closeModal}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {editing ? "Save Changes" : "Create Preset"}
            </Button>
          </Flex>
        </Form>
      </Modal>
    </>
  );
}
