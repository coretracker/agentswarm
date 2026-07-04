"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgentProvider,
  AgentClarifyBehavior,
  AgentCodePreference,
  AgentExplanationDepth,
  AgentFormattingStyle,
  HostexecAvailability,
  AgentJargonLevel,
  AudienceType,
  McpServerTransport,
  PermissionScope,
  ProviderModelOption,
  ProviderProfile,
  RepositorySlackEventStatus,
  ResponsePreferencePreset,
  Role,
  SystemSettings,
  UpdateSettingsInput
} from "@verft/shared-types";
import {
  PERMISSION_SCOPE_GROUPS,
  getAgentProviderLabel,
  getEffortOptionsForProvider,
  getModelsForProvider
} from "@verft/shared-types";
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
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography
} from "antd";
import { api } from "../src/api/client";
import { useSettings } from "../src/hooks/useSettings";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { buildApiUrl } from "../src/lib/public-url";
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
  anthropicBaseUrl: string;
  taskPromptMagicModel: string;
  taskPromptMagicTemplate: string;
  hostexecEnabled: boolean;
  hostexecUrl: string;
  hostexecBearerTokenEnvVar: string;
  codexDefaultModel: string;
  codexModels: ProviderModelOption[];
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeModels: ProviderModelOption[];
  claudeDefaultEffort: ProviderProfile;
  slackAssistantProvider: AgentProvider;
  slackAssistantModel: string;
  slackHarnessWhatExists: string;
  slackHarnessAllowedActions: string;
  slackHarnessHowToWork: string;
  slackHarnessDefinitionOfDone: string;
  slackHarnessEvidenceExpectations: string;
  slackAgentMcpServers: Array<{
    name: string;
    enabled: boolean;
    transport: McpServerTransport;
    command: string;
    argsText: string;
    url: string;
    bearerTokenEnvVar: string;
    bearerToken: string;
    bearerTokenConfigured: boolean;
    clearBearerToken: boolean;
  }>;
  slackBotToken: string;
  clearSlackBotToken: boolean;
  slackSigningSecret: string;
  clearSlackSigningSecret: boolean;
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
type SettingsTabKey = "general" | "git" | "hostexec" | "codex" | "claude" | "integrations";
type DirtyGeneralTabKey = SettingsTabKey;

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: getAgentProviderLabel("codex"), value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

