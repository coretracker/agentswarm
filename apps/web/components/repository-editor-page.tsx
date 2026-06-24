"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CreateRepositoryInput,
  Repository,
  RepositoryEnvSecretInput,
  RepositoryEnvVarInput
} from "@agentswarm/shared-types";
import { DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS } from "@agentswarm/shared-types";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, Result, Select, Space, Spin, Switch, Typography, Upload, message } from "antd";
import { ApiError, api } from "../src/api/client";
import { trackEvent } from "../src/utils/analytics";
import { buildApiUrl } from "../src/lib/public-url";

interface RepositoryEditorPageProps {
  mode: "create" | "edit";
  repositoryId?: string;
}

type RepositoryFormValues = {
  name: string;
  url: string;
  defaultBranch: string;
  envVars: Array<{ key: string; type: "text" | "file"; value: string; fileName: string; fileContentBase64: string }>;
  envSecrets: Array<{ key: string; type: "text" | "file"; value: string; fileName: string; fileContentBase64: string }>;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
  clearWebhookSecret: boolean;
  githubPrWebhookSecret: string;
  clearGithubPrWebhookSecret: boolean;
  githubIntegrationBotLogin: string;
  githubPrFeedbackInstructions: string;
};

const emptyValues = (): RepositoryFormValues => ({
  name: "",
  url: "",
  defaultBranch: "develop",
  envVars: [],
  envSecrets: [],
  webhookEnabled: false,
  webhookUrl: "",
  webhookSecret: "",
  clearWebhookSecret: false,
  githubPrWebhookSecret: "",
  clearGithubPrWebhookSecret: false,
  githubIntegrationBotLogin: "",
  githubPrFeedbackInstructions: DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
});

const normalizeValues = (values?: Partial<RepositoryFormValues> | null): RepositoryFormValues => ({
  name: typeof values?.name === "string" ? values.name : "",
  url: typeof values?.url === "string" ? values.url : "",
  defaultBranch: typeof values?.defaultBranch === "string" ? values.defaultBranch : "develop",
  envVars: (values?.envVars ?? []).map((entry) => ({
    key: typeof entry?.key === "string" ? entry.key : "",
    type: entry?.type === "file" ? "file" : "text",
    value: typeof entry?.value === "string" ? entry.value : "",
    fileName: typeof entry?.fileName === "string" ? entry.fileName : "",
    fileContentBase64: typeof entry?.fileContentBase64 === "string" ? entry.fileContentBase64 : ""
  })),
  envSecrets: (values?.envSecrets ?? []).map((entry) => ({
    key: typeof entry?.key === "string" ? entry.key : "",
    type: entry?.type === "file" ? "file" : "text",
    value: typeof entry?.value === "string" ? entry.value : "",
    fileName: typeof entry?.fileName === "string" ? entry.fileName : "",
    fileContentBase64: typeof entry?.fileContentBase64 === "string" ? entry.fileContentBase64 : ""
  })),
  webhookEnabled: values?.webhookEnabled === true,
  webhookUrl: typeof values?.webhookUrl === "string" ? values.webhookUrl : "",
  webhookSecret: typeof values?.webhookSecret === "string" ? values.webhookSecret : "",
  clearWebhookSecret: values?.clearWebhookSecret === true,
  githubPrWebhookSecret: typeof values?.githubPrWebhookSecret === "string" ? values.githubPrWebhookSecret : "",
  clearGithubPrWebhookSecret: values?.clearGithubPrWebhookSecret === true,
  githubIntegrationBotLogin: typeof values?.githubIntegrationBotLogin === "string" ? values.githubIntegrationBotLogin : "",
  githubPrFeedbackInstructions:
    typeof values?.githubPrFeedbackInstructions === "string"
      ? values.githubPrFeedbackInstructions
      : DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
});

