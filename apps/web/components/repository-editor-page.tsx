"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CreateRepositoryInput,
  GitHubAutomationRule,
  Repository,
  RepositoryEnvSecretInput
} from "@agentswarm/shared-types";
import { Button, Card, Checkbox, Flex, Form, Input, Result, Space, Spin, Switch, Typography, message } from "antd";
import { ApiError, api } from "../src/api/client";
import { buildApiUrl } from "../src/lib/public-url";
import { trackEvent } from "../src/utils/analytics";

interface RepositoryEditorPageProps {
  mode: "create" | "edit";
  repositoryId?: string;
}

type RepositoryFormValues = {
  name: string;
  url: string;
  defaultBranch: string;
  envVars: Array<{ key: string; value: string }>;
  envSecrets: Array<{ key: string; value: string }>;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
  clearWebhookSecret: boolean;
  githubWebhookSecret: string;
  clearGithubWebhookSecret: boolean;
  githubAutomationsJson: string;
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
  githubWebhookSecret: "",
  clearGithubWebhookSecret: false,
  githubAutomationsJson: "[]"
});

const normalizeValues = (values?: Partial<RepositoryFormValues> | null): RepositoryFormValues => ({
  name: typeof values?.name === "string" ? values.name : "",
  url: typeof values?.url === "string" ? values.url : "",
  defaultBranch: typeof values?.defaultBranch === "string" ? values.defaultBranch : "develop",
  envVars: (values?.envVars ?? []).map((entry) => ({
    key: typeof entry?.key === "string" ? entry.key : "",
    value: typeof entry?.value === "string" ? entry.value : ""
  })),
  envSecrets: (values?.envSecrets ?? []).map((entry) => ({
    key: typeof entry?.key === "string" ? entry.key : "",
    value: typeof entry?.value === "string" ? entry.value : ""
  })),
  webhookEnabled: values?.webhookEnabled === true,
  webhookUrl: typeof values?.webhookUrl === "string" ? values.webhookUrl : "",
  webhookSecret: typeof values?.webhookSecret === "string" ? values.webhookSecret : "",
  clearWebhookSecret: values?.clearWebhookSecret === true,
  githubWebhookSecret: typeof values?.githubWebhookSecret === "string" ? values.githubWebhookSecret : "",
  clearGithubWebhookSecret: values?.clearGithubWebhookSecret === true,
  githubAutomationsJson: typeof values?.githubAutomationsJson === "string" ? values.githubAutomationsJson : "[]"
});

const snapshotValues = (values?: Partial<RepositoryFormValues> | null): string => JSON.stringify(normalizeValues(values));

