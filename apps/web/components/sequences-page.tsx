"use client";

import { useState } from "react";
import dayjs from "dayjs";
import type { Sequence, SequenceStep } from "@agentswarm/shared-types";
import { ArrowDownOutlined, ArrowUpOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSequences } from "../src/hooks/useSequences";
import { useSnippets } from "../src/hooks/useSnippets";
import { trackEvent } from "../src/utils/analytics";
import { useAuth } from "./auth-provider";

interface SequenceFormValues {
  name: string;
  steps: SequenceStep[];
  variables: Array<{
    name: string;
    type: "text" | "multiline";
    title: string;
    description: string;
    defaultValue: string;
  }>;
}

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

export function SequencesPage() {
  const { can } = useAuth();
  const { sequences, loading } = useSequences(can("sequence:list"));
  const { snippets } = useSnippets(can("snippet:list"));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<SequenceFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreate = can("sequence:create");
  const canEdit = can("sequence:edit");
  const canDelete = can("sequence:delete");

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: "",
      steps: [{ id: "step_1", type: "inline", prompt: "", snippetId: undefined }],
      variables: []
    });
    setOpen(true);
  };

  const openEdit = (sequence: Sequence) => {
    setEditing(sequence);
    form.setFieldsValue({
      name: sequence.name,
      steps: sequence.steps,
      variables: sequence.variables
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
              Sequences
            </Typography.Title>
            <Typography.Text type="secondary">
              Build reusable multi-step prompt flows with clear step order.
            </Typography.Text>
          </Flex>
          {canCreate ? (
            <Button type="primary" onClick={openCreate}>
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
                      <Button size="small" onClick={() => openEdit(sequence)}>
                        Edit
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

      <Modal open={open} title={editing ? "Edit Sequence" : "Add Sequence"} footer={null} onCancel={closeModal} destroyOnHidden width={840}>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              const payload = {
                name: values.name,
                steps: values.steps.map((step, index) => ({
                  id: step.id?.trim() || `step_${index + 1}`,
                  type: step.type,
                  prompt: step.prompt ?? "",
                  snippetId: step.type === "snippet" ? step.snippetId : undefined
                })),
                variables: values.variables ?? []
              };
              if (editing) {
                await api.updateSequence(editing.id, payload);
                messageApi.success("Sequence updated");
              } else {
                await api.createSequence(payload);
                trackEvent("sequence_created", { step_count: payload.steps.length });
                messageApi.success("Sequence created");
              }
              closeModal();
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : "Failed to save sequence");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a sequence name" }]}>
            <Input placeholder="Feature implementation flow" />
          </Form.Item>

          <Form.List name="steps" rules={[{ validator: async (_, value) => ((value?.length ?? 0) > 0 ? undefined : Promise.reject(new Error("Add at least one step"))) }]}>
            {(fields, { add, remove, move }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                <Flex justify="space-between" align="center">
                  <Typography.Text strong>Steps</Typography.Text>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ type: "inline", prompt: "", snippetId: undefined })}>
                    Add Step
                  </Button>
                </Flex>
                {fields.map((field, index) => (
                  <Card key={field.key} size="small">
                    <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                      <Typography.Text strong>{`Step ${index + 1}`}</Typography.Text>
                      <Space size={4}>
                        <Button size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, index - 1)} />
                        <Button size="small" icon={<ArrowDownOutlined />} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} />
                        <Button size="small" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />
                      </Space>
                    </Flex>
                    <Form.Item name={[field.name, "type"]} style={{ marginBottom: 8 }} rules={[{ required: true }]}>
                      <Select
                        options={[
                          { label: "Inline Prompt", value: "inline" },
                          { label: "Snippet Reference", value: "snippet" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, next) => prev?.steps?.[field.name]?.type !== next?.steps?.[field.name]?.type}>
                      {({ getFieldValue }) => {
                        const stepType = getFieldValue(["steps", field.name, "type"]) as "inline" | "snippet" | undefined;
                        if (stepType === "snippet") {
                          return (
                            <Form.Item
                              name={[field.name, "snippetId"]}
                              style={{ marginBottom: 0 }}
                              rules={[{ required: true, message: "Select a snippet for this step" }]}
                            >
                              <Select
                                showSearch
                                placeholder="Select snippet"
                                options={snippets.map((snippet) => ({ value: snippet.id, label: snippet.name }))}
                                optionFilterProp="label"
                              />
                            </Form.Item>
                          );
                        }
                        return (
                          <Form.Item
                            name={[field.name, "prompt"]}
                            style={{ marginBottom: 0 }}
                            rules={[{ required: true, message: "Enter prompt content for this step" }]}
                          >
                            <Input.TextArea rows={3} placeholder="Prompt text for this step" />
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                  </Card>
                ))}
              </Flex>
            )}
          </Form.List>

          <Form.List name="variables">
            {(fields, { add, remove }) => (
              <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                <Flex justify="space-between" align="center">
                  <Typography.Text strong>Variables</Typography.Text>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ name: "", type: "text", title: "", description: "", defaultValue: "" })}>
                    Add Variable
                  </Button>
                </Flex>
                {fields.map((field) => (
                  <Card key={field.key} size="small">
                    <Flex gap={8} align="flex-start">
                      <Form.Item name={[field.name, "name"]} style={{ marginBottom: 8, flex: 1 }} rules={[{ required: true, message: "Name is required" }]}>
                        <Input placeholder="name ({{name}})" />
                      </Form.Item>
                      <Form.Item name={[field.name, "type"]} style={{ marginBottom: 8, width: 140 }} initialValue="text">
                        <Select
                          options={[
                            { label: "Text", value: "text" },
                            { label: "Multiline", value: "multiline" }
                          ]}
                        />
                      </Form.Item>
                      <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />
                    </Flex>
                    <Form.Item name={[field.name, "title"]} style={{ marginBottom: 8 }}>
                      <Input placeholder="Title (optional)" />
                    </Form.Item>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 8 }}>
                      <Input placeholder="Description (optional)" />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, next) => prev?.variables?.[field.name]?.type !== next?.variables?.[field.name]?.type}>
                      {({ getFieldValue }) => {
                        const variableType = getFieldValue(["variables", field.name, "type"]) as "text" | "multiline" | undefined;
                        return (
                          <Form.Item name={[field.name, "defaultValue"]} style={{ marginBottom: 0 }}>
                            {variableType === "multiline" ? (
                              <Input.TextArea rows={2} placeholder="Default value" />
                            ) : (
                              <Input placeholder="Default value" />
                            )}
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                  </Card>
                ))}
              </Flex>
            )}
          </Form.List>

          <Flex justify="flex-end" gap={8}>
            <Button onClick={closeModal}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {editing ? "Save" : "Create"}
            </Button>
          </Flex>
        </Form>
      </Modal>
    </>
  );
}
