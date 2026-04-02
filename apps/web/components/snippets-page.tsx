"use client";

import { useState } from "react";
import dayjs from "dayjs";
import type { Snippet } from "@agentswarm/shared-types";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Form, Input, Modal, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSnippets } from "../src/hooks/useSnippets";
import { useAuth } from "./auth-provider";

interface SnippetFormValues {
  name: string;
  content: string;
}

const summarizeSnippet = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
};

export function SnippetsPage() {
  const { snippets, loading } = useSnippets();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<SnippetFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const currentSnippetName = Form.useWatch("name", form) ?? "";
  const currentSnippetContent = Form.useWatch("content", form) ?? "";
  const canCreateSnippet = can("snippet:create");
  const canEditSnippet = can("snippet:edit");
  const canDeleteSnippet = can("snippet:delete");

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "", content: "" });
    setOpen(true);
  };

  const openEdit = (snippet: Snippet) => {
    setEditing(snippet);
    form.setFieldsValue({ name: snippet.name, content: snippet.content });
    setOpen(true);
  };

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
            <Button type="primary" onClick={openCreate}>
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
                      <Button size="small" onClick={() => openEdit(snippet)}>
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

      <Modal
        open={open}
        title={editing ? "Edit Snippet" : "Add Snippet"}
        footer={null}
        onCancel={closeModal}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              if (editing) {
                await api.updateSnippet(editing.id, values);
                messageApi.success("Snippet updated");
              } else {
                await api.createSnippet(values);
                messageApi.success("Snippet created");
              }
              closeModal();
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : "Failed to save snippet");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a snippet name" }]}>
            <Input placeholder="Repository context reminder" />
          </Form.Item>
          <Form.Item name="content" label="Content" rules={[{ required: true, message: "Enter snippet content" }]}>
            <Input.TextArea rows={10} placeholder="Text that should be inserted into prompt fields." />
          </Form.Item>
          <Flex justify="space-between" gap={8} wrap="wrap">
            <Button
              icon={<CopyOutlined />}
              onClick={() => void copySnippetToClipboard(currentSnippetContent, currentSnippetName.trim() || "Snippet")}
              disabled={!currentSnippetContent.trim()}
            >
              Copy
            </Button>
            <Flex gap={8} wrap="wrap" justify="flex-end">
              <Button onClick={closeModal}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editing ? "Save Changes" : "Create Snippet"}
              </Button>
            </Flex>
          </Flex>
        </Form>
      </Modal>
    </>
  );
}
