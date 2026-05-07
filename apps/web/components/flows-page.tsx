"use client";

import { useState } from "react";
import dayjs from "dayjs";
import type { FlowDefinition } from "@agentswarm/shared-types";
import { Button, Card, Flex, Form, Input, Modal, Popconfirm, Segmented, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { FlowBuilder, type FlowGraphDefinition, type FlowNodeData } from "./flow-builder";
import { useFlows } from "../src/hooks/useFlows";
import { useAuth } from "./auth-provider";

interface FlowFormValues {
  name: string;
  description: string;
  definitionJson: string;
}

const EMPTY_FLOW_DEFINITION: FlowGraphDefinition = {
  nodes: [
    {
      id: "node-1",
      position: { x: 120, y: 120 },
      data: {
        label: "Start Agent",
        prompt: "",
        provider: "codex",
        model: "gpt-5.4",
        complexity: "medium"
      }
    }
  ],
  edges: []
};

const parseFlowDefinition = (definitionJson: string): FlowGraphDefinition => {
  try {
    const parsed = JSON.parse(definitionJson) as Partial<FlowGraphDefinition>;
    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const nodes = rawNodes
      .filter((node): node is FlowGraphDefinition["nodes"][number] => {
        return (
          typeof node === "object" &&
          node !== null &&
          typeof node.id === "string" &&
          typeof node.position?.x === "number" &&
          typeof node.position?.y === "number"
        );
      })
      .map((node, index) => {
        const data = node.data as Partial<FlowNodeData> | undefined;
        return {
          ...node,
          data: {
            label: data?.label ?? `Agent ${index + 1}`,
            prompt: data?.prompt ?? "",
            provider: data?.provider === "claude" ? "claude" : "codex",
            model: data?.model ?? "gpt-5.4",
            complexity: data?.complexity === "low" || data?.complexity === "high" ? data.complexity : "medium"
          }
        };
      });
    const edges = rawEdges.filter(
      (edge): edge is FlowGraphDefinition["edges"][number] =>
        typeof edge === "object" && edge !== null && typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string"
    );
    if (nodes.length === 0) {
      return EMPTY_FLOW_DEFINITION;
    }
    return { nodes, edges };
  } catch {
    return EMPTY_FLOW_DEFINITION;
  }
};

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
  const [editorMode, setEditorMode] = useState<"visual" | "json">("visual");
  const [graphDefinition, setGraphDefinition] = useState<FlowGraphDefinition>(EMPTY_FLOW_DEFINITION);
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
    const json = JSON.stringify(EMPTY_FLOW_DEFINITION, null, 2);
    setGraphDefinition(EMPTY_FLOW_DEFINITION);
    setEditorMode("visual");
    form.setFieldsValue({ name: "", description: "", definitionJson: json });
    setOpen(true);
  };

  const openEdit = (flow: FlowDefinition) => {
    setEditing(flow);
    form.setFieldsValue({
      name: flow.name,
      description: flow.description,
      definitionJson: flow.definitionJson
    });
    setGraphDefinition(parseFlowDefinition(flow.definitionJson));
    setEditorMode("visual");
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
              const definitionJson =
                editorMode === "visual" ? JSON.stringify(graphDefinition, null, 2) : values.definitionJson;
              JSON.parse(definitionJson);
              if (editing) {
                await api.updateFlow(editing.id, {
                  ...values,
                  definitionJson
                });
                messageApi.success("Flow updated");
              } else {
                await api.createFlow({
                  ...values,
                  definitionJson
                });
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
          <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
            <Typography.Text strong>Definition</Typography.Text>
            <Segmented<"visual" | "json">
              value={editorMode}
              options={[
                { label: "Visual", value: "visual" },
                { label: "JSON", value: "json" }
              ]}
              onChange={(mode) => {
                setEditorMode(mode);
                if (mode === "json") {
                  form.setFieldValue("definitionJson", JSON.stringify(graphDefinition, null, 2));
                } else {
                  const json = form.getFieldValue("definitionJson") as string;
                  setGraphDefinition(parseFlowDefinition(json));
                }
              }}
            />
          </Flex>
          {editorMode === "visual" ? (
            <FlowBuilder
              value={graphDefinition}
              onChange={(next) => {
                setGraphDefinition(next);
                form.setFieldValue("definitionJson", JSON.stringify(next, null, 2));
              }}
            />
          ) : (
            <Form.Item
              name="definitionJson"
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
          )}
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
