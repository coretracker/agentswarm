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
      id: "node-start",
      position: { x: 80, y: 160 },
      data: {
        kind: "start",
        label: "Start",
        prompt: "Flow start node",
        provider: "codex",
        model: "gpt-5.4",
        complexity: "medium"
      }
    },
    {
      id: "node-agent-1",
      position: { x: 320, y: 160 },
      data: {
        kind: "agent",
        label: "Agent 1",
        prompt: "",
        provider: "codex",
        model: "gpt-5.4",
        complexity: "medium"
      }
    },
    {
      id: "node-end",
      position: { x: 560, y: 160 },
      data: {
        kind: "end",
        label: "End",
        prompt: "Flow end node",
        provider: "codex",
        model: "gpt-5.4",
        complexity: "medium"
      }
    }
  ],
  edges: [
    { id: "edge-start-agent", source: "node-start", target: "node-agent-1" },
    { id: "edge-agent-end", source: "node-agent-1", target: "node-end" }
  ]
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
        const kind: FlowNodeData["kind"] = data?.kind === "start" || data?.kind === "end" ? data.kind : "agent";
        const provider: FlowNodeData["provider"] = data?.provider === "claude" ? "claude" : "codex";
        const complexity: FlowNodeData["complexity"] =
          data?.complexity === "low" || data?.complexity === "high" ? data.complexity : "medium";
        return {
          ...node,
          data: {
            label: data?.label ?? `Agent ${index + 1}`,
            prompt: data?.prompt ?? "",
            kind,
            provider,
            model: data?.model ?? "gpt-5.4",
            complexity
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

const validateFlowDefinition = (definition: FlowGraphDefinition): string | null => {
  if (definition.nodes.length === 0) {
    return "Flow must contain at least one node.";
  }

  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const startNodes = definition.nodes.filter((node) => node.data.kind === "start");
  const endNodes = definition.nodes.filter((node) => node.data.kind === "end");
  const agentNodes = definition.nodes.filter((node) => node.data.kind === "agent");

  if (startNodes.length !== 1) {
    return "Flow must contain exactly one Start node.";
  }

  if (endNodes.length !== 1) {
    return "Flow must contain exactly one End node.";
  }

  if (agentNodes.length === 0) {
    return "Flow must contain at least one Agent node.";
  }

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return "All edges must reference existing nodes.";
    }
    if (edge.source === edge.target) {
      return "Self-loop edges are not allowed in v1.";
    }
  }

  const startId = startNodes[0]?.id;
  const endId = endNodes[0]?.id;
  if (!startId || !endId) {
    return "Flow must contain Start and End nodes.";
  }

  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of definition.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  if (!visited.has(endId)) {
    return "End node must be reachable from Start node.";
  }

  const unreachableAgents = agentNodes.filter((node) => !visited.has(node.id));
  if (unreachableAgents.length > 0) {
    return "All Agent nodes must be reachable from Start.";
  }

  return null;
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
              const parsed = parseFlowDefinition(definitionJson);
              const validationError = validateFlowDefinition(parsed);
              if (validationError) {
                throw new Error(validationError);
              }
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
            <>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                Guardrails: Start has no incoming edges, End has no outgoing edges.
              </Typography.Text>
              <FlowBuilder
                value={graphDefinition}
                onChange={(next) => {
                  setGraphDefinition(next);
                  form.setFieldValue("definitionJson", JSON.stringify(next, null, 2));
                }}
              />
            </>
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
