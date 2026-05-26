"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Sequence, SequenceStep, SnippetVariable } from "@agentswarm/shared-types";
import { ArrowDownOutlined, ArrowUpOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Flex, Form, Input, Result, Select, Space, Spin, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSnippets } from "../src/hooks/useSnippets";
import { useSequences } from "../src/hooks/useSequences";
import { trackEvent } from "../src/utils/analytics";
import { useAuth } from "./auth-provider";

interface SequenceEditorPageProps {
  mode: "create" | "edit";
  sequenceId?: string;
}

interface SequenceFormValues {
  name: string;
  steps: SequenceStep[];
  variables: SnippetVariable[];
}

const defaultStep = (): SequenceStep => ({ id: "step_1", type: "inline", prompt: "", snippetId: undefined });

const normalizeVariable = (value: SnippetVariable): SnippetVariable => ({
  name: value.name,
  type: value.type,
  title: value.title ?? "",
  description: value.description ?? "",
  defaultValue: value.defaultValue ?? ""
});

const mergeSnippetVariables = (input: { current: SnippetVariable[]; steps: SequenceStep[]; snippetDefinitions: Map<string, SnippetVariable[]> }) => {
  const next = input.current.map((entry) => normalizeVariable(entry));
  const byName = new Map(next.map((entry, index) => [entry.name, index]));
  const conflicts = new Set<string>();

  for (const step of input.steps) {
    if (step.type !== "snippet" || !step.snippetId) {
      continue;
    }
    const variables = input.snippetDefinitions.get(step.snippetId) ?? [];
    for (const snippetVariable of variables) {
      const existingIndex = byName.get(snippetVariable.name);
      if (existingIndex === undefined) {
        byName.set(snippetVariable.name, next.length);
        next.push(normalizeVariable(snippetVariable));
        continue;
      }
      const existing = next[existingIndex]!;
      if (existing.type !== snippetVariable.type) {
        conflicts.add(snippetVariable.name);
      }
      next[existingIndex] = {
        ...existing,
        title: existing.title || snippetVariable.title || "",
        description: existing.description || snippetVariable.description || "",
        defaultValue: existing.defaultValue || snippetVariable.defaultValue || ""
      };
    }
  }

  const changed = JSON.stringify(next) !== JSON.stringify(input.current.map((entry) => normalizeVariable(entry)));
  return { next, conflicts: Array.from(conflicts), changed };
};

