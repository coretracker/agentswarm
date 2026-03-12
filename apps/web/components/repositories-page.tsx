"use client";

import { useState } from "react";
import type { Repository } from "@agentswarm/shared-types";
import { Button, Card, Flex, Form, Input, Modal, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";

type RepositoryFormValues = {
  name: string;
  url: string;
  defaultBranch: string;
  plansDir: string;
  rules: string;
};

export function RepositoriesPage() {
  const { repositories, loading } = useRepositories();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Repository | null>(null);
  const [form] = Form.useForm<RepositoryFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: "",
      url: "",
      defaultBranch: "develop",
      plansDir: "plans",
      rules: ""
    });
    setOpen(true);
  };

  const openEdit = (repository: Repository) => {
    setEditing(repository);
    form.setFieldsValue({
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      plansDir: repository.plansDir,
      rules: repository.rules
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
            <Typography.Text type="secondary">Manage reusable repository definitions and their local plan folders.</Typography.Text>
          </Flex>
          <Button type="primary" onClick={openCreate}>
            Add Repository
          </Button>
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
            { title: "Plans Dir", dataIndex: "plansDir" },
            {
              title: "Repository Rules",
              dataIndex: "rules",
              render: (value: string) =>
                value?.trim() ? (
                  <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 320 }}>
                    {value}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">None</Typography.Text>
                )
            },
            {
              title: "Actions",
              render: (_, repository) => (
                <Space>
                  <Button onClick={() => openEdit(repository)}>Edit</Button>
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
                </Space>
              )
            }
          ]}
        />
        </Card>
      </Space>

      <Modal open={open} title={editing ? "Edit Repository" : "Add Repository"} footer={null} onCancel={() => setOpen(false)}>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              if (editing) {
                await api.updateRepository(editing.id, values);
                messageApi.success("Repository updated");
              } else {
                await api.createRepository(values);
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
          <Form.Item name="plansDir" label="Plans Directory" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="rules" label="Repository Rules">
            <Input.TextArea
              rows={8}
              placeholder="Rules that should always be added for this repository, for example stack conventions or codebase-specific constraints."
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {editing ? "Save Changes" : "Create Repository"}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
