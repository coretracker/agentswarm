"use client";

import { useEffect, useState } from "react";
import type {
  AgentProvider,
  AgentClarifyBehavior,
  AgentCodePreference,
  AgentExplanationDepth,
  AgentFormattingStyle,
  AgentJargonLevel,
  AudienceType,
  PermissionScope,
  ProviderModelOption,
  ProviderProfile,
  ResponsePreferencePreset,
  Role,
  SystemSettings
} from "@agentswarm/shared-types";
import {
  PERMISSION_SCOPE_GROUPS,
  getAgentProviderLabel,
  getEffortOptionsForProvider,
  getModelsForProvider
} from "@agentswarm/shared-types";
import { DeleteOutlined, LockOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography
} from "antd";
import { api } from "../src/api/client";
import { useSettings } from "../src/hooks/useSettings";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useAuth } from "./auth-provider";
import { ModelSelect } from "./model-select";

interface GeneralSettingsForm {
  defaultProvider: AgentProvider;
  maxAgents: number;
  branchPrefix: string;
  gitUsername: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  openaiBaseUrl: string;
  taskPromptMagicModel: string;
  taskPromptMagicTemplate: string;
  codexDefaultModel: string;
  codexModels: ProviderModelOption[];
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeModels: ProviderModelOption[];
  claudeDefaultEffort: ProviderProfile;
}

interface CredentialForm {
  githubToken?: string;
  openaiApiKey?: string;
  codexAuthJson?: string;
  anthropicApiKey?: string;
}

interface RoleFormValues {
  name: string;
  description: string;
  scopes: PermissionScope[];
  allowedProviders: AgentProvider[];
  allowedModels: string[];
  allowedEfforts: ProviderProfile[];
}

interface ResponsePreferencePresetFormValues {
  name: string;
  description: string;
  audience?: AudienceType;
  explanationDepth?: AgentExplanationDepth;
  jargonLevel?: AgentJargonLevel;
  codePreference?: AgentCodePreference;
  clarifyBehavior?: AgentClarifyBehavior;
  formattingStyle?: AgentFormattingStyle;
  extraInstructions?: string;
}

type ClearCredentialTarget = "github" | "openai" | "codexAuthJson" | "anthropic";
type SettingsTabKey = "runtime" | "models" | "connections" | "access" | "responses";
type DirtyGeneralTabKey = "runtime" | "models" | "connections";

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: getAgentProviderLabel("codex"), value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