const snapshotValues = (values?: Partial<RepositoryFormValues> | null): string => JSON.stringify(normalizeValues(values));
const REPOSITORY_ENV_VALUE_MAX_LENGTH = 8192;
const REPOSITORY_ENV_FILE_MAX_BYTES = 256 * 1024;
const ENV_VALUE_FILE_ACCEPT =
  ".txt,.env,.json,.yaml,.yml,.ini,.cfg,.conf,.properties,.xml,.pem,.crt,.cer,.key,.p12,.jks";

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const readUploadedEnvValueFile = async (file: File): Promise<{ fileName: string; fileContentBase64: string; sizeBytes: number }> => {
  if (file.size <= 0) {
    throw new Error(`"${file.name}" is empty.`);
  }
  if (file.size > REPOSITORY_ENV_FILE_MAX_BYTES) {
    throw new Error(`"${file.name}" is too large. Keep files at ${REPOSITORY_ENV_FILE_MAX_BYTES} bytes or less.`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error(`"${file.name}" could not be read.`);
  }

  if (bytes.byteLength <= 0) {
    throw new Error(`"${file.name}" is empty.`);
  }

  return {
    fileName: file.name,
    fileContentBase64: bytesToBase64(bytes),
    sizeBytes: bytes.byteLength
  };
};

export function RepositoryEditorPage({ mode, repositoryId }: RepositoryEditorPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryPoint = searchParams.get("from") === "list" ? "list" : "direct_url";
  const [form] = Form.useForm<RepositoryFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingRepository, setEditingRepository] = useState<Repository | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const watchedValues = Form.useWatch([], form) as RepositoryFormValues | undefined;

  const hasUnsavedChanges = useMemo(() => {
    if (!initialSnapshot) {
      return false;
    }
    return snapshotValues(watchedValues) !== initialSnapshot;
  }, [initialSnapshot, watchedValues]);

  useEffect(() => {
    trackEvent("repository_editor_opened", { mode, entry_point: entryPoint });
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
    if (mode !== "edit" || !repositoryId) {
      return;
    }

    let active = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);

    void api
      .getRepository(repositoryId)
      .then((repository) => {
        if (!active) {
          return;
        }
        setEditingRepository(repository);
        const initial = normalizeValues({
          name: repository.name,
          url: repository.url,
          defaultBranch: repository.defaultBranch,
          envVars: (repository.envVars ?? []).map((entry) => ({
            key: entry.key,
            type: entry.type === "file" ? "file" : "text",
            value: entry.type === "file" ? "" : entry.value,
            fileName: entry.type === "file" ? (entry.fileName ?? "") : "",
            fileContentBase64: ""
          })),
          envSecrets: (repository.envSecrets ?? []).map((entry) => ({
            key: entry.key,
            type: entry.type === "file" ? "file" : "text",
            value: "",
            fileName: entry.type === "file" ? (entry.fileName ?? "") : "",
            fileContentBase64: ""
          })),
          webhookEnabled: repository.webhookEnabled,
          webhookUrl: repository.webhookUrl ?? "",
          webhookSecret: "",
          clearWebhookSecret: false,
          githubPrWebhookSecret: "",
          clearGithubPrWebhookSecret: false,
          githubIntegrationBotLogin: repository.githubIntegrationBotLogin ?? "",
          githubPrFeedbackInstructions: repository.githubPrFeedbackInstructions ?? DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
        });
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
        setLoadError(error instanceof Error ? error.message : "Failed to load repository");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [form, mode, repositoryId]);

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
    router.push("/repositories");
  };

  const importFileValue = async (basePath: Array<string | number>, file: File, label: "variable" | "secret"): Promise<void> => {
    try {
      const parsed = await readUploadedEnvValueFile(file);
      form.setFieldValue([...basePath, "type"] as never, "file");
      form.setFieldValue([...basePath, "fileName"] as never, parsed.fileName);
      form.setFieldValue([...basePath, "fileContentBase64"] as never, parsed.fileContentBase64);
      form.setFieldValue([...basePath, "value"] as never, "");
      form.setFields([
        { name: [...basePath, "fileContentBase64"] as never, errors: [] },
        { name: [...basePath, "value"] as never, errors: [] }
      ]);
      messageApi.success(
        `${label === "variable" ? "Variable" : "Secret"} file "${parsed.fileName}" loaded (${parsed.sizeBytes} bytes).`
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : `Could not import ${label} file.`);
    }
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 320 }}>
        <Spin />
      </Flex>
    );
  }

  if (mode === "edit" && (notFound || !repositoryId)) {
    return (
      <Result
        status="404"
        title="Repository not found"
        subTitle="The repository may have been deleted or you may not have access to it."
        extra={<Button onClick={() => router.push("/repositories")}>Back to Repositories</Button>}
      />
    );
  }

  if (mode === "edit" && loadError) {
    return (
      <Result
        status="error"
        title="Repository unavailable"
        subTitle={loadError}
        extra={<Button onClick={() => router.push("/repositories")}>Back to Repositories</Button>}
      />
    );
  }

  const title = mode === "edit" ? "Edit Repository" : "Add Repository";

  return (
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          setSubmitting(true);
          try {
            const normalized = normalizeValues(values);
            const envVars: RepositoryEnvVarInput[] = [];
            for (const entry of normalized.envVars) {
              const key = entry.key.trim();
              if (!key) {
                continue;
              }
              if (entry.type === "file") {
                const fileContentBase64 = entry.fileContentBase64.trim();
                const hasExistingFile = (editingRepository?.envVars ?? []).some(
                  (item) => item.key === key && item.type === "file" && item.configured === true
                );
                if (fileContentBase64.length > 0) {
                  envVars.push({
                    key,
                    type: "file",
                    ...(entry.fileName.trim().length > 0 ? { fileName: entry.fileName.trim() } : {}),
                    fileContentBase64
                  });
                } else if (hasExistingFile) {
                  envVars.push({ key, type: "file" });
                } else {
                  throw new Error(`Upload a file for variable "${key}".`);
                }
              } else {
                envVars.push({ key, type: "text", value: entry.value });
              }
            }
            const envSecrets: RepositoryEnvSecretInput[] = [];
            for (const entry of normalized.envSecrets) {
              const key = entry.key.trim();
              if (!key) {
                continue;
              }
              if (entry.type === "file") {
                const fileContentBase64 = entry.fileContentBase64.trim();
                const hasExistingFile = (editingRepository?.envSecrets ?? []).some(
                  (item) => item.key === key && item.type === "file" && item.configured === true
                );
                if (fileContentBase64.length > 0) {
                  envSecrets.push({
                    key,
                    type: "file",
                    ...(entry.fileName.trim().length > 0 ? { fileName: entry.fileName.trim() } : {}),
                    fileContentBase64
                  });
                } else if (hasExistingFile) {
                  envSecrets.push({ key, type: "file" });
                } else {
                  throw new Error(`Upload a file for secret "${key}".`);
                }
              } else {
                const hasExistingTextSecret = (editingRepository?.envSecrets ?? []).some(
                  (item) => item.key === key && (item.type ?? "text") === "text" && item.configured === true
                );
                if (entry.value.trim().length > 0) {
                  envSecrets.push({ key, type: "text", value: entry.value });
                } else if (hasExistingTextSecret) {
                  envSecrets.push({ key, type: "text" });
                } else {
                  throw new Error(`Value is required for secret "${key}".`);
                }
              }
            }
            const payload: CreateRepositoryInput = {
              name: normalized.name,
              url: normalized.url,
              defaultBranch: normalized.defaultBranch,
              envVars,
              envSecrets,
              webhookEnabled: normalized.webhookEnabled,
              webhookUrl: normalized.webhookUrl.trim().length > 0 ? normalized.webhookUrl.trim() : null,
              ...(normalized.webhookSecret.trim().length > 0 ? { webhookSecret: normalized.webhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearWebhookSecret ? { clearWebhookSecret: true } : {}),
              ...(normalized.githubPrWebhookSecret.trim().length > 0 ? { githubPrWebhookSecret: normalized.githubPrWebhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearGithubPrWebhookSecret ? { clearGithubPrWebhookSecret: true } : {}),
              githubIntegrationBotLogin: normalized.githubIntegrationBotLogin.trim().replace(/^@+/, "") || null,
              githubPrFeedbackInstructions:
                normalized.githubPrFeedbackInstructions.trim() === DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
                  ? null
                  : normalized.githubPrFeedbackInstructions.trim() || null
            };
            if (mode === "edit" && editingRepository) {
              await api.updateRepository(editingRepository.id, payload);
            } else {
              await api.createRepository(payload);
            }
            trackEvent("repository_saved", { mode, entry_point: entryPoint });
            router.push(`/repositories?saved=${mode === "edit" ? "updated" : "created"}`);
          } catch (error) {
            trackEvent("repository_save_failed", { mode, entry_point: entryPoint });
            messageApi.error(error instanceof Error ? error.message : "Failed to save repository");
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
              <Typography.Text type="secondary">Manage reusable repository definitions for task creation.</Typography.Text>
            </Flex>
            <Space wrap>
              <Button onClick={goBack}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {mode === "edit" ? "Save" : "Create"}
              </Button>
            </Space>
          </Flex>

          <Card bordered={false}>
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
                    Applies to both Codex and Claude runs for this repository. Choose Text for normal values, or File to upload files up to{" "}
                    {REPOSITORY_ENV_FILE_MAX_BYTES} bytes.
                  </Typography.Text>
                  {fields.map((field) => {
                    const keyName = String(form.getFieldValue(["envVars", field.name, "key"]) ?? "").trim();
                    const entryType = form.getFieldValue(["envVars", field.name, "type"]) === "file" ? "file" : "text";
                    const hasUploadedFile =
                      String(form.getFieldValue(["envVars", field.name, "fileContentBase64"]) ?? "").trim().length > 0;
                    const existingFileConfigured = (editingRepository?.envVars ?? []).some(
                      (entry) => entry.key === keyName && entry.type === "file" && entry.configured === true
                    );
                    const fileStatus = hasUploadedFile
                      ? "File ready"
                      : existingFileConfigured
                        ? "File set"
                        : "No file uploaded";
                    return (
                      <Flex key={field.key} gap={8} align="flex-start" wrap="wrap">
                        <Form.Item
                          {...field}
                          name={[field.name, "key"]}
                          style={{ flex: 1, marginBottom: 0, minWidth: 220 }}
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
                          name={[field.name, "type"]}
                          style={{ width: 120, marginBottom: 0 }}
                          initialValue="text"
                        >
                          <Select
                            options={[
                              { label: "Text", value: "text" },
                              { label: "File", value: "file" }
                            ]}
                          />
                        </Form.Item>
                        {entryType === "text" ? (
                          <Form.Item
                            {...field}
                            name={[field.name, "value"]}
                            style={{ flex: 2, marginBottom: 0, minWidth: 220 }}
                            rules={[{ max: 8192, message: "Value must be 8192 characters or fewer." }]}
                          >
                            <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder="value" autoComplete="off" />
                          </Form.Item>
                        ) : (
                          <Flex vertical style={{ minWidth: 260 }}>
                            <Space wrap>
                              <Upload
                                accept={ENV_VALUE_FILE_ACCEPT}
                                showUploadList={false}
                                maxCount={1}
                                beforeUpload={(file) => {
                                  void importFileValue(["envVars", field.name], file, "variable");
                                  return false;
                                }}
                              >
                                <Button>Upload file</Button>
                              </Upload>
                              <Button
                                onClick={() => {
                                  form.setFieldValue(["envVars", field.name, "fileName"], "");
                                  form.setFieldValue(["envVars", field.name, "fileContentBase64"], "");
                                }}
                              >
                                Clear file
                              </Button>
                            </Space>
                            <Typography.Text type="secondary">{fileStatus}</Typography.Text>
                            <Form.Item {...field} name={[field.name, "fileName"]} style={{ display: "none", marginBottom: 0 }}>
                              <Input />
                            </Form.Item>
                            <Form.Item {...field} name={[field.name, "fileContentBase64"]} style={{ display: "none", marginBottom: 0 }}>
                              <Input />
                            </Form.Item>
                          </Flex>
                        )}
                        <Button danger onClick={() => remove(field.name)}>
                          Remove
                        </Button>
                      </Flex>
                    );
                  })}
                  <Button onClick={() => add({ key: "", type: "text", value: "", fileName: "", fileContentBase64: "" })}>Add variable</Button>
                  <Form.ErrorList errors={errors} />
                </Flex>
              )}
            </Form.List>
            <Form.List
              name="envSecrets"
              rules={[
                {
                  validator: async (_, value: RepositoryFormValues["envSecrets"]) => {
                    const seen = new Set<string>();
                    for (const entry of value ?? []) {
                      const key = typeof entry?.key === "string" ? entry.key.trim() : "";
                      if (!key) {
                        continue;
                      }
                      if (seen.has(key)) {
                        throw new Error(`Duplicate secret name: ${key}`);
                      }
                      seen.add(key);
                    }
                  }
                }
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                  <Typography.Text strong>Environment Secrets</Typography.Text>
                  <Typography.Text type="secondary">
                    Applies to both Codex and Claude runs for this repository. Secret values are write-only after save. Existing values are never shown.
                    Choose Text or File. Leave Text blank to keep an existing text secret, or keep File mode without a new upload to keep an existing file
                    secret.
                  </Typography.Text>
                  {fields.map((field) => {
                    const keyName = String(form.getFieldValue(["envSecrets", field.name, "key"]) ?? "").trim();
                    const entryType = form.getFieldValue(["envSecrets", field.name, "type"]) === "file" ? "file" : "text";
                    const configuredTextSecret = (editingRepository?.envSecrets ?? []).some(
                      (entry) => entry.key === keyName && entry.configured === true && (entry.type ?? "text") === "text"
                    );
                    const configuredFileSecret = (editingRepository?.envSecrets ?? []).some(
                      (entry) => entry.key === keyName && entry.configured === true && entry.type === "file"
                    );
                    const hasUploadedFile =
                      String(form.getFieldValue(["envSecrets", field.name, "fileContentBase64"]) ?? "").trim().length > 0;
                    return (
                      <Flex key={field.key} gap={8} align="flex-start" wrap="wrap">
                        <Form.Item
                          {...field}
                          name={[field.name, "key"]}
                          style={{ flex: 1, marginBottom: 0, minWidth: 220 }}
                          rules={[
                            { required: true, whitespace: true, message: "Name is required." },
                            { max: 128, message: "Name must be 128 characters or fewer." },
                            {
                              pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
                              message: "Name must match /^[A-Za-z_][A-Za-z0-9_]*$/."
                            }
                          ]}
                        >
                          <Input placeholder="SECRET_NAME" autoComplete="off" />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "type"]}
                          style={{ width: 120, marginBottom: 0 }}
                          initialValue="text"
                        >
                          <Select
                            options={[
                              { label: "Text", value: "text" },
                              { label: "File", value: "file" }
                            ]}
                          />
                        </Form.Item>
                        {entryType === "text" ? (
                          <Form.Item
                            {...field}
                            name={[field.name, "value"]}
                            style={{ flex: 2, marginBottom: 0, minWidth: 220 }}
                            rules={[{ max: 8192, message: "Value must be 8192 characters or fewer." }]}
                          >
                            <Input.TextArea
                              autoSize={{ minRows: 1, maxRows: 4 }}
                              placeholder={configuredTextSecret ? "Secret is set. Enter a value to replace it." : "secret value"}
                              autoComplete="new-password"
                            />
                          </Form.Item>
                        ) : (
                          <Flex vertical style={{ minWidth: 260 }}>
                            <Space wrap>
                              <Upload
                                accept={ENV_VALUE_FILE_ACCEPT}
                                showUploadList={false}
                                maxCount={1}
                                beforeUpload={(file) => {
                                  void importFileValue(["envSecrets", field.name], file, "secret");
                                  return false;
                                }}
                              >
                                <Button>Upload file</Button>
                              </Upload>
                              <Button
                                onClick={() => {
                                  form.setFieldValue(["envSecrets", field.name, "fileName"], "");
                                  form.setFieldValue(["envSecrets", field.name, "fileContentBase64"], "");
                                }}
                              >
                                Clear file
                              </Button>
                            </Space>
                            <Typography.Text type="secondary">
                              {hasUploadedFile ? "File ready" : configuredFileSecret ? "File set" : "No file uploaded"}
                            </Typography.Text>
                            <Form.Item {...field} name={[field.name, "fileName"]} style={{ display: "none", marginBottom: 0 }}>
                              <Input />
                            </Form.Item>
                            <Form.Item {...field} name={[field.name, "fileContentBase64"]} style={{ display: "none", marginBottom: 0 }}>
                              <Input />
                            </Form.Item>
                          </Flex>
                        )}
                        <Button danger onClick={() => remove(field.name)}>
                          Remove
                        </Button>
                        {entryType === "text" && configuredTextSecret ? <Typography.Text type="secondary">Secret set</Typography.Text> : null}
                        {entryType === "file" && configuredFileSecret ? <Typography.Text type="secondary">Secret file set</Typography.Text> : null}
                      </Flex>
                    );
                  })}
                  <Button onClick={() => add({ key: "", type: "text", value: "", fileName: "", fileContentBase64: "" })}>Add secret</Button>
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
              label={editingRepository?.webhookSecretConfigured ? "Webhook Secret (leave blank to keep existing)" : "Webhook Secret"}
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
                    if (editingRepository?.webhookSecretConfigured && !clearSecret) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("Webhook secret is required when webhooks are enabled."));
                  }
                })
              ]}
            >
              <Input.Password />
            </Form.Item>
            {editingRepository?.webhookSecretConfigured ? (
              <Form.Item name="clearWebhookSecret" valuePropName="checked">
                <Checkbox>Clear stored webhook secret</Checkbox>
              </Form.Item>
            ) : null}
          </Card>
          <Card bordered={false}>
            <Flex vertical gap={12}>
              <Flex vertical gap={4}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Github Integration
                </Typography.Title>
                <Typography.Text type="secondary">
                  Connect GitHub pull request activity with linked AgentSwarm tasks.
                </Typography.Text>
              </Flex>
              {mode === "edit" && editingRepository ? (
                <>
                  <Form.Item label="Payload URL">
                    <Input
                      readOnly
                      value={buildApiUrl(`/github/webhooks/${editingRepository.id}`)}
                      addonAfter={
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            void navigator.clipboard.writeText(buildApiUrl(`/github/webhooks/${editingRepository.id}`));
                            messageApi.success("Webhook URL copied");
                          }}
                        >
                          Copy
                        </Button>
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    name="githubPrWebhookSecret"
                    label={
                      editingRepository.githubPrWebhookSecretConfigured
                        ? "Github Webhook Secret (leave blank to keep existing)"
                        : "Github Webhook Secret"
                    }
                  >
                    <Input.Password />
                  </Form.Item>
                  {editingRepository.githubPrWebhookSecretConfigured ? (
                    <Form.Item name="clearGithubPrWebhookSecret" valuePropName="checked">
                      <Checkbox>Clear stored Github webhook secret</Checkbox>
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    name="githubIntegrationBotLogin"
                    label="Ignored Github Bot User"
                    tooltip="Comments from this GitHub login are ignored by the PR feedback webhook to prevent reply loops."
                    rules={[{ max: 255, message: "Login must be 255 characters or fewer." }]}
                  >
                    <Input placeholder="agentswarm-bot" addonBefore="@" autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="githubPrFeedbackInstructions"
                    label="Agent Feedback Instructions"
                    extra="Appended to GitHub feedback prompts after the raw feedback body. Reset or leave as the default to use the built-in behavior."
                    rules={[{ max: 4000, message: "Instructions must be 4000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 5, maxRows: 10 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("githubPrFeedbackInstructions", DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS);
                    }}
                  >
                    Reset feedback instructions
                  </Button>
                  <Alert
                    type="info"
                    showIcon
                    message="Pull request flow"
                    description={
                      <Space direction="vertical" size={4}>
                        <Typography.Text>
                          1. Keep GitHub MCP available to agents so they can create pull requests.
                        </Typography.Text>
                        <Typography.Text>
                          2. AgentSwarm MCP is connected to agents automatically. After creating a PR, agents call{" "}
                          <Typography.Text code>agentswarm_link_pull_request</Typography.Text> with:
                        </Typography.Text>
                        <Typography.Text code>{`{ "taskId": "task_id", "prNumber": 123 }`}</Typography.Text>
                        <Typography.Text>
                          3. In GitHub, create a webhook with content type <Typography.Text code>application/json</Typography.Text>, this payload URL,
                          this secret, and events: issue comments, pull request review comments, pull request reviews.
                        </Typography.Text>
                      </Space>
                    }
                  />
                </>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="Save the repository first"
                  description="After creation, AgentSwarm will show the repository-scoped Github webhook URL and webhook secret setup."
                />
              )}
            </Flex>
          </Card>
        </Flex>
      </Form>
    </>
  );
}
