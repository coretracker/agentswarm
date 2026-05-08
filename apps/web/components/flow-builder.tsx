"use client";

import { useMemo } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Card, Flex, Form, Input, Select, Space, Typography, message } from "antd";

export type FlowNodeData = Record<string, unknown> & {
  kind: "start" | "agent" | "end";
  label: string;
  prompt: string;
  provider: "codex" | "claude";
  model: string;
  complexity: "low" | "medium" | "high";
};

export interface FlowGraphDefinition {
  nodes: Array<Node<FlowNodeData>>;
  edges: Edge[];
}

const DEFAULT_NODE_DATA: FlowNodeData = {
  kind: "agent",
  label: "Agent Node",
  prompt: "",
  provider: "codex",
  model: "gpt-5.4",
  complexity: "medium"
};

const createNode = (index: number, kind: FlowNodeData["kind"] = "agent"): Node<FlowNodeData> => ({
  id: `node-${Date.now()}-${index}`,
  position: { x: 80 + (index % 3) * 240, y: 80 + Math.floor(index / 3) * 160 },
  data: {
    ...DEFAULT_NODE_DATA,
    kind,
    label: kind === "start" ? "Start" : kind === "end" ? "End" : `Agent ${index + 1}`,
    prompt: kind === "agent" ? "" : `Flow ${kind} node`
  }
});

interface FlowBuilderProps {
  value: FlowGraphDefinition;
  onChange: (next: FlowGraphDefinition) => void;
}

function FlowBuilderInner({ value, onChange }: FlowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(value.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(value.edges);
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<FlowNodeData>();

  const selectedNode = useMemo(() => nodes.find((node) => node.selected), [nodes]);

  const commit = (nextNodes: Array<Node<FlowNodeData>>, nextEdges: Edge[]) => {
    onChange({ nodes: nextNodes, edges: nextEdges });
  };

  const addNode = (kind: FlowNodeData["kind"]) => {
    const nextNodes = [...nodes, createNode(nodes.length, kind)];
    setNodes(nextNodes);
    commit(nextNodes, edges);
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) {
      return;
    }
    const nextNodes = nodes.filter((node) => node.id !== selectedNode.id);
    const nextEdges = edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
    setNodes(nextNodes);
    setEdges(nextEdges);
    commit(nextNodes, nextEdges);
  };

  const onConnect = (connection: Connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) {
      messageApi.error("Connection references a missing node.");
      return;
    }
    if (sourceNode.data.kind === "end") {
      messageApi.warning("End nodes cannot have outgoing connections.");
      return;
    }
    if (targetNode.data.kind === "start") {
      messageApi.warning("Start nodes cannot have incoming connections.");
      return;
    }
    if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
      messageApi.info("This connection already exists.");
      return;
    }
    const nextEdges = addEdge(connection, edges);
    setEdges(nextEdges);
    commit(nodes, nextEdges);
  };

  const syncNodeField = (patch: Partial<FlowNodeData>) => {
    if (!selectedNode) {
      return;
    }
    const nextNodes = nodes.map((node) => (node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node));
    setNodes(nextNodes);
    commit(nextNodes, edges);
  };

  return (
    <>
      {contextHolder}
      <Flex gap={12} style={{ height: 520 }}>
        <Card size="small" style={{ flex: 1, minWidth: 0 }}>
        <Flex justify="space-between" style={{ marginBottom: 8 }}>
          <Space>
            <Button onClick={() => addNode("start")} disabled={nodes.some((node) => node.data.kind === "start")}>
              Add Start
            </Button>
            <Button onClick={() => addNode("agent")}>Add Agent</Button>
            <Button onClick={() => addNode("end")} disabled={nodes.some((node) => node.data.kind === "end")}>
              Add End
            </Button>
            <Button danger onClick={deleteSelectedNode} disabled={!selectedNode}>
              Delete Selected
            </Button>
          </Space>
          <Typography.Text type="secondary">
            {nodes.length} nodes · {edges.length} edges
          </Typography.Text>
        </Flex>
        <div style={{ width: "100%", height: 450 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              const nextNodes = nodes.map((node) => {
                const change = changes.find((item) => item.type === "position" && item.id === node.id);
                if (!change || !("position" in change) || !change.position) {
                  return node;
                }
                return { ...node, position: change.position };
              });
              commit(nextNodes, edges);
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              const removedIds = new Set(changes.filter((item) => item.type === "remove").map((item) => item.id));
              if (removedIds.size === 0) {
                return;
              }
              const nextEdges = edges.filter((edge) => !removedIds.has(edge.id));
              commit(nodes, nextEdges);
            }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selected }) => {
              const node = selected[0];
              if (!node) {
                form.resetFields();
                return;
              }
              const typed = node as Node<FlowNodeData>;
              form.setFieldsValue(typed.data);
            }}
            fitView
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
        </Card>

        <Card size="small" title="Node Inspector" style={{ width: 320 }}>
          {selectedNode ? (
            <Form form={form} layout="vertical">
            <Form.Item label="Agent Name" name="label">
              <Input onChange={(event) => syncNodeField({ label: event.target.value })} />
            </Form.Item>
            <Form.Item label="Node Type" name="kind">
              <Select
                options={[
                  { label: "Start", value: "start" },
                  { label: "Agent", value: "agent" },
                  { label: "End", value: "end" }
                ]}
                onChange={(kind) => syncNodeField({ kind })}
              />
            </Form.Item>
            <Form.Item label="Prompt" name="prompt">
              <Input.TextArea rows={5} onChange={(event) => syncNodeField({ prompt: event.target.value })} />
            </Form.Item>
            <Form.Item label="Provider" name="provider">
              <Select
                options={[
                  { label: "Codex", value: "codex" },
                  { label: "Claude", value: "claude" }
                ]}
                onChange={(provider) => syncNodeField({ provider })}
              />
            </Form.Item>
            <Form.Item label="Model" name="model">
              <Input onChange={(event) => syncNodeField({ model: event.target.value })} />
            </Form.Item>
            <Form.Item label="Complexity" name="complexity">
              <Select
                options={[
                  { label: "Low", value: "low" },
                  { label: "Medium", value: "medium" },
                  { label: "High", value: "high" }
                ]}
                onChange={(complexity) => syncNodeField({ complexity })}
              />
            </Form.Item>
            </Form>
          ) : (
            <Typography.Text type="secondary">Select a node to edit its settings.</Typography.Text>
          )}
        </Card>
      </Flex>
    </>
  );
}

export function FlowBuilder(props: FlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner {...props} />
    </ReactFlowProvider>
  );
}