const summarizeAllowlist = (label: string, values: string[]): string => `${label}: ${values.length === 0 ? "All" : values.join(", ")}`;
const toSentenceValue = (value: string): string => value.replace(/_/g, " ");
const normalizeProviderModelOptions = (models: ProviderModelOption[] | undefined, fallback: ProviderModelOption[]): ProviderModelOption[] => {
  const normalized: ProviderModelOption[] = [];
  const seen = new Set<string>();
  for (const model of models ?? []) {
    const value = model.value?.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    normalized.push({ label: model.label?.trim() || value, value });
    seen.add(value);
  }
  return normalized.length > 0 ? normalized : fallback;
};
const summarizeResponsePreference = (preset: ResponsePreferencePreset): string => {
  const parts: string[] = [];
  if (preset.preference.audience) {
    parts.push(`Audience: ${toSentenceValue(preset.preference.audience)}`);
  }
  if (preset.preference.explanationDepth) {
    parts.push(`Depth: ${toSentenceValue(preset.preference.explanationDepth)}`);
  }
  if (preset.preference.jargonLevel) {
    parts.push(`Jargon: ${toSentenceValue(preset.preference.jargonLevel)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "Neutral";
};

const toFormValues = (settings: SystemSettings): GeneralSettingsForm => ({
  defaultProvider: settings.defaultProvider,
  maxAgents: settings.maxAgents,
  branchPrefix: settings.branchPrefix,
  gitUsername: settings.gitUsername,
  gitAuthorName: settings.gitAuthorName ?? "",
  gitAuthorEmail: settings.gitAuthorEmail ?? "",
  openaiBaseUrl: settings.openaiBaseUrl ?? "",
  taskPromptMagicModel: settings.taskPromptMagicModel,
  taskPromptMagicTemplate: settings.taskPromptMagicTemplate,
  codexDefaultModel: settings.codexDefaultModel,
  codexModels: settings.codexModels,
  codexDefaultEffort: settings.codexDefaultEffort,
  claudeDefaultModel: settings.claudeDefaultModel,
  claudeModels: settings.claudeModels,
  claudeDefaultEffort: settings.claudeDefaultEffort
});

export function SettingsPage() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const { loading, setSettings, settings } = useSettings();
  const [generalForm] = Form.useForm<GeneralSettingsForm>();
  const [credentialForm] = Form.useForm<CredentialForm>();
  const [roleForm] = Form.useForm<RoleFormValues>();
  const [responsePreferencePresetForm] = Form.useForm<ResponsePreferencePresetFormValues>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [autoFillingProvider, setAutoFillingProvider] = useState<AgentProvider | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [savingResponsePreferencePreset, setSavingResponsePreferencePreset] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [responsePreferencePresetModalOpen, setResponsePreferencePresetModalOpen] = useState(false);
  const [editingResponsePreferencePreset, setEditingResponsePreferencePreset] = useState<ResponsePreferencePreset | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("runtime");
  const [generalDirty, setGeneralDirty] = useState(false);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [generalDirtyTabs, setGeneralDirtyTabs] = useState<DirtyGeneralTabKey[]>([]);
  const canEditSettings = can("settings:edit");
  const { models: codexModels, loading: codexModelsLoading, source: codexModelsSource } = useProviderModels("codex");
  const { models: claudeModels, loading: claudeModelsLoading, source: claudeModelsSource } = useProviderModels("claude");
  const codexModelFormValues = Form.useWatch("codexModels", generalForm);
  const claudeModelFormValues = Form.useWatch("claudeModels", generalForm);
  const codexDefaultModelOptions = normalizeProviderModelOptions(codexModelFormValues, codexModels);
  const claudeDefaultModelOptions = normalizeProviderModelOptions(claudeModelFormValues, claudeModels);
  const allModelOptions = Array.from(
    new Map(
      [...codexModels, ...claudeModels, ...getModelsForProvider("codex"), ...getModelsForProvider("claude")].map((option) => [option.value, option])
    ).values()
  ).sort((left, right) => left.label.localeCompare(right.label));
  const allEffortOptions = Array.from(
    new Map(
      [...getEffortOptionsForProvider("codex"), ...getEffortOptionsForProvider("claude")].map((option) => [option.value, option])
    ).values()
  );
  const responsePreferencePresets = settings?.responsePreferencePresets ?? [];

  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      setRoles(await api.listRoles());
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    if (!settings) {
      return;
    }

    generalForm.setFieldsValue(toFormValues(settings));
    setGeneralDirty(false);
    setGeneralDirtyTabs([]);
  }, [generalForm, settings]);

  const hasUnsavedChanges = generalDirty || credentialsDirty;

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

  useEffect(() => {
    void loadRoles();
  }, []);

  const handleAutoFillModels = async (provider: AgentProvider): Promise<void> => {
    setAutoFillingProvider(provider);
    try {
      const response = await api.listModels(provider, { refresh: true });
      const fallback = getModelsForProvider(provider);
      const models = normalizeProviderModelOptions(response.models, fallback);
      if (provider === "codex") {
        generalForm.setFieldValue("codexModels", models);
        if (!models.some((model) => model.value === generalForm.getFieldValue("codexDefaultModel"))) {
          generalForm.setFieldValue("codexDefaultModel", models[0]?.value ?? fallback[0]?.value);
        }
      } else {
        generalForm.setFieldValue("claudeModels", models);
        if (!models.some((model) => model.value === generalForm.getFieldValue("claudeDefaultModel"))) {
          generalForm.setFieldValue("claudeDefaultModel", models[0]?.value ?? fallback[0]?.value);
        }
      }
      message.success(response.source === "api" ? "Models fetched from provider" : "Using saved or built-in model list");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to fetch provider models");
    } finally {
      setAutoFillingProvider(null);
    }
  };

  const handleClearCredential = async (target: ClearCredentialTarget): Promise<void> => {
    setSavingCredentials(true);
    try {
      if (target === "github") {
        const nextSettings = await api.updateCredentials({ clearGithubToken: true });
        setSettings(nextSettings);
        credentialForm.resetFields(["githubToken"]);
        message.success("GitHub token cleared");
        return;
      }

      if (target === "openai") {
        const nextSettings = await api.updateCredentials({ clearOpenAiApiKey: true });
        setSettings(nextSettings);
        credentialForm.resetFields(["openaiApiKey"]);
        message.success("OpenAI API key cleared");
        return;
      }

      if (target === "codexAuthJson") {
        const nextSettings = await api.updateCredentials({ clearCodexAuthJson: true });
        setSettings(nextSettings);
        credentialForm.resetFields(["codexAuthJson"]);
        message.success("Codex auth.json cleared");
        return;
      }

      const nextSettings = await api.updateCredentials({ clearAnthropicApiKey: true });
      setSettings(nextSettings);
      credentialForm.resetFields(["anthropicApiKey"]);
      message.success("Anthropic API key cleared");
    } catch (error) {
      if (target === "github") {
        message.error(error instanceof Error ? error.message : "Failed to clear GitHub token");
        return;
      }

      if (target === "openai") {
        message.error(error instanceof Error ? error.message : "Failed to clear OpenAI API key");
        return;
      }

      if (target === "codexAuthJson") {
        message.error(error instanceof Error ? error.message : "Failed to clear Codex auth.json");
        return;
      }

      message.error(error instanceof Error ? error.message : "Failed to clear Anthropic API key");
    } finally {
      setSavingCredentials(false);
    }
  };

  const renderProviderModelsEditor = (
    provider: AgentProvider,
    fieldName: "codexModels" | "claudeModels",
    canAutoFill: boolean
  ) => (
    <Form.List name={fieldName}>
      {(fields, { add, remove }) => (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Model list"
            description={
              canAutoFill
                ? "Use Auto-fill to fetch every model available to the configured API key, or edit this list by hand."
                : "Add models by hand, or configure the provider API key to auto-fill all available models."
            }
          />
          <Flex justify="space-between" align="center" gap={8} wrap="wrap">
            <Typography.Text type="secondary">These models are used in task create and edit model selectors.</Typography.Text>
            <Tooltip title={canAutoFill ? "Fetch available models from the provider" : "Configure the provider API key to enable auto-fill"}>
              <Button
                icon={<ReloadOutlined />}
                loading={autoFillingProvider === provider}
                disabled={!canAutoFill}
                onClick={() => void handleAutoFillModels(provider)}
              >
                Auto-fill
              </Button>
            </Tooltip>
          </Flex>
          {fields.map((field) => (
            <Flex key={field.key} gap={8} align="flex-start" wrap="wrap">
              <Form.Item
                name={[field.name, "label"]}
                label={field.name === 0 ? "Title" : undefined}
                rules={[{ required: true, whitespace: true, message: "Enter a title" }]}
                style={{ flex: "1 1 220px", marginBottom: 0 }}
              >
                <Input placeholder="GPT-5.5" />
              </Form.Item>
              <Form.Item
                name={[field.name, "value"]}
                label={field.name === 0 ? "Value" : undefined}
                rules={[{ required: true, whitespace: true, message: "Enter a model value" }]}
                style={{ flex: "1 1 260px", marginBottom: 0 }}
              >
                <Input placeholder="gpt-5.5" />
              </Form.Item>
              <Button
                aria-label="Remove model"
                icon={<DeleteOutlined />}
                style={{ marginTop: field.name === 0 ? 30 : 0 }}
                onClick={() => remove(field.name)}
              />
            </Flex>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => add({ label: "", value: "" })}
            style={{ width: "100%" }}
          >
            Add model
          </Button>
        </Space>
      )}
    </Form.List>
  );

  const saveGeneralSettings = async (values: GeneralSettingsForm): Promise<void> => {
    setSavingGeneral(true);
    try {
      const nextSettings = await api.updateSettings({
        defaultProvider: values.defaultProvider,
        maxAgents: values.maxAgents,
        branchPrefix: values.branchPrefix,
        gitUsername: values.gitUsername,
        gitAuthorName: values.gitAuthorName?.trim() || null,
        gitAuthorEmail: values.gitAuthorEmail?.trim() || null,
        openaiBaseUrl: values.openaiBaseUrl?.trim() ? values.openaiBaseUrl.trim() : null,
        taskPromptMagicModel: values.taskPromptMagicModel,
        taskPromptMagicTemplate: values.taskPromptMagicTemplate,
        codexDefaultModel: values.codexDefaultModel,
        codexModels: values.codexModels,
        codexDefaultEffort: values.codexDefaultEffort,
        claudeDefaultModel: values.claudeDefaultModel,
        claudeModels: values.claudeModels,
        claudeDefaultEffort: values.claudeDefaultEffort
      });
      setSettings(nextSettings);
      setGeneralDirty(false);
      setGeneralDirtyTabs([]);
      message.success("Settings saved");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSavingGeneral(false);
    }
  };

  const markGeneralTabDirty = (tab: DirtyGeneralTabKey) => {
    setGeneralDirty(true);
    setGeneralDirtyTabs((current) => (current.includes(tab) ? current : [...current, tab]));
  };

  const confirmLeave = (): boolean => {
    if (!hasUnsavedChanges || typeof window === "undefined") {
      return true;
    }
    return window.confirm("Discard unsaved changes?");
  };

  const handleTabChange = (nextTab: SettingsTabKey) => {
    if (nextTab === activeTab) {
      return;
    }
    if (hasUnsavedChanges && !confirmLeave()) {
      return;
    }
    setActiveTab(nextTab);
  };

  const renderSaveBar = (options: { dirty: boolean; label: string; loading: boolean; statusText?: string }) => (
    <Card
      size="small"
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 20,
        marginTop: 16
      }}
      styles={{ body: { padding: 12 } }}
    >
      <Flex justify="space-between" align="center" gap={12} wrap="wrap">
        <Typography.Text type="secondary">
          {options.statusText ?? (options.dirty ? "Unsaved changes" : "All changes saved")}
        </Typography.Text>
        <Button type="primary" htmlType="submit" loading={options.loading} disabled={!canEditSettings || !options.dirty}>
          {options.label}
        </Button>
      </Flex>
    </Card>
  );

  const tabItems: Array<{ key: SettingsTabKey; label: React.ReactNode }> = [
    {
      key: "runtime",
      label: <span>{generalDirtyTabs.includes("runtime") ? "Runtime *" : "Runtime"}</span>
    },
    {
      key: "models",
      label: <span>{generalDirtyTabs.includes("models") ? "Models *" : "Models"}</span>
    },
    {
      key: "connections",
      label: <span>{generalDirtyTabs.includes("connections") || credentialsDirty ? "Connections *" : "Connections"}</span>
    },
    {
      key: "access",
      label: "Access"
    },
    {
      key: "responses",
      label: "Response Presets"
    }
  ];

  return (
    <>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Settings
          </Typography.Title>
          <Typography.Text type="secondary">
            Configure how agents run, connect providers, and manage access.
          </Typography.Text>
        </Flex>

        {!canEditSettings ? (
          <Alert
            type="info"
            showIcon
            message="Read-only access"
            description="This account can view system configuration and roles, but it cannot change them."
          />
        ) : null}

        <Tabs activeKey={activeTab} onChange={(value) => handleTabChange(value as SettingsTabKey)} items={tabItems} />

        {activeTab === "runtime" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("runtime")}
            onFinish={saveGeneralSettings}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card bordered={false} loading={loading} title="Runtime Defaults">
                <Flex vertical gap={16} style={{ width: "100%" }}>
                  <Form.Item name="defaultProvider" label="Default Provider" rules={[{ required: true }]}>
                    <Select options={providerOptions} />
                  </Form.Item>
                  <Form.Item
                    name="maxAgents"
                    label="Concurrent Agents"
                    extra="Limits how many task containers can run at the same time."
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={1} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name="branchPrefix" label="Feature Branch Prefix" rules={[{ required: true, whitespace: true }]}>
                    <Input placeholder="agentswarm" />
                  </Form.Item>
                  <Form.Item
                    name="taskPromptMagicModel"
                    label="Task Prompt Magic Model"
                    extra="Model used by the Magic Prompt helper in task creation."
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="gpt-5.4-mini" />
                  </Form.Item>
                  <Form.Item
                    name="taskPromptMagicTemplate"
                    label="Task Prompt Magic Template"
                    extra="Use {{user_request}} as the placeholder for the user's current text."
                    style={{ marginBottom: 0 }}
                  >
                    <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} placeholder="Template with {{user_request}} placeholder" />
                  </Form.Item>
                </Flex>
              </Card>

              <Card bordered={false} loading={loading} title="Default Effort">
                <Flex vertical gap={16} style={{ width: "100%" }}>
                  <Form.Item name="codexDefaultEffort" label="Codex Default Effort" style={{ marginBottom: 0 }}>
                    <Select options={getEffortOptionsForProvider("codex")} />
                  </Form.Item>
                  <Form.Item name="claudeDefaultEffort" label="Claude Default Effort" style={{ marginBottom: 0 }}>
                    <Select options={getEffortOptionsForProvider("claude")} />
                  </Form.Item>
                </Flex>
              </Card>
            </Space>
            {renderSaveBar({ dirty: generalDirty, label: "Save Runtime Defaults", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "models" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("models")}
            onFinish={saveGeneralSettings}
          >
            <Card bordered={false} loading={loading} title="Provider Models">
              <Flex vertical gap={24} style={{ width: "100%" }}>
                <div>
                  <Typography.Text strong>Codex (OpenAI)</Typography.Text>
                  <Flex vertical gap={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item
                      name="codexDefaultModel"
                      label="Default Model"
                      extra={
                        codexModelsSource === "cache"
                          ? "Model suggestions come from the saved Codex model list below."
                          : "Model suggestions use built-in defaults until you save a custom list."
                      }
                      style={{ marginBottom: 0 }}
                    >
                      <ModelSelect options={codexDefaultModelOptions} loading={codexModelsLoading} />
                    </Form.Item>
                    {renderProviderModelsEditor("codex", "codexModels", Boolean(settings?.openaiApiKeyConfigured))}
                  </Flex>
                </div>

                <div>
                  <Typography.Text strong>Claude Code (Anthropic)</Typography.Text>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 8 }}
                    message="Experimental"
                    description="Claude Code in AgentSwarm is experimental; behavior and defaults may change."
                  />
                  <Flex vertical gap={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item
                      name="claudeDefaultModel"
                      label="Default Model"
                      extra={
                        claudeModelsSource === "cache"
                          ? "Model suggestions come from the saved Claude model list below."
                          : "Model suggestions use built-in defaults until you save a custom list."
                      }
                      style={{ marginBottom: 0 }}
                    >
                      <ModelSelect options={claudeDefaultModelOptions} loading={claudeModelsLoading} />
                    </Form.Item>
                    {renderProviderModelsEditor("claude", "claudeModels", Boolean(settings?.anthropicApiKeyConfigured))}
                  </Flex>
                </div>
              </Flex>
            </Card>
            {renderSaveBar({ dirty: generalDirty, label: "Save Model Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "connections" ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Form
              form={generalForm}
              layout="vertical"
              disabled={!canEditSettings}
              onValuesChange={() => markGeneralTabDirty("connections")}
              onFinish={saveGeneralSettings}
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card bordered={false} loading={loading} title="Provider Connections">
                  <Flex vertical gap={16} style={{ width: "100%" }}>
                    <Form.Item
                      name="openaiBaseUrl"
                      label="OpenAI Base URL Override"
                      extra="Set when pointing AgentSwarm at a proxy or self-hosted gateway."
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                    <Form.Item
                      name="gitUsername"
                      label="Git Username"
                      extra="Used for authenticated GitHub HTTPS access from server Git actions and Codex or Claude runtimes."
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input placeholder="x-access-token" />
                    </Form.Item>
                    <Form.Item
                      name="gitAuthorName"
                      label="Git Author Name"
                      extra="Used for agent-created Git commits. Leave blank to use the system default."
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="AgentSwarm" />
                    </Form.Item>
                    <Form.Item
                      name="gitAuthorEmail"
                      label="Git Author Email"
                      extra="Used for agent-created Git commits. Leave blank to use the system default."
                      rules={[{ type: "email", message: "Enter a valid email address" }]}
                    >
                      <Input placeholder="agentswarm@example.com" />
                    </Form.Item>
                  </Flex>
                </Card>

              </Space>
              {renderSaveBar({ dirty: generalDirty, label: "Save Connection Settings", loading: savingGeneral })}
            </Form>

            <Card
              bordered={false}
              loading={loading}
              title="Credentials"
              extra={
                settings ? (
                  <Space wrap>
                    <Tag color={settings.githubTokenConfigured ? "green" : "default"}>
                      GitHub Token {settings.githubTokenConfigured ? "Configured" : "Missing"}
                    </Tag>
                    <Tag color={settings.openaiApiKeyConfigured ? "green" : "default"}>
                      OpenAI API Key {settings.openaiApiKeyConfigured ? "Configured" : "Missing"}
                    </Tag>
                    <Tag color={settings.codexAuthJsonConfigured ? "green" : "default"}>
                      Codex auth.json {settings.codexAuthJsonConfigured ? "Configured" : "Missing"}
                    </Tag>
                    <Tag color={settings.anthropicApiKeyConfigured ? "green" : "default"}>
                      Anthropic API Key {settings.anthropicApiKeyConfigured ? "Configured" : "Missing"}
                    </Tag>
                  </Space>
                ) : null
              }
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Credentials are write-only"
                description="Tokens are encrypted on the server and never returned by the API."
              />
              <Form
                form={credentialForm}
                layout="vertical"
                disabled={!canEditSettings}
                onValuesChange={() => setCredentialsDirty(true)}
                onFinish={async (values) => {
                  setSavingCredentials(true);
                  try {
                    const nextSettings = await api.updateCredentials({
                      githubToken: values.githubToken?.trim() || undefined,
                      openaiApiKey: values.openaiApiKey?.trim() || undefined,
                      codexAuthJson: values.codexAuthJson?.trim() || undefined,
                      anthropicApiKey: values.anthropicApiKey?.trim() || undefined
                    });
                    credentialForm.resetFields();
                    setSettings(nextSettings);
                    setCredentialsDirty(false);
                    message.success("Credentials updated");
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Failed to update credentials");
                  } finally {
                    setSavingCredentials(false);
                  }
                }}
              >
                <Form.Item
                  name="githubToken"
                  label="GitHub Token"
                  extra="Used for server pull/push/merge operations and for in-agent `git pull` / `git push` inside Codex and Claude task runtimes."
                >
                  <Input.Password placeholder={settings?.githubTokenConfigured ? "Configured. Enter a new token to replace it." : "github_pat_..."} />
                </Form.Item>
                <Form.Item name="openaiApiKey" label="OpenAI API Key">
                  <Input.Password placeholder={settings?.openaiApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-..."} />
                </Form.Item>
                <Form.Item
                  name="codexAuthJson"
                  label="Global Codex auth.json"
                  extra="Used as the Global Codex credential source and as the Auto fallback after profile auth.json."
                >
                  <Input.TextArea
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    placeholder={settings?.codexAuthJsonConfigured ? "Configured. Paste a new auth.json to replace it." : "{ ... }"}
                  />
                </Form.Item>
                <Form.Item
                  name="anthropicApiKey"
                  label="Anthropic API Key"
                  extra="Used for Claude Code (experimental) runs only."
                >
                  <Input.Password placeholder={settings?.anthropicApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-ant-..."} />
                </Form.Item>
                {renderSaveBar({
                  dirty: credentialsDirty,
                  label: "Save Credentials",
                  loading: savingCredentials,
                  statusText: credentialsDirty ? "Unsaved credential changes" : "No pending credential changes"
                })}
                <Space wrap>
                  <Popconfirm
                    title="Clear GitHub token?"
                    description="This removes the stored GitHub token from settings."
                    okText="Clear"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true, loading: savingCredentials }}
                    placement="top"
                    disabled={!canEditSettings}
                    onConfirm={() => handleClearCredential("github")}
                  >
                    <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                      Clear GitHub Token
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Clear OpenAI API key?"
                    description="This removes the stored OpenAI API key from settings."
                    okText="Clear"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true, loading: savingCredentials }}
                    placement="top"
                    disabled={!canEditSettings}
                    onConfirm={() => handleClearCredential("openai")}
                  >
                    <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                      Clear OpenAI API Key
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Clear Codex auth.json?"
                    description="This removes the stored global Codex auth.json from settings."
                    okText="Clear"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true, loading: savingCredentials }}
                    placement="top"
                    disabled={!canEditSettings}
                    onConfirm={() => handleClearCredential("codexAuthJson")}
                  >
                    <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                      Clear Codex auth.json
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Clear Anthropic API key?"
                    description="This removes the stored Anthropic API key from settings."
                    okText="Clear"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true, loading: savingCredentials }}
                    placement="top"
                    disabled={!canEditSettings}
                    onConfirm={() => handleClearCredential("anthropic")}
                  >
                    <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                      Clear Anthropic API Key
                    </Button>
                  </Popconfirm>
                </Space>
              </Form>
            </Card>
          </Space>
        ) : null}

        {activeTab === "access" ? (
          <Card
            bordered={false}
            loading={rolesLoading}
            title="Roles"
            extra={
              <Button
                type="primary"
                disabled={!canEditSettings}
                onClick={() => {
                  setEditingRole(null);
                  roleForm.setFieldsValue({
                    name: "",
                    description: "",
                    scopes: [],
                    allowedProviders: [],
                    allowedModels: [],
                    allowedEfforts: []
                  });
                  setRoleModalOpen(true);
                }}
              >
                Add Role
              </Button>
            }
          >
            <Table<Role>
              rowKey="id"
              pagination={false}
              dataSource={roles}
              columns={[
                {
                  title: "Name",
                  dataIndex: "name",
                  render: (value: string, role) => (
                    <Space>
                      <Typography.Text strong>{value}</Typography.Text>
                      {role.isSystem ? <Tag icon={<LockOutlined />}>System</Tag> : null}
                    </Space>
                  )
                },
                {
                  title: "Description",
                  dataIndex: "description",
                  render: (value: string) => value || <Typography.Text type="secondary">None</Typography.Text>
                },
                {
                  title: "Scopes",
                  render: (_, role) => (
                    <Space size={[4, 4]} wrap>
                      {role.scopes.map((scope) => (
                        <Tag key={scope}>{scope}</Tag>
                      ))}
                    </Space>
                  )
                },
                {
                  title: "Allowlists",
                  render: (_, role) => (
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">{summarizeAllowlist("Providers", role.allowedProviders)}</Typography.Text>
                      <Typography.Text type="secondary">{summarizeAllowlist("Models", role.allowedModels)}</Typography.Text>
                      <Typography.Text type="secondary">{summarizeAllowlist("Efforts", role.allowedEfforts)}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: "Actions",
                  render: (_, role) => (
                    <Space>
                      <Button
                        disabled={!canEditSettings || role.isSystem}
                        onClick={() => {
                          setEditingRole(role);
                          roleForm.setFieldsValue({
                            name: role.name,
                            description: role.description,
                            scopes: role.scopes,
                            allowedProviders: role.allowedProviders,
                            allowedModels: role.allowedModels,
                            allowedEfforts: role.allowedEfforts
                          });
                          setRoleModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        danger
                        disabled={!canEditSettings || role.isSystem}
                        onClick={async () => {
                          try {
                            await api.deleteRole(role.id);
                            message.success("Role deleted");
                            await loadRoles();
                          } catch (error) {
                            message.error(error instanceof Error ? error.message : "Failed to delete role");
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        ) : null}

        {activeTab === "responses" ? (
          <Card
            bordered={false}
            loading={loading}
            title="Response Preferences"
            extra={
              <Button
                type="primary"
                disabled={!canEditSettings}
                onClick={() => {
                  setEditingResponsePreferencePreset(null);
                  responsePreferencePresetForm.setFieldsValue({
                    name: "",
                    description: "",
                    audience: undefined,
                    explanationDepth: undefined,
                    jargonLevel: undefined,
                    codePreference: undefined,
                    clarifyBehavior: undefined,
                    formattingStyle: undefined,
                    extraInstructions: ""
                  });
                  setResponsePreferencePresetModalOpen(true);
                }}
              >
                Add Response Preference
              </Button>
            }
          >
            <Table<ResponsePreferencePreset>
              rowKey="id"
              pagination={false}
              dataSource={responsePreferencePresets}
              columns={[
                {
                  title: "Name",
                  dataIndex: "name",
                  render: (value: string, preset) => (
                    <Space>
                      <Typography.Text strong>{value}</Typography.Text>
                      {preset.isSystem ? <Tag icon={<LockOutlined />}>System</Tag> : null}
                    </Space>
                  )
                },
                {
                  title: "Description",
                  dataIndex: "description",
                  render: (value: string) => value || <Typography.Text type="secondary">None</Typography.Text>
                },
                {
                  title: "Policy",
                  render: (_, preset) => summarizeResponsePreference(preset)
                },
                {
                  title: "Actions",
                  render: (_, preset) => (
                    <Space>
                      <Button
                        disabled={!canEditSettings || preset.isSystem}
                        onClick={() => {
                          setEditingResponsePreferencePreset(preset);
                          responsePreferencePresetForm.setFieldsValue({
                            name: preset.name,
                            description: preset.description,
                            audience: preset.preference.audience,
                            explanationDepth: preset.preference.explanationDepth,
                            jargonLevel: preset.preference.jargonLevel,
                            codePreference: preset.preference.codePreference,
                            clarifyBehavior: preset.preference.clarifyBehavior,
                            formattingStyle: preset.preference.formattingStyle,
                            extraInstructions: preset.preference.extraInstructions ?? ""
                          });
                          setResponsePreferencePresetModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Popconfirm
                        title="Delete response preference?"
                        description={`Delete ${preset.name}?`}
                        disabled={!canEditSettings || preset.isSystem}
                        onConfirm={async () => {
                          if (!settings) {
                            return;
                          }
                          try {
                            const nextSettings = await api.updateSettings({
                              responsePreferencePresets: responsePreferencePresets.filter((entry) => entry.id !== preset.id)
                            });
                            setSettings(nextSettings);
                            message.success("Response preference deleted");
                          } catch (error) {
                            message.error(error instanceof Error ? error.message : "Failed to delete response preference");
                          }
                        }}
                      >
                        <Button danger disabled={!canEditSettings || preset.isSystem}>
                          Delete
                        </Button>
                      </Popconfirm>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        ) : null}
      </Space>

      <Modal
        open={roleModalOpen}
        title={editingRole ? `Edit Role: ${editingRole.name}` : "Add Role"}
        footer={null}
        onCancel={() => setRoleModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={roleForm}
          layout="vertical"
          onFinish={async (values) => {
            setSavingRole(true);
            try {
              if (editingRole) {
                await api.updateRole(editingRole.id, values);
                message.success("Role updated");
              } else {
                await api.createRole(values);
                message.success("Role created");
              }

              setRoleModalOpen(false);
              await loadRoles();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Failed to save role");
            } finally {
              setSavingRole(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a role name" }]}>
            <Input disabled={!canEditSettings || editingRole?.isSystem} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} disabled={!canEditSettings || editingRole?.isSystem} />
          </Form.Item>
          <Form.Item name="scopes" hidden rules={[{ required: true, message: "Select at least one scope" }]}>
            <Select mode="multiple" options={[]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const selectedScopes = (roleForm.getFieldValue("scopes") ?? []) as PermissionScope[];
              return (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {PERMISSION_SCOPE_GROUPS.map((group) => (
                    <Card key={group.label} size="small" title={group.label}>
                      <Checkbox.Group
                        style={{ width: "100%" }}
                        disabled={!canEditSettings || editingRole?.isSystem}
                        value={group.scopes.filter((scope) => selectedScopes.includes(scope))}
                        options={group.scopes.map((scope) => ({
                          label: scope,
                          value: scope
                        }))}
                        onChange={(checkedValues) => {
                          const currentScopes = (roleForm.getFieldValue("scopes") ?? []) as PermissionScope[];
                          const groupScopeSet = new Set(group.scopes);
                          const otherScopes = currentScopes.filter((scope) => !groupScopeSet.has(scope));
                          roleForm.setFieldValue("scopes", [...otherScopes, ...(checkedValues as PermissionScope[])]);
                        }}
                      />
                    </Card>
                  ))}
                </Space>
              );
            }}
          </Form.Item>
          <Form.Item
            name="allowedProviders"
            label="Allowed Providers"
            extra="Leave empty to allow all providers."
          >
            <Select
              mode="multiple"
              options={providerOptions}
              disabled={!canEditSettings || editingRole?.isSystem}
            />
          </Form.Item>
          <Form.Item
            name="allowedModels"
            label="Allowed Models"
            extra="Leave empty to allow all models."
          >
            <Select
              mode="multiple"
              options={allModelOptions}
              loading={codexModelsLoading || claudeModelsLoading}
              optionFilterProp="label"
              showSearch
              disabled={!canEditSettings || editingRole?.isSystem}
            />
          </Form.Item>
          <Form.Item
            name="allowedEfforts"
            label="Allowed Efforts"
            extra="Leave empty to allow all efforts."
          >
            <Select
              mode="multiple"
              options={allEffortOptions}
              disabled={!canEditSettings || editingRole?.isSystem}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={savingRole}
            disabled={!canEditSettings || editingRole?.isSystem}
            block
            style={{ marginTop: 16 }}
          >
            {editingRole ? "Save Role" : "Create Role"}
          </Button>
        </Form>
      </Modal>

      <Modal
        open={responsePreferencePresetModalOpen}
        title={editingResponsePreferencePreset ? `Edit Response Preference: ${editingResponsePreferencePreset.name}` : "Add Response Preference"}
        footer={null}
        onCancel={() => setResponsePreferencePresetModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={responsePreferencePresetForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!settings) {
              return;
            }

            setSavingResponsePreferencePreset(true);
            try {
              const nextPresets = editingResponsePreferencePreset
                ? responsePreferencePresets.map((preset) =>
                    preset.id === editingResponsePreferencePreset.id
                      ? {
                          ...preset,
                          name: values.name,
                          description: values.description,
                          preference: {
                            audience: values.audience,
                            explanationDepth: values.explanationDepth,
                            jargonLevel: values.jargonLevel,
                            codePreference: values.codePreference,
                            clarifyBehavior: values.clarifyBehavior,
                            formattingStyle: values.formattingStyle,
                            extraInstructions: values.extraInstructions?.trim() || undefined
                          }
                        }
                      : preset
                  )
                : [
                    ...responsePreferencePresets,
                    {
                      name: values.name,
                      description: values.description,
                      preference: {
                        audience: values.audience,
                        explanationDepth: values.explanationDepth,
                        jargonLevel: values.jargonLevel,
                        codePreference: values.codePreference,
                        clarifyBehavior: values.clarifyBehavior,
                        formattingStyle: values.formattingStyle,
                        extraInstructions: values.extraInstructions?.trim() || undefined
                      }
                    }
                  ];

              const nextSettings = await api.updateSettings({
                responsePreferencePresets: nextPresets
              });
              setSettings(nextSettings);
              setResponsePreferencePresetModalOpen(false);
              message.success(editingResponsePreferencePreset ? "Response preference updated" : "Response preference created");
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Failed to save response preference");
            } finally {
              setSavingResponsePreferencePreset(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem} />
          </Form.Item>
          <Form.Item name="audience" label="Audience">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use neutral"
              options={[
                { label: "Technical", value: "technical" },
                { label: "Non-technical", value: "non_technical" },
                { label: "Mixed", value: "mixed" }
              ]}
            />
          </Form.Item>
          <Form.Item name="explanationDepth" label="Explanation Depth">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use default depth"
              options={[
                { label: "Brief", value: "brief" },
                { label: "Standard", value: "standard" },
                { label: "Detailed", value: "detailed" }
              ]}
            />
          </Form.Item>
          <Form.Item name="jargonLevel" label="Jargon Level">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use default jargon level"
              options={[
                { label: "Avoid", value: "avoid" },
                { label: "Balanced", value: "balanced" },
                { label: "Expert", value: "expert" }
              ]}
            />
          </Form.Item>
          <Form.Item name="codePreference" label="Code Preference">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use default code preference"
              options={[
                { label: "Only When Needed", value: "only_when_needed" },
                { label: "Prefer Examples", value: "prefer_examples" },
                { label: "Avoid Code", value: "avoid_code" }
              ]}
            />
          </Form.Item>
          <Form.Item name="clarifyBehavior" label="Clarify Behavior">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use default clarify behavior"
              options={[
                { label: "Ask When Ambiguous", value: "ask_when_ambiguous" },
                { label: "Make Reasonable Assumptions", value: "make_reasonable_assumptions" }
              ]}
            />
          </Form.Item>
          <Form.Item name="formattingStyle" label="Formatting Style">
            <Select
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              allowClear
              placeholder="Use default formatting style"
              options={[
                { label: "Direct", value: "direct" },
                { label: "Teaching", value: "teaching" },
                { label: "Executive", value: "executive" }
              ]}
            />
          </Form.Item>
          <Form.Item name="extraInstructions" label="Extra Instructions">
            <Input.TextArea
              rows={4}
              maxLength={2000}
              disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
              placeholder="Optional additional response instructions."
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={savingResponsePreferencePreset}
            disabled={!canEditSettings || editingResponsePreferencePreset?.isSystem}
            block
            style={{ marginTop: 16 }}
          >
            {editingResponsePreferencePreset ? "Save Response Preference" : "Create Response Preference"}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
