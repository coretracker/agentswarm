"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FlowDefinition } from "@agentswarm/shared-types";
import { Button, Card, Flex, Form, Input, Popconfirm, Segmented, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { FlowBuilder, type FlowGraphDefinition, type FlowNodeData } from "./flow-builder";

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
  if (agentNodes.some((node) => !visited.has(node.id))) {
    return "All Agent nodes must be reachable from Start.";
  }

  return null;
};

interface FlowEditorPageProps {
  mode: "create" | "edit";
  flowId?: string;
}

export function FlowEditorPage({ mode, flowId }: FlowEditorPageProps) {
  const router = useRouter();
  const [form] = Form.useForm<FlowFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorMode, setEditorMode] = useState<"visual" | "json">("visual");
  const [graphDefinition, setGraphDefinition] = useState<FlowGraphDefinition>(EMPTY_FLOW_DEFINITION);
  const [flow, setFlow] = useState<FlowDefinition | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !flowId) {
      form.setFieldsValue({
        name: "",
        description: "",
        definitionJson: JSON.stringify(EMPTY_FLOW_DEFINITION, null, 2)
      });
      setGraphDefinition(EMPTY_FLOW_DEFINITION);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void api
      .getFlow(flowId)
      .then((item) => {
        if (!active) {
          return;
        }
        setFlow(item);
        form.setFieldsValue({
          name: item.name,
          description: item.description,
          definitionJson: item.definitionJson
        });
        setGraphDefinition(parseFlowDefinition(item.definitionJson));
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        messageApi.error(error instanceof Error ? error.message : "Failed to load flow");
        router.push("/flows");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [flowId, form, messageApi, mode, router]);

  const title = useMemo(() => {
    if (mode === "create") {
      return "New Flow";
    }
    return flow?.name ? `Flow: ${flow.name}` : "Edit Flow";
  }, [flow, mode]);

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            <Typography.Text type="secondary">
              Configure flow metadata and graph definition.
            </Typography.Text>
          </Flex>
          <Space>
            <Button onClick={() => router.push("/flows")}>Back</Button>
            {mode === "edit" && flowId ? (
              <Popconfirm
                title="Delete flow?"
                description="This action cannot be undone."
                okText="Delete"
                okButtonProps={{ danger: true, loading: deleting }}
                onConfirm={async () => {
                  setDeleting(true);
                  try {
                    await api.deleteFlow(flowId);
                    messageApi.success("Flow deleted");
                    router.push("/flows");
                  } catch (error) {
                    messageApi.error(error instanceof Error ? error.message : "Failed to delete flow");
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <Button danger>Delete</Button>
              </Popconfirm>
            ) : null}
            <Button
              type="primary"
              loading={saving}
              onClick={async () => {
                try {
                  const values = await form.validateFields();
                  setSaving(true);
                  const definitionJson =
                    editorMode === "visual" ? JSON.stringify(graphDefinition, null, 2) : values.definitionJson;
                  const parsed = parseFlowDefinition(definitionJson);
                  const validationError = validateFlowDefinition(parsed);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  if (mode === "edit" && flowId) {
                    await api.updateFlow(flowId, {
                      ...values,
                      definitionJson
                    });
                    messageApi.success("Flow updated");
                  } else {
                    const created = await api.createFlow({
                      ...values,
                      definitionJson
                    });
                    messageApi.success("Flow created");
                    router.replace(`/flows/${created.id}`);
                  }
                } catch (error) {
                  if (error && typeof error === "object" && "errorFields" in error) {
                    return;
                  }
                  messageApi.error(error instanceof Error ? error.message : "Failed to save flow");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {mode === "create" ? "Create Flow" : "Save Flow"}
            </Button>
          </Space>
        </Flex>

        <Card bordered={false} loading={loading}>
          <Form form={form} layout="vertical">
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
                onChange={(nextMode) => {
                  setEditorMode(nextMode);
                  if (nextMode === "json") {
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
                <Input.TextArea rows={20} placeholder='{"nodes":[],"edges":[]}' style={{ fontFamily: "monospace" }} />
              </Form.Item>
            )}
          </Form>
        </Card>
      </Space>
    </>
  );
}