export function SequenceEditorPage({ mode, sequenceId }: SequenceEditorPageProps) {
  const router = useRouter();
  const { can } = useAuth();
  const canListSnippets = can("snippet:list");
  const canListSequences = can("sequence:list");
  const { snippets, loading: snippetsLoading } = useSnippets(canListSnippets);
  const { sequences, loading: sequencesLoading } = useSequences(mode === "edit" && canListSequences);
  const [form] = Form.useForm<SequenceFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const [snippetVariableConflicts, setSnippetVariableConflicts] = useState<string[]>([]);
  const watchedSteps = Form.useWatch("steps", form) as SequenceStep[] | undefined;
  const editingSequence = useMemo<Sequence | null>(() => {
    if (mode !== "edit" || !sequenceId) {
      return null;
    }
    return sequences.find((sequence) => sequence.id === sequenceId) ?? null;
  }, [mode, sequenceId, sequences]);

  const snippetVariablesById = useMemo(
    () => new Map(snippets.map((snippet) => [snippet.id, snippet.variables ?? []])),
    [snippets]
  );

  useEffect(() => {
    trackEvent("sequence_edit_opened", { mode });
  }, [mode]);

  useEffect(() => {
    if (mode === "create") {
      form.setFieldsValue({
        name: "",
        steps: [defaultStep()],
        variables: []
      });
      return;
    }

    if (!editingSequence) {
      return;
    }

    form.setFieldsValue({
      name: editingSequence.name,
      steps: editingSequence.steps,
      variables: editingSequence.variables
    });
  }, [editingSequence, form, mode]);

  useEffect(() => {
    if (!watchedSteps || watchedSteps.length === 0 || !canListSnippets) {
      setSnippetVariableConflicts([]);
      return;
    }

    const current = (form.getFieldValue("variables") as SnippetVariable[] | undefined) ?? [];
    const merged = mergeSnippetVariables({
      current,
      steps: watchedSteps,
      snippetDefinitions: snippetVariablesById
    });

    if (merged.changed) {
      form.setFieldValue("variables", merged.next);
    }
    setSnippetVariableConflicts(merged.conflicts);
  }, [canListSnippets, form, snippetVariablesById, watchedSteps]);

  if (mode === "edit" && sequencesLoading) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 320 }}>
        <Spin />
      </Flex>
    );
  }

  if (mode === "edit" && !editingSequence) {
    return (
      <Result
        status="404"
        title="Sequence not found"
        subTitle="The sequence may have been deleted or you may not have access to it."
        extra={<Button onClick={() => router.push("/sequences")}>Back to Sequences</Button>}
      />
    );
  }

  const title = mode === "edit" ? "Edit Sequence" : "Add Sequence";

  return (
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          setSubmitting(true);
          trackEvent("sequence_save_tapped", { mode });
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
            if (mode === "edit" && editingSequence) {
              await api.updateSequence(editingSequence.id, payload);
              messageApi.success("Sequence updated");
            } else {
              await api.createSequence(payload);
              trackEvent("sequence_created", { step_count: payload.steps.length });
              messageApi.success("Sequence created");
            }
            router.push("/sequences");
          } catch (error) {
            const messageText = error instanceof Error ? error.message : "Failed to save sequence";
            if (messageText.toLowerCase().includes("missing required variable")) {
              trackEvent("sequence_save_failed_missing_variables", { mode });
            }
            messageApi.error(messageText);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Flex vertical gap={16}>
          <Flex align="center" justify="space-between" gap={16} wrap="wrap">
            <Flex vertical gap={0}>
              <Typography.Title level={2} style={{ margin: 0 }}>
                {title}
              </Typography.Title>
              <Typography.Text type="secondary">
                Build reusable multi-step prompt flows with clear step order.
              </Typography.Text>
            </Flex>
            <Space>
              <Button onClick={() => router.push("/sequences")}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {mode === "edit" ? "Save" : "Create"}
              </Button>
            </Space>
          </Flex>

          <Card bordered={false}>
            <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a sequence name" }]}>
              <Input placeholder="Feature implementation flow" />
            </Form.Item>

            <Form.List
              name="steps"
              rules={[{ validator: async (_, value) => ((value?.length ?? 0) > 0 ? undefined : Promise.reject(new Error("Add at least one step"))) }]}
            >
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
                                  loading={snippetsLoading}
                                  placeholder={snippetsLoading ? "Loading snippets..." : "Select snippet"}
                                  options={snippets.map((snippet) => ({ value: snippet.id, label: snippet.name }))}
                                  optionFilterProp="label"
                                  onChange={() => trackEvent("sequence_snippet_added")}
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

            {snippetVariableConflicts.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Variable type conflict"
                description={`These variables are used with different types across selected snippets: ${snippetVariableConflicts.join(", ")}.`}
              />
            ) : null}

            <Form.List
              name="variables"
              rules={[
                {
                  validator: async (_, value: SequenceFormValues["variables"]) => {
                    const seen = new Set<string>();
                    for (const entry of value ?? []) {
                      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
                      if (!name) {
                        continue;
                      }
                      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                        throw new Error(`Invalid variable name: ${name}`);
                      }
                      if (seen.has(name)) {
                        throw new Error(`Duplicate variable name: ${name}`);
                      }
                      seen.add(name);
                    }
                  }
                }
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
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
                                <Input.TextArea rows={2} placeholder="Default value" onBlur={() => trackEvent("sequence_variable_filled")} />
                              ) : (
                                <Input placeholder="Default value" onBlur={() => trackEvent("sequence_variable_filled")} />
                              )}
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Card>
                  ))}
                  {errors.length > 0 ? (
                    <Typography.Text type="danger">{String(errors[0])}</Typography.Text>
                  ) : null}
                </Flex>
              )}
            </Form.List>
          </Card>
        </Flex>
      </Form>
    </>
  );
}
