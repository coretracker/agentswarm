"use client";

import { useMemo } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeProps,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Card, Flex, Input, Select, Space, Typography, message } from "antd";

export type FlowNodeData = Record<string, unknown> & {
  kind: "start" | "agent" | "end";
  label: string;
  prompt: string;
  provider: "codex" | "claude";
  model: string;
  complexity: "low" | "medium" | "high";
  onPatch?: (patch: Partial<FlowNodeData>) => void;
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

function FlowConfigNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const disabled = data.kind !== "agent";
  return (
    <div
      style={{
        width: 260,
        border: "1px solid #d9d9d9",
        borderRadius: 10,
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        padding: 10
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Select
          size="small"
          value={data.kind}
          options={[
            { label: "Start", value: "start" },
            { label: "Agent", value: "agent" },
            { label: "End", value: "end" }
          ]}
          onChange={(kind) => data.onPatch?.({ kind })}
        />
        <Input
          size="small"
          value={data.label}
          placeholder="Agent name"
          onChange={(event) => data.onPatch?.({ label: event.target.value })}
        />
        <Input.TextArea
          size="small"
          value={data.prompt}
          rows={4}
          placeholder="Prompt"
          onChange={(event) => data.onPatch?.({ prompt: event.target.value })}
        />
        <Select
          size="small"
          value={data.provider}
          disabled={disabled}
          options={[
            { label: "Codex", value: "codex" },
            { label: "Claude", value: "claude" }
          ]}
          onChange={(provider) => data.onPatch?.({ provider })}
        />
        <Input
          size="small"
          value={data.model}
          disabled={disabled}
          placeholder="Model"
          onChange={(event) => data.onPatch?.({ model: event.target.value })}
        />
        <Select
          size="small"
          value={data.complexity}
          disabled={disabled}
          options={[
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" }
          ]}
          onChange={(complexity) => data.onPatch?.({ complexity })}
        />
      </Space>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function FlowBuilderInner({ value, onChange }: FlowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(value.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(value.edges);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedNode = useMemo(() => nodes.find((node) => node.selected), [nodes]);
  const nodeTypes = useMemo(() => ({ flowConfigNode: FlowConfigNode }), []);

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

  const syncNodeById = (nodeId: string, patch: Partial<FlowNodeData>) => {
    const nextNodes = nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNodes(nextNodes);
    commit(nextNodes, edges);
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

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        type: "flowConfigNode",
        data: {
          ...node.data,
          onPatch: (patch: Partial<FlowNodeData>) => syncNodeById(node.id, patch)
        }
      })),
    [nodes]
  );

  return (
    <>
      {contextHolder}
      <Flex gap={12} style={{ height: 620 }}>
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
        <div style={{ width: "100%", height: 560 }}>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
            fitView
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
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