const toSentenceValue = (value: string): string => value.replace(/_/g, " ");
const formatNullableDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "No events yet";
const slackEventStatusColor = (status: RepositorySlackEventStatus | null | undefined): string => {
  if (status === "received") {
    return "green";
  }
  if (status === "ignored") {
    return "gold";
  }
  if (status === "failed") {
    return "red";
  }
  return "default";
};
const mcpTransportOptions: Array<{ label: string; value: McpServerTransport }> = [
  { label: "stdio", value: "stdio" },
  { label: "http", value: "http" }
];
const normalizeMcpServerName = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
const trimFormString = (value: string | null | undefined): string => (value ?? "").trim();
const optionalTrimFormString = (value: string | null | undefined): string | undefined => {
  const trimmed = trimFormString(value);
  return trimmed.length > 0 ? trimmed : undefined;
};
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
  anthropicBaseUrl: settings.anthropicBaseUrl ?? "",
  taskPromptMagicModel: settings.taskPromptMagicModel,
  taskPromptMagicTemplate: settings.taskPromptMagicTemplate,
  hostexecEnabled: settings.hostexec?.enabled === true,
  hostexecUrl: settings.hostexec?.url ?? "",
  hostexecBearerTokenEnvVar: settings.hostexec?.bearerTokenEnvVar ?? "",
  codexDefaultModel: settings.codexDefaultModel,
  codexModels: settings.codexModels,
  codexDefaultEffort: settings.codexDefaultEffort,
  claudeDefaultModel: settings.claudeDefaultModel,
  claudeModels: settings.claudeModels,
  claudeDefaultEffort: settings.claudeDefaultEffort,
  slackAssistantProvider: settings.slackAssistantProvider,
  slackAssistantModel: settings.slackAssistantModel,
  slackHarnessWhatExists: settings.slackHarnessWhatExists ?? "",
  slackHarnessAllowedActions: settings.slackHarnessAllowedActions ?? "",
  slackHarnessHowToWork: settings.slackHarnessHowToWork ?? "",
  slackHarnessDefinitionOfDone: settings.slackHarnessDefinitionOfDone ?? "",
  slackHarnessEvidenceExpectations: settings.slackHarnessEvidenceExpectations ?? "",
  slackAgentMcpServers: (settings.slackAgentMcpServers ?? []).map((server) => ({
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? "",
    argsText: (server.args ?? []).join("\n"),
    url: server.url ?? "",
    bearerTokenEnvVar: server.bearerTokenEnvVar ?? "",
    bearerToken: "",
    bearerTokenConfigured: server.bearerTokenConfigured === true,
    clearBearerToken: false
  })),
  slackBotToken: "",
  clearSlackBotToken: false,
  slackSigningSecret: "",
  clearSlackSigningSecret: false
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
  const [checkingHostexec, setCheckingHostexec] = useState(false);
  const [hostexecAvailability, setHostexecAvailability] = useState<HostexecAvailability | null>(null);
  const [autoFillingProvider, setAutoFillingProvider] = useState<AgentProvider | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [savingResponsePreferencePreset, setSavingResponsePreferencePreset] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [responsePreferencePresetModalOpen, setResponsePreferencePresetModalOpen] = useState(false);
  const [editingResponsePreferencePreset, setEditingResponsePreferencePreset] = useState<ResponsePreferencePreset | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("general");
  const [generalDirty, setGeneralDirty] = useState(false);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [generalDirtyTabs, setGeneralDirtyTabs] = useState<DirtyGeneralTabKey[]>([]);
  const [credentialDirtyTabs, setCredentialDirtyTabs] = useState<SettingsTabKey[]>([]);
  const canEditSettings = can("settings:edit");
  const { models: codexModels, loading: codexModelsLoading, source: codexModelsSource } = useProviderModels("codex");
  const { models: claudeModels, loading: claudeModelsLoading, source: claudeModelsSource } = useProviderModels("claude");
  const codexModelFormValues = Form.useWatch("codexModels", generalForm);
  const claudeModelFormValues = Form.useWatch("claudeModels", generalForm);
  const slackAssistantProviderFormValue =
    Form.useWatch("slackAssistantProvider", generalForm) ?? settings?.slackAssistantProvider ?? "codex";
  const codexDefaultModelOptions = normalizeProviderModelOptions(codexModelFormValues, codexModels);
  const claudeDefaultModelOptions = normalizeProviderModelOptions(claudeModelFormValues, claudeModels);
  const slackAssistantModelOptions =
    slackAssistantProviderFormValue === "claude" ? claudeDefaultModelOptions : codexDefaultModelOptions;
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
  const hostexecDetected = hostexecAvailability?.available === true;
  const hostexecStatus = hostexecDetected ? "Detected" : settings?.hostexec?.url ? "Manual" : "Not Detected";

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

  const renderSlackMcpServerList = () => (
    <Form.List
      name="slackAgentMcpServers"
      rules={[
        {
          validator: async (_, value: GeneralSettingsForm["slackAgentMcpServers"]) => {
            const seen = new Set<string>();
            for (const entry of value ?? []) {
              const serverName = normalizeMcpServerName(entry?.name);
              if (!serverName) {
                continue;
              }
              if (seen.has(serverName)) {
                throw new Error(`Duplicate MCP server name: ${entry.name}`);
              }
              seen.add(serverName);
            }
          }
        }
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <Flex vertical gap={8}>
          {fields.map((field) => (
            <Card key={field.key} size="small">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Flex align="center" justify="space-between" gap={8} wrap="wrap">
                  <Typography.Text strong>{`Server ${field.name + 1}`}</Typography.Text>
                  <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                    Remove
                  </Button>
                </Flex>
                <Form.Item
                  name={[field.name, "name"]}
                  label="Name"
                  rules={[{ required: true, whitespace: true, message: "Name is required" }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="github" />
                </Form.Item>
                <Form.Item name={[field.name, "enabled"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                  <Checkbox>Enabled</Checkbox>
                </Form.Item>
                <Form.Item
                  name={[field.name, "transport"]}
                  label="Transport"
                  rules={[{ required: true, message: "Transport is required" }]}
                  style={{ marginBottom: 0 }}
                >
                  <Select options={mcpTransportOptions} />
                </Form.Item>
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    const transport = generalForm.getFieldValue(["slackAgentMcpServers", field.name, "transport"]) as
                      | McpServerTransport
                      | undefined;
                    if (transport === "http") {
                      const bearerTokenConfigured =
                        generalForm.getFieldValue(["slackAgentMcpServers", field.name, "bearerTokenConfigured"]) === true;
                      return (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Form.Item
                            name={[field.name, "url"]}
                            label="URL"
                            rules={[{ required: true, type: "url", message: "Valid URL is required" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="https://example.com/mcp" />
                          </Form.Item>
                          <Form.Item
                            name={[field.name, "bearerToken"]}
                            label={bearerTokenConfigured ? "Bearer Token (leave blank to keep existing)" : "Bearer Token"}
                            style={{ marginBottom: 0 }}
                          >
                            <Input.Password autoComplete="off" placeholder="ghp_... / token..." />
                          </Form.Item>
                          {bearerTokenConfigured ? (
                            <Form.Item name={[field.name, "clearBearerToken"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                              <Checkbox>Clear stored bearer token</Checkbox>
                            </Form.Item>
                          ) : null}
                        </Space>
                      );
                    }
                    return (
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Form.Item
                          name={[field.name, "command"]}
                          label="Command"
                          rules={[{ required: true, whitespace: true, message: "Command is required" }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="npx" />
                        </Form.Item>
                        <Form.Item name={[field.name, "argsText"]} label="Args (one per line)" style={{ marginBottom: 0 }}>
                          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder={"-y\n@modelcontextprotocol/server-github"} />
                        </Form.Item>
                      </Space>
                    );
                  }}
                </Form.Item>
              </Space>
            </Card>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              add({
                name: "",
                enabled: true,
                transport: "stdio",
                command: "",
                argsText: "",
                url: "",
                bearerTokenEnvVar: "",
                bearerToken: "",
                bearerTokenConfigured: false,
                clearBearerToken: false
              })
            }
          >
            Add Slack MCP Server
          </Button>
          <Form.ErrorList errors={errors} />
        </Flex>
      )}
    </Form.List>
  );

  const saveGeneralSettings = async (values: GeneralSettingsForm): Promise<void> => {
    setSavingGeneral(true);
    try {
      const payload: UpdateSettingsInput = {
        defaultProvider: values.defaultProvider,
        maxAgents: values.maxAgents,
        branchPrefix: values.branchPrefix,
        gitUsername: values.gitUsername,
        gitAuthorName: values.gitAuthorName?.trim() || null,
        gitAuthorEmail: values.gitAuthorEmail?.trim() || null,
        hostexec: {
          enabled: values.hostexecEnabled === true,
          url: values.hostexecUrl?.trim() ? values.hostexecUrl.trim() : null,
          bearerTokenEnvVar: values.hostexecBearerTokenEnvVar?.trim() ? values.hostexecBearerTokenEnvVar.trim() : null
        },
        openaiBaseUrl: values.openaiBaseUrl?.trim() ? values.openaiBaseUrl.trim() : null,
        anthropicBaseUrl: values.anthropicBaseUrl?.trim() ? values.anthropicBaseUrl.trim() : null,
        taskPromptMagicModel: values.taskPromptMagicModel,
        taskPromptMagicTemplate: values.taskPromptMagicTemplate,
        codexDefaultModel: values.codexDefaultModel,
        codexModels: values.codexModels,
        codexDefaultEffort: values.codexDefaultEffort,
        claudeDefaultModel: values.claudeDefaultModel,
        claudeModels: values.claudeModels,
        claudeDefaultEffort: values.claudeDefaultEffort,
        slackAssistantProvider: values.slackAssistantProvider,
        slackAssistantModel: optionalTrimFormString(values.slackAssistantModel),
        slackHarnessWhatExists: trimFormString(values.slackHarnessWhatExists) || null,
        slackHarnessAllowedActions: trimFormString(values.slackHarnessAllowedActions) || null,
        slackHarnessHowToWork: trimFormString(values.slackHarnessHowToWork) || null,
        slackHarnessDefinitionOfDone: trimFormString(values.slackHarnessDefinitionOfDone) || null,
        slackHarnessEvidenceExpectations: trimFormString(values.slackHarnessEvidenceExpectations) || null,
        slackAgentMcpServers: (values.slackAgentMcpServers ?? []).map((server) =>
          server.transport === "http"
            ? {
                name: server.name,
                enabled: server.enabled,
                transport: "http" as const,
                url: trimFormString(server.url),
                bearerTokenEnvVar: trimFormString(server.bearerTokenEnvVar) || null,
                ...(trimFormString(server.bearerToken).length > 0 ? { bearerToken: trimFormString(server.bearerToken) } : {}),
                ...(server.clearBearerToken ? { clearBearerToken: true } : {})
              }
            : {
                name: server.name,
                enabled: server.enabled,
                transport: "stdio" as const,
                command: trimFormString(server.command),
                args: trimFormString(server.argsText)
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean)
              }
        ),
        ...(trimFormString(values.slackBotToken).length > 0 ? { slackBotToken: trimFormString(values.slackBotToken) } : {}),
        ...(values.clearSlackBotToken ? { clearSlackBotToken: true } : {}),
        ...(trimFormString(values.slackSigningSecret).length > 0 ? { slackSigningSecret: trimFormString(values.slackSigningSecret) } : {}),
        ...(values.clearSlackSigningSecret ? { clearSlackSigningSecret: true } : {})
      };
      const nextSettings = await api.updateSettings(payload);
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

  const saveCredentials = async (values: CredentialForm): Promise<void> => {
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
      setCredentialDirtyTabs([]);
      message.success("Credentials updated");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to update credentials");
    } finally {
      setSavingCredentials(false);
    }
  };

  const markGeneralTabDirty = (tab: DirtyGeneralTabKey) => {
    setGeneralDirty(true);
    setGeneralDirtyTabs((current) => (current.includes(tab) ? current : [...current, tab]));
  };

  const markCredentialTabDirty = (tab: SettingsTabKey) => {
    setCredentialsDirty(true);
    setCredentialDirtyTabs((current) => (current.includes(tab) ? current : [...current, tab]));
  };

  const checkHostexec = useCallback(async (options: { silent?: boolean } = {}) => {
    setCheckingHostexec(true);
    try {
      const result = await api.checkHostexec();
      setHostexecAvailability(result);
      if (result.available && result.detected && result.url && !generalForm.getFieldValue("hostexecUrl")) {
        generalForm.setFieldValue("hostexecUrl", result.url);
      }
      if (options.silent) {
        return;
      }
      if (result.available) {
        message.success(result.message);
      } else {
        message.warning(result.message);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to check hostexec");
    } finally {
      setCheckingHostexec(false);
    }
  }, [generalForm, message]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    void checkHostexec({ silent: true });
  }, [checkHostexec, settings]);

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
      key: "general",
      label: <span>{generalDirtyTabs.includes("general") ? "General *" : "General"}</span>
    },
    {
      key: "git",
      label: <span>{generalDirtyTabs.includes("git") || credentialDirtyTabs.includes("git") ? "Git *" : "Git"}</span>
    },
    {
      key: "hostexec",
      label: <span>{generalDirtyTabs.includes("hostexec") ? "Hostexec *" : "Hostexec"}</span>
    },
    {
      key: "codex",
      label: <span>{generalDirtyTabs.includes("codex") || credentialDirtyTabs.includes("codex") ? "Codex *" : "Codex"}</span>
    },
    {
      key: "claude",
      label: <span>{generalDirtyTabs.includes("claude") || credentialDirtyTabs.includes("claude") ? "Claude Code *" : "Claude Code"}</span>
    },
    {
      key: "integrations",
      label: <span>{generalDirtyTabs.includes("integrations") ? "Slack *" : "Slack"}</span>
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

        {activeTab === "general" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("general")}
            onFinish={saveGeneralSettings}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card bordered={false} loading={loading} title="General">
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
                </Flex>
              </Card>
            </Space>
            {renderSaveBar({ dirty: generalDirty, label: "Save General Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "codex" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("codex")}
            onFinish={saveGeneralSettings}
          >
            <Card bordered={false} loading={loading} title="Codex">
              <Flex vertical gap={16} style={{ width: "100%" }}>
                <Form.Item name="codexDefaultEffort" label="Default Effort">
                  <Select options={getEffortOptionsForProvider("codex")} />
                </Form.Item>
                <Form.Item
                  name="codexDefaultModel"
                  label="Default Model"
                  extra={
                    codexModelsSource === "cache"
                      ? "Model suggestions come from the saved Codex model list below."
                      : "Model suggestions use built-in defaults until you save a custom list."
                  }
                >
                  <ModelSelect options={codexDefaultModelOptions} loading={codexModelsLoading} />
                </Form.Item>
                {renderProviderModelsEditor("codex", "codexModels", Boolean(settings?.openaiApiKeyConfigured))}
                <Form.Item
                  name="taskPromptMagicModel"
                  label="Task Prompt Magic Model"
                  extra="Model used by the Magic Prompt helper in task creation."
                >
                  <Input placeholder="gpt-5.4-mini" />
                </Form.Item>
                <Form.Item
                  name="taskPromptMagicTemplate"
                  label="Task Prompt Magic Template"
                  extra="Use {{user_request}} as the placeholder for the user's current text."
                >
                  <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} placeholder="Template with {{user_request}} placeholder" />
                </Form.Item>
                <Form.Item
                  name="openaiBaseUrl"
                  label="Base URL Override"
                  extra="Set when pointing Verft at an OpenAI-compatible proxy or self-hosted gateway."
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="https://api.openai.com/v1" />
                </Form.Item>
              </Flex>
            </Card>
            {renderSaveBar({ dirty: generalDirty, label: "Save Codex Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "claude" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("claude")}
            onFinish={saveGeneralSettings}
          >
            <Card bordered={false} loading={loading} title="Claude Code">
              <Flex vertical gap={16} style={{ width: "100%" }}>
                <Alert
                  type="warning"
                  showIcon
                  message="Experimental"
                  description="Claude Code in Verft is experimental; behavior and defaults may change."
                />
                <Form.Item name="claudeDefaultEffort" label="Default Effort">
                  <Select options={getEffortOptionsForProvider("claude")} />
                </Form.Item>
                <Form.Item
                  name="claudeDefaultModel"
                  label="Default Model"
                  extra={
                    claudeModelsSource === "cache"
                      ? "Model suggestions come from the saved Claude model list below."
                      : "Model suggestions use built-in defaults until you save a custom list."
                  }
                >
                  <ModelSelect options={claudeDefaultModelOptions} loading={claudeModelsLoading} />
                </Form.Item>
                {renderProviderModelsEditor("claude", "claudeModels", Boolean(settings?.anthropicApiKeyConfigured))}
                <Form.Item
                  name="anthropicBaseUrl"
                  label="Base URL Override"
                  extra="Set when pointing Verft at an Anthropic-compatible proxy or gateway."
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="https://api.anthropic.com/v1" />
                </Form.Item>
              </Flex>
            </Card>
            {renderSaveBar({ dirty: generalDirty, label: "Save Claude Code Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "git" ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Form
              form={generalForm}
              layout="vertical"
              disabled={!canEditSettings}
              onValuesChange={() => markGeneralTabDirty("git")}
              onFinish={saveGeneralSettings}
            >
              <Card bordered={false} loading={loading} title="Git">
                <Flex vertical gap={16} style={{ width: "100%" }}>
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
                    <Input placeholder="Verft" />
                  </Form.Item>
                  <Form.Item
                    name="gitAuthorEmail"
                    label="Git Author Email"
                    extra="Used for agent-created Git commits. Leave blank to use the system default."
                    rules={[{ type: "email", message: "Enter a valid email address" }]}
                  >
                    <Input placeholder="verft@example.com" />
                  </Form.Item>
                  <Form.Item name="branchPrefix" label="Feature Branch Prefix" rules={[{ required: true, whitespace: true }]}>
                    <Input placeholder="verft" />
                  </Form.Item>
                </Flex>
              </Card>
              {renderSaveBar({ dirty: generalDirty, label: "Save Git Settings", loading: savingGeneral })}
            </Form>

            <Card
              bordered={false}
              loading={loading}
              title="GitHub Token"
              extra={
                settings ? (
                  <Space wrap>
                    <Tag color={settings.githubTokenConfigured ? "green" : "default"}>
                      GitHub Token {settings.githubTokenConfigured ? "Configured" : "Missing"}
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
                onValuesChange={() => markCredentialTabDirty("git")}
                onFinish={saveCredentials}
              >
                <Form.Item
                  name="githubToken"
                  label="GitHub Token"
                  extra="Used for server pull/push/merge operations and for in-agent `git pull` / `git push` inside Codex and Claude task runtimes."
                >
                  <Input.Password placeholder={settings?.githubTokenConfigured ? "Configured. Enter a new token to replace it." : "github_pat_..."} />
                </Form.Item>
                {renderSaveBar({
                  dirty: credentialsDirty,
                  label: "Save GitHub Token",
                  loading: savingCredentials,
                  statusText: credentialsDirty ? "Unsaved GitHub token changes" : "No pending GitHub token changes"
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
                </Space>
              </Form>
            </Card>
          </Space>
        ) : null}

        {activeTab === "hostexec" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("hostexec")}
            onFinish={saveGeneralSettings}
          >
            <Card
              bordered={false}
              loading={loading}
              title="Hostexec"
              extra={
                <Tag color={hostexecDetected ? "green" : settings?.hostexec?.url ? "blue" : "default"}>
                  Hostexec {hostexecStatus}
                </Tag>
              }
            >
              <Flex vertical gap={16} style={{ width: "100%" }}>
                <Alert
                  type={hostexecDetected ? "success" : "info"}
                  showIcon
                  message={hostexecDetected ? "Host daemon detected" : "Host daemon not detected"}
                  description={
                    hostexecDetected
                      ? "Repository Host Commands decide which bridge shims are mounted for each repository."
                      : "Start the host daemon with npm run hostexec. Verft checks the default daemon URLs automatically."
                  }
                />
                <Form.Item
                  name="hostexecUrl"
                  label="URL"
                  rules={[{ type: "url", message: "Enter a valid absolute URL." }]}
                  extra="Daemon capabilities are read from /capabilities."
                >
                  <Input placeholder="http://host.docker.internal:38128" />
                </Form.Item>
                <Form.Item
                  name="hostexecBearerTokenEnvVar"
                  label="Bearer Token Env Var"
                  rules={[
                    {
                      validator: (_rule, value?: string) => {
                        if (!value || value.trim().length === 0) {
                          return Promise.resolve();
                        }
                        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
                          ? Promise.resolve()
                          : Promise.reject(new Error("Use a valid environment variable name with letters, numbers, and underscores."));
                      }
                    }
                  ]}
                  extra="The server reads this environment variable when calling hostexec; the token value is not stored in settings."
                >
                  <Input placeholder="HOSTEXEC_TOKEN" />
                </Form.Item>
                <Space wrap>
                  <Button icon={<ReloadOutlined />} loading={checkingHostexec} disabled={!settings} onClick={() => void checkHostexec()}>
                    Check availability
                  </Button>
                  {hostexecAvailability ? (
                    <Tag color={hostexecAvailability.available ? "green" : "red"}>{hostexecAvailability.message}</Tag>
                  ) : null}
                  {hostexecAvailability?.detected && hostexecAvailability.url ? (
                    <Tag color="blue">Detected URL: {hostexecAvailability.url}</Tag>
                  ) : null}
                </Space>
                {hostexecAvailability?.allowAll ? (
                  <Typography.Text type="secondary">
                    Daemon allows all valid command names. Repository Host Commands still restrict which shims are mounted.
                  </Typography.Text>
                ) : hostexecAvailability?.commands.length ? (
                  <Typography.Text type="secondary">
                    Commands: {hostexecAvailability.commands.join(", ")}
                  </Typography.Text>
                ) : null}
              </Flex>
            </Card>
            {renderSaveBar({ dirty: generalDirty, label: "Save Hostexec Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "integrations" ? (
          <Form
            form={generalForm}
            layout="vertical"
            disabled={!canEditSettings}
            onValuesChange={() => markGeneralTabDirty("integrations")}
            onFinish={saveGeneralSettings}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card bordered={false} loading={loading} title="General">
                <Flex vertical gap={16} style={{ width: "100%" }}>
                  <Form.Item label="Events URL">
                    <Input
                      readOnly
                      value={buildApiUrl("/slack/events")}
                      addonAfter={
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            void navigator.clipboard.writeText(buildApiUrl("/slack/events"));
                            message.success("Slack events URL copied");
                          }}
                        >
                          Copy
                        </Button>
                      }
                    />
                  </Form.Item>
                  <Space size={[8, 8]} wrap>
                    <Tag color={settings?.slackBotTokenConfigured ? "green" : "default"}>Bot token</Tag>
                    <Tag color={settings?.slackSigningSecretConfigured ? "green" : "default"}>Signing secret</Tag>
                    <Tag color={slackEventStatusColor(settings?.slackLastEventStatus)}>{settings?.slackLastEventStatus ?? "waiting"}</Tag>
                  </Space>
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{formatNullableDate(settings?.slackLastEventAt)}</Typography.Text>
                    {settings?.slackLastEventType ? (
                      <Typography.Text type="secondary">{settings.slackLastEventType}</Typography.Text>
                    ) : null}
                    {settings?.slackLastEventError ? (
                      <Typography.Text type="secondary">{settings.slackLastEventError}</Typography.Text>
                    ) : null}
                  </Space>
                  <Form.Item
                    name="slackBotToken"
                    label={
                      settings?.slackBotTokenConfigured ? "Slack Bot Token (leave blank to keep existing)" : "Slack Bot Token"
                    }
                  >
                    <Input.Password placeholder="xoxb-..." autoComplete="off" />
                  </Form.Item>
                  {settings?.slackBotTokenConfigured ? (
                    <Form.Item name="clearSlackBotToken" valuePropName="checked">
                      <Checkbox>Clear stored Slack bot token</Checkbox>
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    name="slackSigningSecret"
                    label={
                      settings?.slackSigningSecretConfigured
                        ? "Slack Signing Secret (leave blank to keep existing)"
                        : "Slack Signing Secret"
                    }
                  >
                    <Input.Password autoComplete="off" />
                  </Form.Item>
                  {settings?.slackSigningSecretConfigured ? (
                    <Form.Item name="clearSlackSigningSecret" valuePropName="checked">
                      <Checkbox>Clear stored Slack signing secret</Checkbox>
                    </Form.Item>
                  ) : null}
                </Flex>
              </Card>
              <Card bordered={false} loading={loading} title="AI Defaults">
                <Flex vertical gap={16} style={{ width: "100%" }}>
                  <Form.Item name="slackAssistantProvider" label="Assistant Provider" rules={[{ required: true }]}>
                    <Select
                      options={providerOptions}
                      onChange={(provider: AgentProvider) => {
                        const fallbackModel =
                          provider === "claude"
                            ? generalForm.getFieldValue("claudeDefaultModel") || settings?.claudeDefaultModel || ""
                            : generalForm.getFieldValue("codexDefaultModel") || settings?.codexDefaultModel || "";
                        generalForm.setFieldValue("slackAssistantModel", fallbackModel);
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="slackAssistantModel"
                    label="Assistant Model"
                    extra="Model used by Slack assistant DM sessions."
                    rules={[{ required: true, whitespace: true, message: "Select or enter a model" }]}
                  >
                    <ModelSelect options={slackAssistantModelOptions} loading={slackAssistantProviderFormValue === "claude" ? claudeModelsLoading : codexModelsLoading} />
                  </Form.Item>
                </Flex>
              </Card>
              <Card bordered={false} loading={loading} title="MCP">
                <Flex vertical gap={16} style={{ width: "100%" }}>
                  <Alert
                    type="info"
                    showIcon
                    message="Slack agent MCP"
                    description="Verft MCP is added automatically. Add extra MCP servers here for Slack DM assistant runs."
                  />
                  {renderSlackMcpServerList()}
                </Flex>
              </Card>
              <Card bordered={false} loading={loading} title="Harness">
                <Flex vertical gap={12}>
                  <Typography.Text type="secondary">
                    Write standing Slack assistant guidance. These fields are optional and are written to AGENTS.md in Slack assistant workspaces.
                  </Typography.Text>
                  <Form.Item
                    name="slackHarnessWhatExists"
                    label="1. What exists?"
                    extra="Slack assistant context: available Verft data, Slack DM behavior, MCP tools, and workspace expectations."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
                  </Form.Item>
                  <Form.Item
                    name="slackHarnessAllowedActions"
                    label="2. What is allowed?"
                    extra="Constraints and policies: what the Slack assistant may read or change, permission limits, and escalation rules."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
                  </Form.Item>
                  <Form.Item
                    name="slackHarnessHowToWork"
                    label="3. How should you work?"
                    extra="Process and decision-making: how to answer Slack users, when to use MCP, and when to ask clarifying questions."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
                  </Form.Item>
                  <Form.Item
                    name="slackHarnessDefinitionOfDone"
                    label="4. How do you know you are done?"
                    extra="Completion rules for Slack replies, task creation, follow-up handling, and validation."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
                  </Form.Item>
                  <Form.Item
                    name="slackHarnessEvidenceExpectations"
                    label="5. How do you prove it?"
                    extra="Expected proof in Slack replies: checked data, created tasks, links, caveats, and skipped checks."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
                  </Form.Item>
                </Flex>
              </Card>
            </Space>
            {renderSaveBar({ dirty: generalDirty, label: "Save Slack Settings", loading: savingGeneral })}
          </Form>
        ) : null}

        {activeTab === "codex" ? (
          <Card
            bordered={false}
            loading={loading}
            title="Codex Credentials"
            extra={
              settings ? (
                <Space wrap>
                  <Tag color={settings.openaiApiKeyConfigured ? "green" : "default"}>
                    API Key {settings.openaiApiKeyConfigured ? "Configured" : "Missing"}
                  </Tag>
                  <Tag color={settings.codexAuthJsonConfigured ? "green" : "default"}>
                    auth.json {settings.codexAuthJsonConfigured ? "Configured" : "Missing"}
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
              onValuesChange={() => markCredentialTabDirty("codex")}
              onFinish={saveCredentials}
            >
              <Form.Item name="openaiApiKey" label="API Key">
                <Input.Password placeholder={settings?.openaiApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-..."} />
              </Form.Item>
              <Form.Item
                name="codexAuthJson"
                label="auth.json"
                extra="Used as the Global Codex credential source and as the Auto fallback after profile auth.json."
              >
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  placeholder={settings?.codexAuthJsonConfigured ? "Configured. Paste a new auth.json to replace it." : "{ ... }"}
                />
              </Form.Item>
              {renderSaveBar({
                dirty: credentialsDirty,
                label: "Save Codex Credentials",
                loading: savingCredentials,
                statusText: credentialsDirty ? "Unsaved Codex credential changes" : "No pending Codex credential changes"
              })}
              <Space wrap>
                <Popconfirm
                  title="Clear Codex API key?"
                  description="This removes the stored OpenAI API key from settings."
                  okText="Clear"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true, loading: savingCredentials }}
                  placement="top"
                  disabled={!canEditSettings}
                  onConfirm={() => handleClearCredential("openai")}
                >
                  <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                    Clear API Key
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
                    Clear auth.json
                  </Button>
                </Popconfirm>
              </Space>
            </Form>
          </Card>
        ) : null}

        {activeTab === "claude" ? (
          <Card
            bordered={false}
            loading={loading}
            title="Claude Code Credentials"
            extra={
              settings ? (
                <Tag color={settings.anthropicApiKeyConfigured ? "green" : "default"}>
                  API Key {settings.anthropicApiKeyConfigured ? "Configured" : "Missing"}
                </Tag>
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
              onValuesChange={() => markCredentialTabDirty("claude")}
              onFinish={saveCredentials}
            >
              <Form.Item
                name="anthropicApiKey"
                label="API Key"
                extra="Used for Claude Code (experimental) runs only."
              >
                <Input.Password placeholder={settings?.anthropicApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-ant-..."} />
              </Form.Item>
              {renderSaveBar({
                dirty: credentialsDirty,
                label: "Save Claude Code Credentials",
                loading: savingCredentials,
                statusText: credentialsDirty ? "Unsaved Claude Code credential changes" : "No pending Claude Code credential changes"
              })}
              <Popconfirm
                title="Clear Claude Code API key?"
                description="This removes the stored Anthropic API key from settings."
                okText="Clear"
                cancelText="Cancel"
                okButtonProps={{ danger: true, loading: savingCredentials }}
                placement="top"
                disabled={!canEditSettings}
                onConfirm={() => handleClearCredential("anthropic")}
              >
                <Button danger loading={savingCredentials} disabled={!canEditSettings}>
                  Clear API Key
                </Button>
              </Popconfirm>
            </Form>
          </Card>
        ) : null}

        {activeTab === "general" ? (
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

        {activeTab === "general" ? (
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
