"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Snippet } from "@agentswarm/shared-types";
import { ArrowDownOutlined, ArrowUpOutlined, CopyOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Form, Input, Result, Select, Space, Spin, Typography, message } from "antd";
import { ApiError, api } from "../src/api/client";
import { trackEvent } from "../src/utils/analytics";

interface SnippetEditorPageProps {
  mode: "create" | "edit";
  snippetId?: string;
}

interface SnippetFormValues {
  name: string;
  content: string;
  variables: Array<{
    name: string;
    type: "text" | "multiline";
    title: string;
    description: string;
    defaultValue: string;
  }>;
}

const emptyValues = (): SnippetFormValues => ({
  name: "",
  content: "",
  variables: []
});

const normalizeValues = (values?: Partial<SnippetFormValues> | null): SnippetFormValues => ({
  name: typeof values?.name === "string" ? values.name : "",
  content: typeof values?.content === "string" ? values.content : "",
  variables: (values?.variables ?? []).map((entry) => ({
    name: typeof entry?.name === "string" ? entry.name : "",
    type: entry?.type === "multiline" ? "multiline" : "text",
    title: typeof entry?.title === "string" ? entry.title : "",
    description: typeof entry?.description === "string" ? entry.description : "",
    defaultValue: typeof entry?.defaultValue === "string" ? entry.defaultValue : ""
  }))
});

const snapshotValues = (values?: Partial<SnippetFormValues> | null): string => JSON.stringify(normalizeValues(values));