const isGitHubAutomationRule = (value: unknown): value is GitHubAutomationRule => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    return false;
  }
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return false;
  }
  if (record.trigger !== "issue_opened" && record.trigger !== "pull_request_opened") {
    return false;
  }
  return typeof record.task === "object" && record.task !== null;
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
  const githubWebhookUrl = editingRepository ? buildApiUrl(`/webhooks/github/${encodeURIComponent(editingRepository.id)}`) : null;

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
          envVars: repository.envVars ?? [],
          envSecrets: (repository.envSecrets ?? []).map((entry) => ({
            key: entry.key,
            value: ""
          })),
          webhookEnabled: repository.webhookEnabled,
          webhookUrl: repository.webhookUrl ?? "",
          webhookSecret: "",
          clearWebhookSecret: false,
          githubWebhookSecret: "",
          clearGithubWebhookSecret: false,
          githubAutomationsJson: JSON.stringify(repository.githubAutomations ?? [], null, 2)
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
            const envVars = normalized.envVars
              .map((entry) => ({
                key: entry.key.trim(),
                value: entry.value
              }))
              .filter((entry) => entry.key.length > 0);
            const envSecrets: RepositoryEnvSecretInput[] = [];
            for (const entry of normalized.envSecrets) {
              const key = entry.key.trim();
              if (!key) {
                continue;
              }
              const value = entry.value.trim();
              if (value.length > 0) {
                envSecrets.push({ key, value });
              } else {
                envSecrets.push({ key });
              }
            }
            let githubAutomations: GitHubAutomationRule[] = [];
            if (normalized.githubAutomationsJson.trim().length > 0) {
              const parsed = JSON.parse(normalized.githubAutomationsJson);
              if (!Array.isArray(parsed)) {
                throw new Error("GitHub automations must be a JSON array.");
              }
              if (!parsed.every(isGitHubAutomationRule)) {
                throw new Error("Each GitHub automation must include id, name, trigger, and task.");
              }
              githubAutomations = parsed;
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
              ...(normalized.githubWebhookSecret.trim().length > 0 ? { githubWebhookSecret: normalized.githubWebhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearGithubWebhookSecret ? { clearGithubWebhookSecret: true } : {}),
              githubAutomations
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
                    Repository variables are injected into interactive, automatic, and terminal runs for tasks from this repository.
                  </Typography.Text>
                  {fields.map((field) => (
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
                        name={[field.name, "value"]}
                        style={{ flex: 2, marginBottom: 0, minWidth: 220 }}
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
                    Secret values are write-only. Existing values are never shown. Leave the value blank to keep a configured secret.
                  </Typography.Text>
                  {fields.map((field) => {
                    const keyName = String(form.getFieldValue(["envSecrets", field.name, "key"]) ?? "").trim();
                    const configured = (editingRepository?.envSecrets ?? []).some(
                      (entry) => entry.key === keyName && entry.configured === true
                    );
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
                          name={[field.name, "value"]}
                          style={{ flex: 2, marginBottom: 0, minWidth: 220 }}
                          dependencies={[["envSecrets", field.name, "key"]]}
                          rules={[
                            { max: 8192, message: "Value must be 8192 characters or fewer." },
                            () => ({
                              validator(_, value) {
                                const normalized = typeof value === "string" ? value.trim() : "";
                                if (!keyName || normalized.length > 0 || configured) {
                                  return Promise.resolve();
                                }
                                return Promise.reject(new Error("Value is required for new secrets."));
                              }
                            })
                          ]}
                        >
                          <Input.Password
                            placeholder={configured ? "Secret is set. Enter a value to replace it." : "secret value"}
                            autoComplete="new-password"
                          />
                        </Form.Item>
                        <Button danger onClick={() => remove(field.name)}>
                          Remove
                        </Button>
                        {configured ? <Typography.Text type="secondary">Secret set</Typography.Text> : null}
                      </Flex>
                    );
                  })}
                  <Button onClick={() => add({ key: "", value: "" })}>Add secret</Button>
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
            <Form.Item
              name="githubWebhookSecret"
              label={editingRepository?.githubWebhookSecretConfigured ? "GitHub Webhook Secret (leave blank to keep existing)" : "GitHub Webhook Secret"}
            >
              <Input.Password placeholder="Optional but recommended for signature verification" />
            </Form.Item>
            {editingRepository?.githubWebhookSecretConfigured ? (
              <Form.Item name="clearGithubWebhookSecret" valuePropName="checked">
                <Checkbox>Clear stored GitHub webhook secret</Checkbox>
              </Form.Item>
            ) : null}
            <Form.Item label="GitHub Webhook URL">
              {githubWebhookUrl ? (
                <Typography.Text code copyable>
                  {githubWebhookUrl}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  Save this repository first to generate its webhook URL.
                </Typography.Text>
              )}
            </Form.Item>
            <Form.Item
              name="githubAutomationsJson"
              label="GitHub Automations (JSON rules)"
              rules={[
                {
                  validator: async (_, value) => {
                    const text = typeof value === "string" ? value.trim() : "";
                    if (!text) {
                      return;
                    }
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) {
                      throw new Error("GitHub automations must be a JSON array.");
                    }
                  }
                }
              ]}
              extra='Example trigger with label filter: [{"id":"bug-opened","name":"Bug Issue","enabled":true,"trigger":"issue_opened","labelFilter":{"labelsAny":["bug"],"labelsNone":["wip"]},"task":{"taskType":"build","startMode":"run_now"}}]'
            >
              <Input.TextArea rows={10} />
            </Form.Item>
          </Card>
        </Flex>
      </Form>
    </>
  );
}
