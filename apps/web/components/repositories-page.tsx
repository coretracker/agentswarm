"use client";

import { useState } from "react";
import type { Repository } from "@agentswarm/shared-types";
import { Button, Card, Checkbox, Flex, Form, Input, Modal, Popconfirm, Space, Switch, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useAuth } from "./auth-provider";

type RepositoryFormValues = {
  name: string;
  url: string;
  defaultBranch: string;
  envVars: Array<{ key: string; value: string }>;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
  clearWebhookSecret: boolean;
};

export function RepositoriesPage() {
  const { repositories, loading } = useRepositories();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Repository | null>(null);
  const [form] = Form.useForm<RepositoryFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateRepository = can("repo:create");
  const canEditRepository = can("repo:edit");
  const canDeleteRepository = can("repo:delete");

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: "",
      url: "",
      defaultBranch: "develop",
      envVars: [],
      webhookEnabled: false,
      webhookUrl: "",
      webhookSecret: "",
      clearWebhookSecret: false
    });
    setOpen(true);
  };

  const openEdit = (repository: Repository) => {
    setEditing(repository);
    form.setFieldsValue({
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      envVars: repository.envVars ?? [],
      webhookEnabled: repository.webhookEnabled,
      webhookUrl: repository.webhookUrl ?? "",
      webhookSecret: "",
      clearWebhookSecret: false
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
              Repositories
            </Typography.Title>
            <Typography.Text type="secondary">Manage reusable repository definitions for task creation.</Typography.Text>
          </Flex>
          {canCreateRepository ? (
            <Button type="primary" onClick={openCreate}>
              Add Repository
            </Button>
          ) : null}
        </Flex>

        <Card bordered={false}>
          <Table<Repository>
            rowKey="id"
            loading={loading}
            dataSource={repositories}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "URL", dataIndex: "url" },
              { title: "Default Branch", dataIndex: "defaultBranch" },
              {
                title: "Env Vars",
                render: (_, repository) => <Typography.Text>{(repository.envVars ?? []).length}</Typography.Text>
              },
              {
                title: "Webhook",
                render: (_, repository) => {
                  if (!repository.webhookEnabled || !repository.webhookUrl) {
                    return <Typography.Text type="secondary">Disabled</Typography.Text>;
                  }

                  const lastState =
                    repository.webhookLastStatus === "success"
                      ? "Last delivery: success"
                      : repository.webhookLastStatus === "failed"
                        ? `Last delivery failed${repository.webhookLastError ? ` (${repository.webhookLastError})` : ""}`
                        : "No deliveries yet";
                  return (
                    <Flex vertical gap={0}>
                      <Typography.Text>{repository.webhookUrl}</Typography.Text>
                      <Typography.Text type={repository.webhookLastStatus === "failed" ? "danger" : "secondary"}>
                        {lastState}
                      </Typography.Text>
                    </Flex>
                  );
                }
              },
              {
                title: "Actions",
                render: (_, repository) => (
                  <Space>
                    {canEditRepository ? <Button onClick={() => openEdit(repository)}>Edit</Button> : null}
                    {canDeleteRepository ? (
                      <Popconfirm
                        title="Delete repository?"
                        description="Tasks keep their stored snapshot, but this repository will be removed from quick selection."
                        onConfirm={async () => {
                          await api.deleteRepository(repository.id);
                          messageApi.success("Repository deleted");
                        }}
                      >
                        <Button danger>Delete</Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Space>

      <Modal open={open} title={editing ? "Edit Repository" : "Add Repository"} footer={null} width={920} onCancel={() => setOpen(false)}>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              const envVars = (values.envVars ?? [])
                .map((entry) => ({
                  key: entry.key.trim(),
                  value: typeof entry.value === "string" ? entry.value : ""
                }))
                .filter((entry) => entry.key.length > 0);
              const payload = {
                name: values.name,
                url: values.url,
                defaultBranch: values.defaultBranch,
                envVars,
                webhookEnabled: values.webhookEnabled,
                webhookUrl: values.webhookUrl.trim().length > 0 ? values.webhookUrl.trim() : null,
                ...(values.webhookSecret.trim().length > 0 ? { webhookSecret: values.webhookSecret.trim() } : {}),
                ...(editing && values.clearWebhookSecret ? { clearWebhookSecret: true } : {})
              };
              if (editing) {
                await api.updateRepository(editing.id, payload);
                messageApi.success("Repository updated");
              } else {
                await api.createRepository(payload);
                messageApi.success("Repository created");
              }
              setOpen(false);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="defaultBranch" label="Default Branch" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.List
            name="envVars"
            rules={[
              {
                validator: async (_, value: RepositoryFormValues["envVars"]) => {
                  const seen = new Set<string>();
                  for (const entry of value ?? []) {
                    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
                    if (!key) {
                      continue;
                    }
                    if (seen.has(key)) {
                      throw new Error(`Duplicate variable name: ${key}`);
                    }
                    seen.add(key);
                  }
                }
              }
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                <Typography.Text strong>Environment Variables</Typography.Text>
                <Typography.Text type="secondary">
                  Repository variables are injected into interactive, automatic, and terminal runs for tasks from this repository.
                </Typography.Text>
                {fields.map((field) => (
                  <Flex key={field.key} gap={8} align="flex-start">
                    <Form.Item
                      {...field}
                      name={[field.name, "key"]}
                      style={{ flex: 1, marginBottom: 0 }}
                      rules={[
                        { required: true, whitespace: true, message: "Name is required." },
                        { max: 128, message: "Name must be 128 characters or fewer." },
                        {
                          pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
                          message: "Name must match /^[A-Za-z_][A-Za-z0-9_]*$/."
                        }
                      ]}
                    >
                      <Input placeholder="NAME" autoComplete="off" />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "value"]}
                      style={{ flex: 2, marginBottom: 0 }}
                      rules={[{ max: 8192, message: "Value must be 8192 characters or fewer." }]}
                    >
                      <Input placeholder="value" autoComplete="off" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>
                      Remove
                    </Button>
                  </Flex>
                ))}
                <Button onClick={() => add({ key: "", value: "" })}>Add variable</Button>
                <Form.ErrorList errors={errors} />
              </Flex>
            )}
          </Form.List>
          <Form.Item name="webhookEnabled" label="Enable Webhooks" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="webhookUrl"
            label="Webhook URL"
            dependencies={["webhookEnabled"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!getFieldValue("webhookEnabled")) {
                    return Promise.resolve();
                  }
                  if (typeof value === "string" && value.trim().length > 0) {
                    try {
                      new URL(value.trim());
                      return Promise.resolve();
                    } catch {
                      return Promise.reject(new Error("Webhook URL must be a valid absolute URL."));
                    }
                  }
                  return Promise.reject(new Error("Webhook URL is required when webhooks are enabled."));
                }
              })
            ]}
          >
            <Input placeholder="https://example.com/webhooks/agentswarm" />
          </Form.Item>
          <Form.Item
            name="webhookSecret"
            label={editing?.webhookSecretConfigured ? "Webhook Secret (leave blank to keep existing)" : "Webhook Secret"}
            dependencies={["webhookEnabled", "clearWebhookSecret"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!getFieldValue("webhookEnabled")) {
                    return Promise.resolve();
                  }
                  const normalized = typeof value === "string" ? value.trim() : "";
                  const clearSecret = getFieldValue("clearWebhookSecret") === true;
                  if (normalized.length > 0) {
                    return Promise.resolve();
                  }
                  if (editing?.webhookSecretConfigured && !clearSecret) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("Webhook secret is required when webhooks are enabled."));
                }
              })
            ]}
          >
            <Input.Password />
          </Form.Item>
          {editing?.webhookSecretConfigured ? (
            <Form.Item name="clearWebhookSecret" valuePropName="checked">
              <Checkbox>Clear stored webhook secret</Checkbox>
            </Form.Item>
          ) : null}
          <Button type="primary" htmlType="submit" loading={submitting}>
            {editing ? "Save Changes" : "Create Repository"}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