export function SnippetEditorPage({ mode, snippetId }: SnippetEditorPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryPoint = searchParams.get("from") === "list" ? "list" : "direct_url";
  const [form] = Form.useForm<SnippetFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const watchedValues = Form.useWatch([], form) as SnippetFormValues | undefined;
  const currentSnippetName = Form.useWatch("name", form) ?? "";
  const currentSnippetContent = Form.useWatch("content", form) ?? "";

  const hasUnsavedChanges = useMemo(() => {
    if (!initialSnapshot) {
      return false;
    }
    return snapshotValues(watchedValues) !== initialSnapshot;
  }, [initialSnapshot, watchedValues]);

  useEffect(() => {
    trackEvent("snippet_editor_opened", { mode, entry_point: entryPoint });
  }, [entryPoint, mode]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    const initial = emptyValues();
    form.setFieldsValue(initial);
    setInitialSnapshot(snapshotValues(initial));
    setLoading(false);
  }, [form, mode]);

  useEffect(() => {
    if (mode !== "edit" || !snippetId) {
      return;
    }

    let active = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);

    void api
      .getSnippet(snippetId)
      .then((snippet) => {
        if (!active) {
          return;
        }
        setEditingSnippet(snippet);
        const initial = normalizeValues(snippet);
        form.setFieldsValue(initial);
        setInitialSnapshot(snapshotValues(initial));
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Failed to load snippet");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [form, mode, snippetId]);

  useEffect(() => {
    if (!hasUnsavedChanges || typeof window === "undefined") {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  const confirmLeave = (): boolean => {
    if (!hasUnsavedChanges || typeof window === "undefined") {
      return true;
    }
    return window.confirm("Discard unsaved changes?");
  };

  const goBack = () => {
    if (!confirmLeave()) {
      return;
    }
    router.push("/snippets");
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

  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 320 }}>
        <Spin />
      </Flex>
    );
  }

  if (mode === "edit" && (notFound || !snippetId)) {
    return (
      <Result
        status="404"
        title="Snippet not found"
        subTitle="The snippet may have been deleted or you may not have access to it."
        extra={<Button onClick={() => router.push("/snippets")}>Back to Snippets</Button>}
      />
    );
  }

  if (mode === "edit" && loadError) {
    return (
      <Result
        status="error"
        title="Snippet unavailable"
        subTitle={loadError}
        extra={<Button onClick={() => router.push("/snippets")}>Back to Snippets</Button>}
      />
    );
  }

  const title = mode === "edit" ? "Edit Snippet" : "Add Snippet";

  return (
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          setSubmitting(true);
          try {
            const payload = normalizeValues(values);
            if (mode === "edit" && editingSnippet) {
              await api.updateSnippet(editingSnippet.id, payload);
            } else {
              await api.createSnippet(payload);
            }
            trackEvent("snippet_saved", { mode, entry_point: entryPoint });
            router.push(`/snippets?saved=${mode === "edit" ? "updated" : "created"}`);
          } catch (error) {
            trackEvent("snippet_save_failed", { mode, entry_point: entryPoint });
            messageApi.error(error instanceof Error ? error.message : "Failed to save snippet");
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
                Store reusable text blocks and insert them into task prompts and follow-up messages.
              </Typography.Text>
            </Flex>
            <Space wrap>
              <Button
                icon={<CopyOutlined />}
                onClick={() => void copySnippetToClipboard(currentSnippetContent, currentSnippetName.trim() || "Snippet")}
                disabled={!currentSnippetContent.trim()}
              >
                Copy
              </Button>
              <Button onClick={goBack}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {mode === "edit" ? "Save" : "Create"}
              </Button>
            </Space>
          </Flex>

          <Card bordered={false}>
            <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a snippet name" }]}>
              <Input placeholder="Repository context reminder" />
            </Form.Item>
            <Form.Item name="content" label="Content" rules={[{ required: true, message: "Enter snippet content" }]}>
              <Input.TextArea rows={10} placeholder="Text that should be inserted into prompt fields." />
            </Form.Item>
            <Form.List
              name="variables"
              rules={[
                {
                  validator: async (_, value: SnippetFormValues["variables"]) => {
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
              {(fields, { add, remove, move }, { errors }) => (
                <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                  <Flex justify="space-between" align="center">
                    <Typography.Text strong>Variables</Typography.Text>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => add({ name: "", type: "text", title: "", description: "", defaultValue: "" })}
                    >
                      Add Variable
                    </Button>
                  </Flex>
                  {fields.map((field, index) => (
                    <Card key={field.key} size="small">
                      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                        <Typography.Text strong>{`Variable ${index + 1}`}</Typography.Text>
                        <Space size={4}>
                          <Button
                            icon={<ArrowUpOutlined />}
                            disabled={index === 0}
                            onClick={() => {
                              const variables = (form.getFieldValue("variables") as SnippetFormValues["variables"] | undefined) ?? [];
                              const variableName = variables[index]?.name ?? "";
                              move(index, index - 1);
                              trackEvent("snippet_variable_reordered", {
                                variable_name: variableName,
                                from_index: index,
                                to_index: index - 1,
                                editor_mode: mode
                              });
                            }}
                          />
                          <Button
                            icon={<ArrowDownOutlined />}
                            disabled={index === fields.length - 1}
                            onClick={() => {
                              const variables = (form.getFieldValue("variables") as SnippetFormValues["variables"] | undefined) ?? [];
                              const variableName = variables[index]?.name ?? "";
                              move(index, index + 1);
                              trackEvent("snippet_variable_reordered", {
                                variable_name: variableName,
                                from_index: index,
                                to_index: index + 1,
                                editor_mode: mode
                              });
                            }}
                          />
                          <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />
                        </Space>
                      </Flex>
                      <Flex gap={8} align="flex-start">
                        <Form.Item
                          name={[field.name, "name"]}
                          style={{ marginBottom: 8, flex: 1 }}
                          rules={[{ required: true, message: "Name is required" }]}
                        >
                          <Input placeholder="name (used as {{name}})" />
                        </Form.Item>
                        <Form.Item name={[field.name, "type"]} style={{ marginBottom: 8, width: 140 }} initialValue="text">
                          <Select
                            options={[
                              { label: "Text", value: "text" },
                              { label: "Multiline", value: "multiline" }
                            ]}
                          />
                        </Form.Item>
                      </Flex>
                      <Form.Item name={[field.name, "title"]} style={{ marginBottom: 8 }}>
                        <Input placeholder="Title (shown in insert form)" />
                      </Form.Item>
                      <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                        <Input placeholder="Description (helper text in insert form)" />
                      </Form.Item>
                      <Form.Item
                        noStyle
                        shouldUpdate={(prev, next) => {
                          const prevType = prev?.variables?.[field.name]?.type;
                          const nextType = next?.variables?.[field.name]?.type;
                          return prevType !== nextType;
                        }}
                      >
                        {({ getFieldValue }) => {
                          const variableType = getFieldValue(["variables", field.name, "type"]) as "text" | "multiline" | undefined;
                          return (
                            <Form.Item name={[field.name, "defaultValue"]} style={{ marginBottom: 0, marginTop: 8 }}>
                              {variableType === "multiline" ? (
                                <Input.TextArea rows={2} placeholder="Default value (pre-filled when inserting)" />
                              ) : (
                                <Input placeholder="Default value (single line)" />
                              )}
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Card>
                  ))}
                  {errors.length > 0 ? <Typography.Text type="danger">{errors.join(", ")}</Typography.Text> : null}
                </Flex>
              )}
            </Form.List>
          </Card>
        </Flex>
      </Form>
    </>
  );
}
