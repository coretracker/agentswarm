"use client";

import { useState } from "react";
import dayjs from "dayjs";
import type { FlowDefinition } from "@agentswarm/shared-types";
import { Button, Card, Flex, Form, Input, Modal, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useFlows } from "../src/hooks/useFlows";
import { useAuth } from "./auth-provider";

interface FlowFormValues {
  name: string;
  description: string;
  definitionJson: string;
}

const summarizeDefinition = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty";
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
};

export function FlowsPage() {
  const { flows, loading } = useFlows();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FlowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<FlowFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateFlow = can("flow:create");
  const canEditFlow = can("flow:edit");
  const canDeleteFlow = can("flow:delete");

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "", description: "", definitionJson: "{\n  \"nodes\": [],\n  \"edges\": []\n}" });
    setOpen(true);
  };

  const openEdit = (flow: FlowDefinition) => {
    setEditing(flow);
    form.setFieldsValue({
      name: flow.name,
      description: flow.description,
      definitionJson: flow.definitionJson
    });
    setOpen(true);
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Flows
            </Typography.Title>
            <Typography.Text type="secondary">
              Create and manage reusable flow definitions for flow-mode task execution.
            </Typography.Text>
          </Flex>
          {canCreateFlow ? (
            <Button type="primary" onClick={openCreate}>
              Add Flow
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Table<FlowDefinition>
            rowKey="id"
            loading={loading}
            dataSource={flows}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "Name",
                dataIndex: "name"
              },
              {
                title: "Description",
                dataIndex: "description",
                render: (value: string) => value || "No description"
              },
              {
                title: "Definition Preview",
                dataIndex: "definitionJson",
                render: (value: string) => summarizeDefinition(value)
              },
              {
                title: "Updated At",
                dataIndex: "updatedAt",
                sorter: (left, right) => left.updatedAt.localeCompare(right.updatedAt),
                defaultSortOrder: "descend",
                render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm")
              },
              {
                title: "Actions",
                key: "actions",
                width: 220,
                render: (_value, flow) => (
                  <Space wrap>
                    {canEditFlow ? (
                      <Button size="small" onClick={() => openEdit(flow)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDeleteFlow ? (
                      <Popconfirm
                        title="Delete flow?"
                        description={`Delete "${flow.name}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingId === flow.id }}
                        onConfirm={async () => {
                          setDeletingId(flow.id);
                          try {
                            await api.deleteFlow(flow.id);
                            messageApi.success("Flow deleted");
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to delete flow");
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
        title={editing ? "Edit Flow" : "Add Flow"}
        footer={null}
        onCancel={closeModal}
        destroyOnHidden
        width={800}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              JSON.parse(values.definitionJson);
              if (editing) {
                await api.updateFlow(editing.id, values);
                messageApi.success("Flow updated");
              } else {
                await api.createFlow(values);
                messageApi.success("Flow created");
              }
              closeModal();
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : "Failed to save flow");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a flow name" }]}>
            <Input placeholder="PR Implementation Flow" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Short description of when this flow should be used." />
          </Form.Item>
          <Form.Item
            name="definitionJson"
            label="Definition JSON"
            rules={[
              { required: true, message: "Enter flow definition JSON" },
              {
                validator: async (_rule, value: string) => {
                  try {
                    JSON.parse(value);
                  } catch {
                    throw new Error("Definition must be valid JSON");
                  }
                }
              }
            ]}
          >
            <Input.TextArea rows={16} placeholder='{"nodes":[],"edges":[]}' style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Flex justify="flex-end" gap={8} wrap="wrap">
            <Button onClick={closeModal}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {editing ? "Save Changes" : "Create Flow"}
            </Button>
          </Flex>
        </Form>
      </Modal>
    </>
  );
}
