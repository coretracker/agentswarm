"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import type { Snippet } from "@agentswarm/shared-types";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSnippets } from "../src/hooks/useSnippets";
import { useAuth } from "./auth-provider";

const summarizeSnippet = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
};

export function SnippetsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { snippets, loading } = useSnippets();
  const { can } = useAuth();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateSnippet = can("snippet:create");
  const canEditSnippet = can("snippet:edit");
  const canDeleteSnippet = can("snippet:delete");

  useEffect(() => {
    const savedState = searchParams.get("saved");
    if (!savedState) {
      return;
    }
    if (savedState === "created") {
      messageApi.success("Snippet created");
    } else if (savedState === "updated") {
      messageApi.success("Snippet updated");
    }
    router.replace("/snippets");
  }, [messageApi, router, searchParams]);

  const copySnippetToClipboard = async (content: string, label: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      messageApi.error("Clipboard access is unavailable in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      messageApi.success(`${label} copied`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to copy snippet");
    }
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Snippets
            </Typography.Title>
            <Typography.Text type="secondary">
              Store reusable text blocks and insert them into task prompts and follow-up messages.
            </Typography.Text>
          </Flex>
          {canCreateSnippet ? (
            <Button type="primary" onClick={() => router.push("/snippets/new?from=list")}>
              Add Snippet
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Table<Snippet>
            rowKey="id"
            loading={loading}
            dataSource={snippets}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "Name",
                dataIndex: "name"
              },
              {
                title: "Preview",
                dataIndex: "content",
                render: (value: string) => summarizeSnippet(value)
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
                width: 280,
                render: (_value, snippet) => (
                  <Space wrap>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => void copySnippetToClipboard(snippet.content, snippet.name)}>
                      Copy
                    </Button>
                    {canEditSnippet ? (
                      <Button size="small" onClick={() => router.push(`/snippets/${snippet.id}/edit?from=list`)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDeleteSnippet ? (
                      <Popconfirm
                        title="Delete snippet?"
                        description={`Delete "${snippet.name}"?`}
                        okText="Delete"
                        okButtonProps={{ danger: true, loading: deletingId === snippet.id }}
                        onConfirm={async () => {
                          setDeletingId(snippet.id);
                          try {
                            await api.deleteSnippet(snippet.id);
                            messageApi.success("Snippet deleted");
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to delete snippet");
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
