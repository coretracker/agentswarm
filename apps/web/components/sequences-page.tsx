"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import type { Sequence, SequenceExecutionMode, SequenceStep } from "@agentswarm/shared-types";
import { Button, Card, Flex, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSequences } from "../src/hooks/useSequences";
import { useAuth } from "./auth-provider";
import { trackEvent } from "../src/utils/analytics";

const summarizeStep = (step: SequenceStep): string => {
  if (step.type === "snippet") {
    return `Snippet: ${step.snippetId ?? "unknown"}`;
  }
  const normalized = step.prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Inline prompt";
  }
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized;
};

const getExecutionModeLabel = (mode: SequenceExecutionMode): string =>
  mode === "approve_before_continuing" ? "Approve Before Continuing" : "Auto Apply Changes";

export function SequencesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const { sequences, loading } = useSequences(can("sequence:list"));
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreate = can("sequence:create");
  const canEdit = can("sequence:edit");
  const canDelete = can("sequence:delete");
  const canDuplicate = can("sequence:create");
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Sequences
            </Typography.Title>
            <Typography.Text type="secondary">
              Build reusable multi-step prompt flows with clear step order.
            </Typography.Text>
          </Flex>
          {canCreate ? (
            <Button type="primary" onClick={() => router.push("/sequences/new")}>
              Add Sequence
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Table<Sequence>
            rowKey="id"
            loading={loading}
            dataSource={sequences}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "Name", dataIndex: "name" },
              {
                title: "Steps",
                render: (_value, sequence) => sequence.steps.length
              },
              {
                title: "Run Mode",
                render: (_value, sequence) => getExecutionModeLabel(sequence.executionMode)
              },
              {
                title: "Preview",
                render: (_value, sequence) => summarizeStep(sequence.steps[0] ?? { id: "", type: "inline", prompt: "" })
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
                width: 220,
                render: (_value, sequence) => (
                  <Space wrap>
                    {canEdit ? (
                      <Button size="small" onClick={() => router.push(`/sequences/${sequence.id}/edit`)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDuplicate ? (
                      <Button
                        size="small"
                        loading={duplicatingId === sequence.id}
                        onClick={async () => {
                          setDuplicatingId(sequence.id);
                          try {
                            const duplicated = await api.duplicateSequence(sequence.id);
                            trackEvent("sequence_duplicated", {
                              source: "list",
                              sequence_id: sequence.id,
                              duplicated_sequence_id: duplicated.id
                            });
                            messageApi.success("Sequence duplicated");
                            router.push(`/sequences/${duplicated.id}/edit`);
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to duplicate sequence");
                          } finally {
                            setDuplicatingId(null);
                          }
                        }}
                      >
                        Duplicate
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Popconfirm
                        title="Delete sequence?"
                        description={`Delete "${sequence.name}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingId === sequence.id }}
                        onConfirm={async () => {
                          setDeletingId(sequence.id);
                          try {
                            await api.deleteSequence(sequence.id);
                            messageApi.success("Sequence deleted");
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to delete sequence");
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
    </>
  );
}
