"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AgentProvider,
  CreateIntegrationRuleInput,
  CreateRepositoryInput,
  IntegrationRule,
  IntegrationRuleExecution,
  IntegrationRuleFilterCondition,
  IntegrationRuleFilterOp,
  IntegrationRuleFilterSource,
  McpServerTransport,
  ProviderProfile,
  Repository,
  RepositoryEnvSecretInput,
  RepositoryEnvVarInput,
  User,
  WebhookInboxEntry
} from "@verft/shared-types";
import {
  DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS,
  DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS,
  DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS,
  DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE,
  DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
  DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
  DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE,
  getAgentProviderLabel,
  getEffortOptionsForProvider
} from "@verft/shared-types";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, Modal, Result, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, Upload, message } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";
import { ApiError, api } from "../src/api/client";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useSettings } from "../src/hooks/useSettings";
import { buildApiUrl } from "../src/lib/public-url";
import { HarnessMarkdownField } from "./harness-markdown-field";

interface RepositoryEditorPageProps {
  mode: "create" | "edit";
  repositoryId?: string;
}

type RepositoryFormValues = {
  name: string;
  url: string;
  defaultBranch: string;
  defaultProvider?: AgentProvider;
  defaultModel?: string;
  defaultProviderProfile?: ProviderProfile;
  envVars: Array<{ key: string; type: "text" | "file"; value: string; fileName: string; fileContentBase64: string }>;
  envSecrets: Array<{ key: string; type: "text" | "file"; value: string; fileName: string; fileContentBase64: string }>;
  mcpServers: Array<{
    name: string;
    enabled: boolean;
    transport: McpServerTransport;
    command: string;
    argsText: string;
    url: string;
    bearerTokenEnvVar: string;
  }>;
  hostCommands: Array<{ name: string }>;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
  clearWebhookSecret: boolean;
  githubPrWebhookSecret: string;
  clearGithubPrWebhookSecret: boolean;
  githubIntegrationBotLogin: string;
  githubPrAllowedUsers: string;
  githubPrRequireBotMention: boolean;
  githubPrAutoArchiveOnMerge: boolean;
  githubPrInitialInstructions: string;
  githubPrFeedbackInstructions: string;
  githubPrReviewInstructions: string;
  githubPrTaskCreatedCommentTemplate: string;
  githubPrTaskOwnerUserId: string;
  slackChannelId: string;
  slackInitialInstructions: string;
  slackFeedbackInstructions: string;
  slackTaskCreatedReplyTemplate: string;
  slackTaskOwnerUserId: string;
  inboundWebhookSecret: string;
  clearInboundWebhookSecret: boolean;
  harnessWhatExists: string;
  harnessAllowedActions: string;
  harnessNotAllowedActions: string;
  harnessHowToWork: string;
  harnessDefinitionOfDone: string;
  harnessEvidenceExpectations: string;
};

const emptyValues = (): RepositoryFormValues => ({
  name: "",
  url: "",
  defaultBranch: "develop",
  defaultProvider: undefined,
  defaultModel: undefined,
  defaultProviderProfile: undefined,
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  hostCommands: [],
  webhookEnabled: false,
  webhookUrl: "",
  webhookSecret: "",
  clearWebhookSecret: false,
  githubPrWebhookSecret: "",
  clearGithubPrWebhookSecret: false,
  githubIntegrationBotLogin: "",
  githubPrAllowedUsers: "",
  githubPrRequireBotMention: false,
  githubPrAutoArchiveOnMerge: true,
  githubPrInitialInstructions: DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS,
  githubPrFeedbackInstructions: DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS,
  githubPrReviewInstructions: DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS,
  githubPrTaskCreatedCommentTemplate: DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE,
  githubPrTaskOwnerUserId: "",
  slackChannelId: "",
  slackInitialInstructions: DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
  slackFeedbackInstructions: DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
  slackTaskCreatedReplyTemplate: DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE,
  slackTaskOwnerUserId: "",
  inboundWebhookSecret: "",
  clearInboundWebhookSecret: false,
  harnessWhatExists: "",
  harnessAllowedActions: "",
  harnessNotAllowedActions: "",
  harnessHowToWork: "",
  harnessDefinitionOfDone: "",
  harnessEvidenceExpectations: ""
});

const normalizeValues = (values?: Partial<RepositoryFormValues> | null): RepositoryFormValues => ({
  name: typeof values?.name === "string" ? values.name : "",
  url: typeof values?.url === "string" ? values.url : "",
  defaultBranch: typeof values?.defaultBranch === "string" ? values.defaultBranch : "develop",
  defaultProvider: values?.defaultProvider === "claude" ? "claude" : values?.defaultProvider === "codex" ? "codex" : undefined,
  defaultModel: typeof values?.defaultModel === "string" && values.defaultModel.trim().length > 0 ? values.defaultModel : undefined,
  defaultProviderProfile:
    values?.defaultProviderProfile === "low" ||
    values?.defaultProviderProfile === "medium" ||
    values?.defaultProviderProfile === "high" ||
    values?.defaultProviderProfile === "max"
      ? values.defaultProviderProfile
      : undefined,
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
  mcpServers: (values?.mcpServers ?? []).map((entry) => ({
    name: typeof entry?.name === "string" ? entry.name : "",
    enabled: entry?.enabled !== false,
    transport: entry?.transport === "http" ? "http" : "stdio",
    command: typeof entry?.command === "string" ? entry.command : "",
    argsText: typeof entry?.argsText === "string" ? entry.argsText : "",
    url: typeof entry?.url === "string" ? entry.url : "",
    bearerTokenEnvVar: typeof entry?.bearerTokenEnvVar === "string" ? entry.bearerTokenEnvVar : ""
  })),
  hostCommands: (values?.hostCommands ?? []).map((entry) => ({
    name: typeof entry?.name === "string" ? entry.name : ""
  })),
  webhookEnabled: values?.webhookEnabled === true,
  webhookUrl: typeof values?.webhookUrl === "string" ? values.webhookUrl : "",
  webhookSecret: typeof values?.webhookSecret === "string" ? values.webhookSecret : "",
  clearWebhookSecret: values?.clearWebhookSecret === true,
  githubPrWebhookSecret: typeof values?.githubPrWebhookSecret === "string" ? values.githubPrWebhookSecret : "",
  clearGithubPrWebhookSecret: values?.clearGithubPrWebhookSecret === true,
  githubIntegrationBotLogin: typeof values?.githubIntegrationBotLogin === "string" ? values.githubIntegrationBotLogin : "",
  githubPrAllowedUsers: typeof values?.githubPrAllowedUsers === "string" ? values.githubPrAllowedUsers : "",
  githubPrRequireBotMention: values?.githubPrRequireBotMention === true,
  githubPrAutoArchiveOnMerge: values?.githubPrAutoArchiveOnMerge !== false,
  githubPrInitialInstructions:
    typeof values?.githubPrInitialInstructions === "string"
      ? values.githubPrInitialInstructions
      : DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS,
  githubPrFeedbackInstructions:
    typeof values?.githubPrFeedbackInstructions === "string"
      ? values.githubPrFeedbackInstructions
      : DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS,
  githubPrReviewInstructions:
    typeof values?.githubPrReviewInstructions === "string"
      ? values.githubPrReviewInstructions
      : DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS,
  githubPrTaskCreatedCommentTemplate:
    typeof values?.githubPrTaskCreatedCommentTemplate === "string"
      ? values.githubPrTaskCreatedCommentTemplate
      : DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE,
  githubPrTaskOwnerUserId: typeof values?.githubPrTaskOwnerUserId === "string" ? values.githubPrTaskOwnerUserId : "",
  slackChannelId: typeof values?.slackChannelId === "string" ? values.slackChannelId : "",
  slackInitialInstructions:
    typeof values?.slackInitialInstructions === "string" ? values.slackInitialInstructions : DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
  slackFeedbackInstructions:
    typeof values?.slackFeedbackInstructions === "string" ? values.slackFeedbackInstructions : DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
  slackTaskCreatedReplyTemplate:
    typeof values?.slackTaskCreatedReplyTemplate === "string"
      ? values.slackTaskCreatedReplyTemplate
      : DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE,
  slackTaskOwnerUserId: typeof values?.slackTaskOwnerUserId === "string" ? values.slackTaskOwnerUserId : "",
  inboundWebhookSecret: typeof values?.inboundWebhookSecret === "string" ? values.inboundWebhookSecret : "",
  clearInboundWebhookSecret: values?.clearInboundWebhookSecret === true,
  harnessWhatExists: typeof values?.harnessWhatExists === "string" ? values.harnessWhatExists : "",
  harnessAllowedActions: typeof values?.harnessAllowedActions === "string" ? values.harnessAllowedActions : "",
  harnessNotAllowedActions: typeof values?.harnessNotAllowedActions === "string" ? values.harnessNotAllowedActions : "",
  harnessHowToWork: typeof values?.harnessHowToWork === "string" ? values.harnessHowToWork : "",
  harnessDefinitionOfDone: typeof values?.harnessDefinitionOfDone === "string" ? values.harnessDefinitionOfDone : "",
  harnessEvidenceExpectations: typeof values?.harnessEvidenceExpectations === "string" ? values.harnessEvidenceExpectations : ""
});

const snapshotValues = (values?: Partial<RepositoryFormValues> | null): string => JSON.stringify(normalizeValues(values));
const REPOSITORY_ENV_VALUE_MAX_LENGTH = 8192;
const REPOSITORY_ENV_FILE_MAX_BYTES = 256 * 1024;
const ENV_VALUE_FILE_ACCEPT =
  ".txt,.env,.json,.yaml,.yml,.ini,.cfg,.conf,.properties,.xml,.pem,.crt,.cer,.key,.p12,.jks";

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

const normalizeHostCommandName = (value: string | undefined): string => (value ?? "").trim();
const HOST_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const requireRepositoryGeneralFields = (
  form: ReturnType<typeof Form.useForm<RepositoryFormValues>>[0],
  values: RepositoryFormValues,
  showGeneralTab: () => void
): { name: string; url: string; defaultBranch: string } => {
  const requiredFields = [
    { name: "name" as const, label: "Name", value: values.name.trim() },
    { name: "url" as const, label: "URL", value: values.url.trim() },
    { name: "defaultBranch" as const, label: "Default Branch", value: values.defaultBranch.trim() }
  ];
  const missingFields = requiredFields.filter((field) => field.value.length === 0);
  if (missingFields.length > 0) {
    showGeneralTab();
    form.setFields(
      missingFields.map((field) => ({
        name: field.name,
        errors: [`${field.label} is required.`]
      }))
    );
    throw new Error("Repository name, URL, and default branch are required.");
  }

  return {
    name: requiredFields[0].value,
    url: requiredFields[1].value,
    defaultBranch: requiredFields[2].value
  };
};

const parseAllowedGitHubUsers = (value: string): string[] => {
  const seen = new Set<string>();
  const users: string[] = [];
  for (const entry of value.split(/[\n,]+/)) {
    const normalized = entry.trim().replace(/^@+/, "");
    const comparable = normalized.toLowerCase();
    if (!normalized || seen.has(comparable)) {
      continue;
    }
    users.push(normalized);
    seen.add(comparable);
  }
  return users;
};

const repositoryDefaultProviderOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: "Codex (OpenAI)", value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

const GITHUB_TEMPLATE_MARKER_HELP =
  "Template markers: {{target_label}}, {{target_ref}}, {{title}}, {{title_line}}, {{feedback_type}}, {{author}}, {{requested_reviewer}}, {{requested_reviewer_line}}, {{issue_title_line}}, {{review_state_line}}, {{file_line}}, {{url_line}}, {{diff_context_block}}, {{feedback_body}}.";

const generateSuggestedWebhookSecret = (): string => {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return "";
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

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

const filterSourceOptions: Array<{ label: string; value: IntegrationRuleFilterSource }> = [
  { label: "Header", value: "header" },
  { label: "Body", value: "body" }
];

const filterOpOptions: Array<{ label: string; value: IntegrationRuleFilterOp }> = [
  { label: "Equals", value: "equals" },
  { label: "Contains", value: "contains" },
  { label: "Exists", value: "exists" },
  { label: "Regex", value: "regex" }
];

const formatJsonValue = (value: unknown): string => JSON.stringify(value, null, 2) ?? String(value ?? "");

type WebhookJsonModalState = {
  title: string;
  value: unknown;
} | null;

interface RuleEditorFormValues {
  name: string;
  enabled: boolean;
  conditions: Array<{
    source: IntegrationRuleFilterSource;
    field: string;
    op: IntegrationRuleFilterOp;
    value: string;
  }>;
  mappingTitle: string;
  mappingInstructions: string;
  mappingBranch: string;
  executionProvider: string;
  executionModel: string;
  executionProviderProfile: string;
  correlationField: string;
  taskOwnerUserId: string;
}

function IntegrationRuleEditorModal({
  open,
  rule,
  users,
  onClose,
  onSave
}: {
  open: boolean;
  rule: IntegrationRule | null;
  users: User[];
  onClose: () => void;
  onSave: (input: CreateIntegrationRuleInput) => Promise<void>;
}) {
  const [form] = Form.useForm<RuleEditorFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      form.setFieldsValue({
        name: rule.name,
        enabled: rule.enabled,
        conditions: (rule.filter.conditions ?? []).map((c) => ({
          source: c.source,
          field: c.field,
          op: c.op,
          value: c.value ?? ""
        })),
        mappingTitle: rule.mapping.title ?? "",
        mappingInstructions: rule.mapping.instructions ?? "",
        mappingBranch: rule.mapping.branch ?? "",
        executionProvider: rule.execution?.provider ?? "",
        executionModel: rule.execution?.model ?? "",
        executionProviderProfile: rule.execution?.providerProfile ?? "",
        correlationField: rule.correlationField ?? "",
        taskOwnerUserId: rule.taskOwnerUserId ?? ""
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        name: "",
        enabled: true,
        conditions: [{ source: "body", field: "", op: "equals", value: "" }],
        mappingTitle: "",
        mappingInstructions: "",
        mappingBranch: "",
        executionProvider: "",
        executionModel: "",
        executionProviderProfile: "",
        correlationField: "",
        taskOwnerUserId: ""
      });
    }
  }, [open, rule, form]);

  return (
    <Modal
      open={open}
      title={rule ? "Edit Integration Rule" : "Create Integration Rule"}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} onClick={async () => {
          try {
            const values = await form.validateFields();
            setSaving(true);
            const conditions: IntegrationRuleFilterCondition[] = values.conditions
              .filter((c) => c.field.trim().length > 0)
              .map((c) => ({
                source: c.source,
                field: c.field.trim(),
                op: c.op,
                ...(c.op !== "exists" && c.value.trim().length > 0 ? { value: c.value.trim() } : {})
              }));
            if (conditions.length === 0) {
              form.setFields([{ name: ["conditions", 0, "field"], errors: ["At least one condition is required."] }]);
              setSaving(false);
              return;
            }
            const execution: IntegrationRuleExecution = {};
            const providerValue = values.executionProvider.trim();
            if (providerValue === "codex" || providerValue === "claude") execution.provider = providerValue;
            if (values.executionModel.trim()) execution.model = values.executionModel.trim();
            const profileValue = values.executionProviderProfile.trim();
            if (profileValue === "low" || profileValue === "medium" || profileValue === "high" || profileValue === "max") execution.providerProfile = profileValue;

            await onSave({
              name: values.name.trim(),
              enabled: values.enabled,
              filter: { conditions },
              mapping: {
                ...(values.mappingTitle.trim() ? { title: values.mappingTitle.trim() } : {}),
                ...(values.mappingInstructions.trim() ? { instructions: values.mappingInstructions.trim() } : {}),
                ...(values.mappingBranch.trim() ? { branch: values.mappingBranch.trim() } : {})
              },
              ...(Object.keys(execution).length > 0 ? { execution } : { execution: null }),
              correlationField: values.correlationField.trim() || null,
              taskOwnerUserId: values.taskOwnerUserId.trim() || null
            });
          } catch {
            // validation or save error
          } finally {
            setSaving(false);
          }
        }}>Save</Button>
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Rule Name" rules={[{ required: true, message: "Name is required" }]}>
          <Input placeholder="e.g. Jira Issue Created" />
        </Form.Item>
        <Form.Item name="enabled" label="Enabled" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>Filter Conditions</Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          All conditions must match (AND logic). At least one condition is required.
        </Typography.Text>
        <Form.List name="conditions">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Flex key={key} gap={8} align="start" style={{ marginBottom: 8 }}>
                  <Form.Item {...restField} name={[name, "source"]} style={{ width: 110, marginBottom: 0 }}>
                    <Select options={filterSourceOptions} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, "field"]}
                    style={{ flex: 1, marginBottom: 0 }}
                    rules={[{ required: true, message: "Field required" }]}
                  >
                    <Input placeholder="e.g. event_type or issue.key" />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, "op"]} style={{ width: 110, marginBottom: 0 }}>
                    <Select options={filterOpOptions} />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, "value"]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input placeholder="Value" />
                  </Form.Item>
                  <Button icon={<DeleteOutlined />} onClick={() => remove(name)} disabled={fields.length <= 1} />
                </Flex>
              ))}
              <Button type="dashed" onClick={() => add({ source: "body", field: "", op: "equals", value: "" })} icon={<PlusOutlined />} style={{ marginBottom: 16 }}>
                Add Condition
              </Button>
            </>
          )}
        </Form.List>

        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>Mapping</Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Use {"{{body.path.to.field}}"} and {"{{header.X-Name}}"} placeholders to interpolate values from the webhook payload.
        </Typography.Text>
        <Form.Item name="mappingTitle" label="Task Title Template">
          <Input placeholder={"e.g. {{body.issue.summary}}"} />
        </Form.Item>
        <Form.Item name="mappingInstructions" label="Task Instructions Template">
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder={"e.g. Work on: {{body.issue.description}}"} />
        </Form.Item>
        <Form.Item name="mappingBranch" label="Branch Template (optional)">
          <Input placeholder={"e.g. feature/{{body.issue.key}}"} />
        </Form.Item>

        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>Execution (optional)</Typography.Text>
        <Flex gap={8}>
          <Form.Item name="executionProvider" label="Provider" style={{ flex: 1 }}>
            <Input placeholder="e.g. claude" />
          </Form.Item>
          <Form.Item name="executionModel" label="Model" style={{ flex: 1 }}>
            <Input placeholder="e.g. claude-sonnet-4-20250514" />
          </Form.Item>
          <Form.Item name="executionProviderProfile" label="Effort" style={{ flex: 1 }}>
            <Input placeholder="e.g. medium" />
          </Form.Item>
        </Flex>

        <Form.Item
          name="correlationField"
          label="Correlation Field"
          extra="Dot-path to the field that identifies the external entity for deduplication, e.g. body.issue.key"
        >
          <Input placeholder="e.g. body.issue.key" />
        </Form.Item>
        <Form.Item name="taskOwnerUserId" label="Task Owner">
          <Select
            allowClear
            placeholder="Select user (optional)"
            options={users.map((u) => ({ label: u.name || u.email, value: u.id }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function RepositoryEditorPage({ mode, repositoryId }: RepositoryEditorPageProps) {
  const router = useRouter();
  const { settings } = useSettings();
  const [form] = Form.useForm<RepositoryFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<"general" | "ai" | "github" | "slack" | "webhooks" | "integrations">("general");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingRepository, setEditingRepository] = useState<Repository | null>(null);
  const [githubWebhookSecretVisible, setGithubWebhookSecretVisible] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const [integrationRules, setIntegrationRules] = useState<IntegrationRule[]>([]);
  const [inboxEntries, setInboxEntries] = useState<WebhookInboxEntry[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<IntegrationRule | null>(null);
  const [inboxDetailEntry, setInboxDetailEntry] = useState<WebhookInboxEntry | null>(null);
  const [inboxJsonModal, setInboxJsonModal] = useState<WebhookJsonModalState>(null);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const watchedValues = Form.useWatch([], form) as RepositoryFormValues | undefined;
  const selectedDefaultProvider =
    (Form.useWatch("defaultProvider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const selectedDefaultModel = Form.useWatch("defaultModel", form) as string | undefined;
  const selectedDefaultProviderProfile = Form.useWatch("defaultProviderProfile", form) as ProviderProfile | undefined;
  const { models: defaultProviderModels, loading: defaultProviderModelsLoading, source: defaultProviderModelsSource } =
    useProviderModels(selectedDefaultProvider);
  const allowedDefaultEffortOptions = getEffortOptionsForProvider(selectedDefaultProvider);

  const hasUnsavedChanges = useMemo(() => {
    if (!initialSnapshot) {
      return false;
    }
    return snapshotValues(watchedValues) !== initialSnapshot;
  }, [initialSnapshot, watchedValues]);

  useEffect(() => {
    let active = true;
    setUsersLoadError(null);
    void api
      .listUsers()
      .then((loadedUsers) => {
        if (active) {
          setUsers(loadedUsers);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setUsersLoadError(error instanceof Error ? error.message : "Failed to load users");
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
        const storedInitial = normalizeValues({
          name: repository.name,
          url: repository.url,
          defaultBranch: repository.defaultBranch,
          defaultProvider: repository.defaultProvider ?? undefined,
          defaultModel: repository.defaultModel ?? undefined,
          defaultProviderProfile: repository.defaultProviderProfile ?? undefined,
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
          mcpServers: (repository.mcpServers ?? []).map((server) => ({
            name: server.name,
            enabled: server.enabled,
            transport: server.transport,
            command: server.command ?? "",
            argsText: (server.args ?? []).join("\n"),
            url: server.url ?? "",
            bearerTokenEnvVar: server.bearerTokenEnvVar ?? ""
          })),
          hostCommands: (repository.hostCommands ?? []).map((name) => ({ name })),
          webhookEnabled: repository.webhookEnabled,
          webhookUrl: repository.webhookUrl ?? "",
          webhookSecret: "",
          clearWebhookSecret: false,
          githubPrWebhookSecret: "",
          clearGithubPrWebhookSecret: false,
          githubIntegrationBotLogin: repository.githubIntegrationBotLogin ?? "",
          githubPrAllowedUsers: (repository.githubPrAllowedUsers ?? []).join("\n"),
          githubPrRequireBotMention: repository.githubPrRequireBotMention === true,
          githubPrAutoArchiveOnMerge: repository.githubPrAutoArchiveOnMerge === true,
          githubPrInitialInstructions: repository.githubPrInitialInstructions ?? DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS,
          githubPrFeedbackInstructions: repository.githubPrFeedbackInstructions ?? DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS,
          githubPrReviewInstructions: repository.githubPrReviewInstructions ?? DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS,
          githubPrTaskCreatedCommentTemplate:
            repository.githubPrTaskCreatedCommentTemplate ?? DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE,
          githubPrTaskOwnerUserId: repository.githubPrTaskOwnerUserId ?? "",
          slackChannelId: repository.slackChannelId ?? "",
          slackInitialInstructions: repository.slackInitialInstructions ?? DEFAULT_SLACK_INITIAL_INSTRUCTIONS,
          slackFeedbackInstructions: repository.slackFeedbackInstructions ?? DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS,
          slackTaskCreatedReplyTemplate: repository.slackTaskCreatedReplyTemplate ?? DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE,
          slackTaskOwnerUserId: repository.slackTaskOwnerUserId ?? "",
          inboundWebhookSecret: "",
          clearInboundWebhookSecret: false,
          harnessWhatExists: repository.harnessWhatExists ?? "",
          harnessAllowedActions: repository.harnessAllowedActions ?? "",
          harnessNotAllowedActions: repository.harnessNotAllowedActions ?? "",
          harnessHowToWork: repository.harnessHowToWork ?? "",
          harnessDefinitionOfDone: repository.harnessDefinitionOfDone ?? "",
          harnessEvidenceExpectations: repository.harnessEvidenceExpectations ?? ""
        });
        const initial =
          repository.githubPrWebhookSecretConfigured === true
            ? storedInitial
            : { ...storedInitial, githubPrWebhookSecret: generateSuggestedWebhookSecret() };
        form.setFieldsValue(initial);
        setInitialSnapshot(snapshotValues(storedInitial));
        setGithubWebhookSecretVisible(repository.githubPrWebhookSecretConfigured !== true);
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

  useEffect(() => {
    if (defaultProviderModelsLoading) {
      return;
    }
    if (!selectedDefaultModel?.trim()) {
      return;
    }
    if (defaultProviderModels.some((option) => option.value === selectedDefaultModel)) {
      return;
    }
    form.setFieldValue("defaultModel", undefined);
  }, [defaultProviderModels, defaultProviderModelsLoading, form, selectedDefaultModel]);

  useEffect(() => {
    if (!selectedDefaultProviderProfile) {
      return;
    }
    if (allowedDefaultEffortOptions.some((option) => option.value === selectedDefaultProviderProfile)) {
      return;
    }
    form.setFieldValue("defaultProviderProfile", undefined);
  }, [allowedDefaultEffortOptions, form, selectedDefaultProviderProfile]);

  useEffect(() => {
    if (activeTab !== "integrations" || !editingRepository || integrationsLoaded) {
      return;
    }
    setIntegrationsLoaded(true);
    void Promise.all([
      api.listIntegrationRules(editingRepository.id),
      api.listWebhookInbox(editingRepository.id, { limit: 50 })
    ]).then(([rules, entries]) => {
      setIntegrationRules(rules);
      setInboxEntries(entries);
    }).catch(() => {});
  }, [activeTab, editingRepository, integrationsLoaded]);

  const loadIntegrationRules = async (repoId: string) => {
    try {
      const rules = await api.listIntegrationRules(repoId);
      setIntegrationRules(rules);
    } catch {}
  };

  const loadInboxEntries = async (repoId: string) => {
    try {
      const entries = await api.listWebhookInbox(repoId, { limit: 50 });
      setInboxEntries(entries);
    } catch {}
  };

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

  const renderMcpServerList = (
    name: "mcpServers",
    label: string,
    addLabel: string
  ) => (
    <Form.List
      name={name}
      rules={[
        {
          validator: async (_, value: RepositoryFormValues["mcpServers"]) => {
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
        <Flex vertical gap={8} style={{ marginBottom: 16 }}>
          <Typography.Text strong>{label}</Typography.Text>
          {fields.map((field) => (
            <div
              key={field.key}
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: 8,
                padding: 12,
                width: "100%"
              }}
            >
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Flex align="center" justify="space-between" gap={8} wrap="wrap">
                  <Typography.Text strong>{`Server ${field.name + 1}`}</Typography.Text>
                  <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                    Remove
                  </Button>
                </Flex>
                <Form.Item name={[field.name, "name"]} label="Name" rules={[{ required: true, whitespace: true }]}>
                  <Input placeholder="github" />
                </Form.Item>
                <Form.Item name={[field.name, "enabled"]} label="Enabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name={[field.name, "transport"]} label="Transport" rules={[{ required: true }]}>
                  <Select options={mcpTransportOptions} />
                </Form.Item>
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    const transport = form.getFieldValue([name, field.name, "transport"]) ?? "stdio";
                    return transport === "http" ? (
                      <>
                        <Form.Item
                          name={[field.name, "url"]}
                          label="URL"
                          rules={[
                            { required: true, whitespace: true },
                            { type: "url", message: "Enter a valid absolute URL." }
                          ]}
                        >
                          <Input placeholder="https://example.com/mcp" />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "bearerTokenEnvVar"]}
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
                        >
                          <Input placeholder="MY_MCP_TOKEN" />
                        </Form.Item>
                      </>
                    ) : (
                      <>
                        <Form.Item name={[field.name, "command"]} label="Command" rules={[{ required: true, whitespace: true }]}>
                          <Input placeholder="docker" />
                        </Form.Item>
                        <Form.Item name={[field.name, "argsText"]} label="Arguments">
                          <Input.TextArea rows={6} placeholder={"run\n-i\n--rm\nmcp/memory"} />
                        </Form.Item>
                      </>
                    );
                  }}
                </Form.Item>
              </Space>
            </div>
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
                bearerTokenEnvVar: ""
              })
            }
          >
            {addLabel}
          </Button>
          <Form.ErrorList errors={errors} />
        </Flex>
      )}
    </Form.List>
  );

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
        onFinish={async () => {
          setSubmitting(true);
          try {
            const normalized = normalizeValues(form.getFieldsValue(true) as Partial<RepositoryFormValues>);
            const requiredGeneralFields = requireRepositoryGeneralFields(form, normalized, () => setActiveTab("general"));
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
              name: requiredGeneralFields.name,
              url: requiredGeneralFields.url,
              defaultBranch: requiredGeneralFields.defaultBranch,
              defaultProvider: normalized.defaultProvider ?? null,
              defaultModel: normalized.defaultModel?.trim() || null,
              defaultProviderProfile: normalized.defaultProviderProfile ?? null,
              envVars,
              envSecrets,
              mcpServers: normalized.mcpServers.map((server) =>
                server.transport === "http"
                  ? {
                      name: server.name,
                      enabled: server.enabled,
                      transport: "http" as const,
                      url: server.url.trim(),
                      bearerTokenEnvVar: server.bearerTokenEnvVar.trim() || null
                    }
                  : {
                      name: server.name,
                      enabled: server.enabled,
                      transport: "stdio" as const,
                      command: server.command.trim(),
                      args: server.argsText
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean)
                    }
              ),
              hostCommands: normalized.hostCommands.map((entry) => entry.name.trim()).filter(Boolean),
              webhookEnabled: normalized.webhookEnabled,
              webhookUrl: normalized.webhookUrl.trim().length > 0 ? normalized.webhookUrl.trim() : null,
              ...(normalized.webhookSecret.trim().length > 0 ? { webhookSecret: normalized.webhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearWebhookSecret ? { clearWebhookSecret: true } : {}),
              ...(normalized.githubPrWebhookSecret.trim().length > 0 ? { githubPrWebhookSecret: normalized.githubPrWebhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearGithubPrWebhookSecret ? { clearGithubPrWebhookSecret: true } : {}),
              ...(normalized.inboundWebhookSecret.trim().length > 0 ? { inboundWebhookSecret: normalized.inboundWebhookSecret.trim() } : {}),
              ...(editingRepository && normalized.clearInboundWebhookSecret ? { clearInboundWebhookSecret: true } : {}),
              githubIntegrationBotLogin: normalized.githubIntegrationBotLogin.trim().replace(/^@+/, "") || null,
              githubPrAllowedUsers: parseAllowedGitHubUsers(normalized.githubPrAllowedUsers),
              githubPrRequireBotMention: normalized.githubPrRequireBotMention === true,
              githubPrAutoArchiveOnMerge: normalized.githubPrAutoArchiveOnMerge === true,
              githubPrInitialInstructions:
                normalized.githubPrInitialInstructions.trim() === DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS
                  ? null
                  : normalized.githubPrInitialInstructions.trim() || null,
              githubPrFeedbackInstructions:
                normalized.githubPrFeedbackInstructions.trim() === DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
                  ? null
                  : normalized.githubPrFeedbackInstructions.trim() || null,
              githubPrReviewInstructions:
                normalized.githubPrReviewInstructions.trim() === DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS
                  ? null
                  : normalized.githubPrReviewInstructions.trim() || null,
              githubPrTaskCreatedCommentTemplate:
                normalized.githubPrTaskCreatedCommentTemplate.trim() === DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE
                  ? null
                  : normalized.githubPrTaskCreatedCommentTemplate.trim() || null,
              githubPrTaskOwnerUserId: normalized.githubPrTaskOwnerUserId.trim() || null,
              slackChannelId: normalized.slackChannelId.trim() || null,
              slackInitialInstructions:
                normalized.slackInitialInstructions.trim() === DEFAULT_SLACK_INITIAL_INSTRUCTIONS
                  ? null
                  : normalized.slackInitialInstructions.trim() || null,
              slackFeedbackInstructions:
                normalized.slackFeedbackInstructions.trim() === DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS
                  ? null
                  : normalized.slackFeedbackInstructions.trim() || null,
              slackTaskCreatedReplyTemplate:
                normalized.slackTaskCreatedReplyTemplate.trim() === DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE
                  ? null
                  : normalized.slackTaskCreatedReplyTemplate.trim() || null,
              slackTaskOwnerUserId: normalized.slackTaskOwnerUserId.trim() || null,
              harnessWhatExists: normalized.harnessWhatExists.trim() || null,
              harnessAllowedActions: normalized.harnessAllowedActions.trim() || null,
              harnessNotAllowedActions: normalized.harnessNotAllowedActions.trim() || null,
              harnessHowToWork: normalized.harnessHowToWork.trim() || null,
              harnessDefinitionOfDone: normalized.harnessDefinitionOfDone.trim() || null,
              harnessEvidenceExpectations: normalized.harnessEvidenceExpectations.trim() || null
            };
            if (mode === "edit" && editingRepository) {
              await api.updateRepository(editingRepository.id, payload);
            } else {
              await api.createRepository(payload);
            }
            router.push(`/repositories?saved=${mode === "edit" ? "updated" : "created"}`);
          } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Failed to save repository");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Flex vertical gap={16}>
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            <Typography.Text type="secondary">Manage reusable repository definitions for task creation.</Typography.Text>
          </Flex>

          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as typeof activeTab)}
            items={[
              { key: "general", label: "General" },
              { key: "ai", label: "AI" },
              { key: "github", label: "Github" },
              { key: "slack", label: "Slack" },
              { key: "webhooks", label: "Webhooks" },
              { key: "integrations", label: "Integrations" }
            ]}
          />

          {activeTab === "general" ? (
            <Card bordered={false} title="General">
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="url" label="URL" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="defaultBranch" label="Default Branch" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Card>
          ) : null}

          {activeTab === "ai" ? (
            <Flex vertical gap={16}>
              <Card bordered={false} title="Default Agent">
                <Typography.Text type="secondary">
                  Optional repository-level defaults for new tasks. Leave any field empty to fall back to the system setting.
                </Typography.Text>
                <Form.Item name="defaultProvider" label="Provider" style={{ marginTop: 16 }}>
                  <Select
                    allowClear
                    placeholder="System default"
                    options={repositoryDefaultProviderOptions}
                    onChange={(value: AgentProvider | undefined) => {
                      if (!value) {
                        form.setFieldValue("defaultModel", undefined);
                        form.setFieldValue("defaultProviderProfile", undefined);
                        return;
                      }
                      const nextEffortOptions = getEffortOptionsForProvider(value);
                      if (!nextEffortOptions.some((option) => option.value === form.getFieldValue("defaultProviderProfile"))) {
                        form.setFieldValue("defaultProviderProfile", undefined);
                      }
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="defaultModel"
                  label="Model"
                  extra={
                    defaultProviderModelsSource === "api"
                      ? "Model suggestions were refreshed from the provider."
                      : "Model choices come from the model list in Settings."
                  }
                >
                  <Select
                    allowClear
                    showSearch
                    options={defaultProviderModels}
                    loading={defaultProviderModelsLoading}
                    optionFilterProp="label"
                    placeholder="System default"
                  />
                </Form.Item>
                <Form.Item name="defaultProviderProfile" label="Effort">
                  <Select allowClear options={allowedDefaultEffortOptions} placeholder="System default" />
                </Form.Item>
              </Card>
              <Card bordered={false} title="MCP">
                {renderMcpServerList("mcpServers", "MCP Servers", "Add MCP server")}
              </Card>
            </Flex>
          ) : null}

          {activeTab === "github" ? (
          <Card bordered={false} title="Github Integration">
            <Flex vertical gap={12}>
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
                    <Input.Password
                      visibilityToggle={{
                        visible: githubWebhookSecretVisible,
                        onVisibleChange: setGithubWebhookSecretVisible
                      }}
                    />
                  </Form.Item>
                  {editingRepository.githubPrWebhookSecretConfigured ? (
                    <Form.Item name="clearGithubPrWebhookSecret" valuePropName="checked">
                      <Checkbox>Clear stored Github webhook secret</Checkbox>
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    name="githubIntegrationBotLogin"
                    label="GitHub Bot User"
                    tooltip="Comments from this GitHub login are ignored by the PR feedback webhook to prevent reply loops."
                    rules={[{ max: 255, message: "Login must be 255 characters or fewer." }]}
                  >
                    <Input placeholder="verft-bot" addonBefore="@" autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="githubPrAllowedUsers"
                    label="Allowed GitHub Users"
                    extra="Optional. When set, only feedback from these GitHub users is processed. Enter one login per line or separate logins with commas."
                  >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder={"alice\nbob"} />
                  </Form.Item>
                  <Form.Item
                    name="githubPrRequireBotMention"
                    label="Only Process Bot Mentions"
                    valuePropName="checked"
                    extra="When enabled and a GitHub bot user is configured, issue and PR comments are ignored unless the body mentions that bot user."
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="githubPrAutoArchiveOnMerge"
                    label="Archive Task When PR Merges"
                    valuePropName="checked"
                    extra="When enabled, a GitHub pull request merged webhook archives the linked task."
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="githubPrTaskOwnerUserId"
                    label="GitHub-Created Task Owner"
                    extra={
                      usersLoadError
                        ? `Users could not be loaded: ${usersLoadError}`
                        : "Required for creating a new task from unlinked GitHub issue, pull request feedback, or pull request review request events."
                    }
                  >
                    <Select
                      allowClear
                      showSearch
                      disabled={Boolean(usersLoadError)}
                      placeholder="Select task owner"
                      optionFilterProp="label"
                      options={users.map((user) => ({
                        value: user.id,
                        label: `${user.name} <${user.email}>${user.active ? "" : " (inactive)"}`,
                        disabled: !user.active
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="githubPrTaskCreatedCommentTemplate"
                    label="Task Created Comment"
                    extra="Posted back to GitHub when Verft creates a new task. Supports {{task_url}}, {{task_id}}, {{target_ref}}, {{author}}, and {{repository_full_name}}."
                    rules={[{ max: 8000, message: "Comment template must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("githubPrTaskCreatedCommentTemplate", DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE);
                    }}
                  >
                    Reset task created comment
                  </Button>
                  <Form.Item
                    name="githubPrInitialInstructions"
                    label="Initial Agent Instructions"
                    extra={`Used when GitHub creates a new Verft task. ${GITHUB_TEMPLATE_MARKER_HELP}`}
                    rules={[{ max: 8000, message: "Instructions must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("githubPrInitialInstructions", DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS);
                    }}
                  >
                    Reset initial instructions
                  </Button>
                  <Form.Item
                    name="githubPrFeedbackInstructions"
                    label="Agent Feedback Instructions"
                    extra={`Used when GitHub adds feedback to an existing linked task. ${GITHUB_TEMPLATE_MARKER_HELP}`}
                    rules={[{ max: 8000, message: "Instructions must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("githubPrFeedbackInstructions", DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS);
                    }}
                  >
                    Reset feedback instructions
                  </Button>
                  <Form.Item
                    name="githubPrReviewInstructions"
                    label="Review Agent Instructions"
                    extra={`Used when GitHub requests a pull request review from the integration bot. ${GITHUB_TEMPLATE_MARKER_HELP}`}
                    rules={[{ max: 8000, message: "Instructions must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("githubPrReviewInstructions", DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS);
                    }}
                  >
                    Reset review instructions
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
                          2. Verft MCP is connected to agents automatically. After creating a PR, agents call{" "}
                          <Typography.Text code>verft_link_pull_request</Typography.Text> with:
                        </Typography.Text>
                        <Typography.Text code>{`{ "taskId": "task_id", "prNumber": 123 }`}</Typography.Text>
                        <Typography.Text>
                          3. In GitHub, create a webhook with content type <Typography.Text code>application/json</Typography.Text>, this payload URL,
                          this secret, and events: pull requests, issue comments, pull request review comments, pull request reviews.
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
                  description="After creation, Verft will show the repository-scoped Github webhook URL and webhook secret setup."
                />
              )}
            </Flex>
          </Card>
          ) : null}

          {activeTab === "slack" ? (
          <Card bordered={false} title="Slack Integration">
            <Flex vertical gap={12}>
              {mode === "edit" && editingRepository ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="Slack app credentials are configured in global Settings"
                    description="Use Settings > Slack for the app Event URL, Signing Secret, and Bot Token. This repository only selects the Slack channel and task behavior."
                  />
                  <Form.Item
                    name="slackChannelId"
                    label="Slack Channel ID"
                    extra="Only messages from this Slack channel are processed for this repository."
                    rules={[{ pattern: /^[CG][A-Z0-9]{2,}$/, message: "Use a Slack channel ID such as C0123456789 or G0123456789." }]}
                  >
                    <Input placeholder="C0123456789" autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="slackTaskOwnerUserId"
                    label="Slack-Created Task Owner"
                    extra={
                      usersLoadError
                        ? `Users could not be loaded: ${usersLoadError}`
                        : "Required for creating a new task from an unlinked Slack thread."
                    }
                  >
                    <Select
                      allowClear
                      showSearch
                      disabled={Boolean(usersLoadError)}
                      placeholder="Select task owner"
                      optionFilterProp="label"
                      options={users.map((user) => ({
                        value: user.id,
                        label: `${user.name} <${user.email}>${user.active ? "" : " (inactive)"}`,
                        disabled: !user.active
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="slackTaskCreatedReplyTemplate"
                    label="Task Created Thread Reply"
                    extra="Posted in Slack when Verft creates a new task. Supports {{task_url}}, {{task_id}}, {{author}}, {{channel_id}}, {{thread_ts}}, and {{message_ts}}."
                    rules={[{ max: 8000, message: "Reply template must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("slackTaskCreatedReplyTemplate", DEFAULT_SLACK_TASK_CREATED_REPLY_TEMPLATE);
                    }}
                  >
                    Reset task created reply
                  </Button>
                  <Form.Item
                    name="slackInitialInstructions"
                    label="Initial Agent Instructions"
                    extra="Used when Slack creates a new Verft task. Supports {{channel_id}}, {{thread_ts}}, {{message_ts}}, {{author}}, {{url_line}}, {{feedback_body}}, {{task_title}}, and {{repository_name}}."
                    rules={[{ max: 8000, message: "Instructions must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("slackInitialInstructions", DEFAULT_SLACK_INITIAL_INSTRUCTIONS);
                    }}
                  >
                    Reset initial instructions
                  </Button>
                  <Form.Item
                    name="slackFeedbackInstructions"
                    label="Agent Feedback Instructions"
                    extra="Used when Slack thread replies add feedback to an existing linked task. Supports {{channel_id}}, {{thread_ts}}, {{message_ts}}, {{author}}, {{url_line}}, {{feedback_body}}, {{task_title}}, and {{repository_name}}."
                    rules={[{ max: 8000, message: "Instructions must be 8000 characters or fewer." }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
                  </Form.Item>
                  <Button
                    onClick={() => {
                      form.setFieldValue("slackFeedbackInstructions", DEFAULT_SLACK_FEEDBACK_INSTRUCTIONS);
                    }}
                  >
                    Reset feedback instructions
                  </Button>
                  <Alert
                    type="info"
                    showIcon
                    message="Thread flow"
                    description="In Slack, subscribe the app to app_mention and message events. Verft creates tasks from root mentions in the configured channel and queues linked thread replies as follow-up feedback."
                  />
                </>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="Save the repository first"
                  description="After creation, configure this repository's Slack Channel ID. The Slack app Event URL, Signing Secret, and Bot Token live in global Settings."
                />
              )}
            </Flex>
          </Card>
          ) : null}

          {activeTab === "general" ? (
            <Flex vertical gap={16}>
              <Card bordered={false} title="Environment">
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
              </Card>
              <Card bordered={false} title="Host Commands">
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="Hostexec bridge commands"
                  description="These simple command names are mounted as read-only shims for this repository when hostexec is enabled in Settings. Existing runtime binaries are not overwritten."
                />
                <Form.List
                  name="hostCommands"
                  rules={[
                    {
                      validator: async (_, value: RepositoryFormValues["hostCommands"]) => {
                        const seen = new Set<string>();
                        for (const entry of value ?? []) {
                          const name = normalizeHostCommandName(entry?.name);
                          if (!name) {
                            continue;
                          }
                          if (!HOST_COMMAND_PATTERN.test(name)) {
                            throw new Error(`Invalid host command name: ${name}`);
                          }
                          const comparable = name.toLowerCase();
                          if (seen.has(comparable)) {
                            throw new Error(`Duplicate host command: ${name}`);
                          }
                          seen.add(comparable);
                        }
                      }
                    }
                  ]}
                >
                  {(fields, { add, remove }, { errors }) => (
                    <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                      <Typography.Text strong>Mounted Commands</Typography.Text>
                      {fields.map((field) => (
                        <Flex key={field.key} gap={8} align="start" wrap="wrap">
                          <Form.Item
                            {...field}
                            name={[field.name, "name"]}
                            rules={[
                              { required: true, whitespace: true },
                              {
                                pattern: HOST_COMMAND_PATTERN,
                                message: "Use a simple command name without slashes."
                              }
                            ]}
                            style={{ flex: "1 1 260px", marginBottom: 0 }}
                          >
                            <Input placeholder="xcodebuild" />
                          </Form.Item>
                          <Button danger onClick={() => remove(field.name)}>
                            Remove
                          </Button>
                        </Flex>
                      ))}
                      <Button onClick={() => add({ name: "" })}>Add command</Button>
                      <Form.ErrorList errors={errors} />
                    </Flex>
                  )}
                </Form.List>
              </Card>
              <Card bordered={false} title="Harness">
                <Flex vertical gap={12}>
                  <Typography.Text type="secondary">
                    Write standing repository guidance for agents. These fields are optional and are used to guide task runs for this repository.
                  </Typography.Text>
                  <Form.Item
                    name="harnessWhatExists"
                    label="1. What exists?"
                    extra="Repository understanding: apps, packages, docs, important folders, generated files, and runtime services."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="1. What exists?" />
                  </Form.Item>
                  <Form.Item
                    name="harnessAllowedActions"
                    label="2. What is allowed?"
                    extra="Constraints and policies: what agents may edit, what is protected, secret handling, network/Docker limits, and PR rules."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="2. What is allowed?" />
                  </Form.Item>
                  <Form.Item
                    name="harnessNotAllowedActions"
                    label="3. What is not allowed?"
                    extra="Restrictions and off-limits actions: what agents must never do, protected files or branches, forbidden commands, and hard constraints."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="3. What is not allowed?" />
                  </Form.Item>
                  <Form.Item
                    name="harnessHowToWork"
                    label="4. How should you work?"
                    extra="Process and decision-making: planning expectations, approval points, branch flow, preferred commands, and when to ask questions."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="4. How should you work?" />
                  </Form.Item>
                  <Form.Item
                    name="harnessDefinitionOfDone"
                    label="5. How do you know you are done?"
                    extra="Validation and quality gates: required checks, tests, builds, and review criteria."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="5. How do you know you are done?" />
                  </Form.Item>
                  <Form.Item
                    name="harnessEvidenceExpectations"
                    label="6. How do you prove it?"
                    extra="Expected proof: command outcomes, links, screenshots, changed docs, and skipped-check explanations."
                    rules={[{ max: 8000, message: "Keep this answer at 8000 characters or fewer." }]}
                  >
                    <HarnessMarkdownField label="6. How do you prove it?" />
                  </Form.Item>
                </Flex>
              </Card>
            </Flex>
          ) : null}

          {activeTab === "webhooks" ? (
            <Card bordered={false} title="Webhooks">
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
                <Input placeholder="https://example.com/webhooks/verft" />
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
          ) : null}

          {activeTab === "integrations" ? (
            mode === "edit" && editingRepository ? (
              <Flex vertical gap={16}>
                <Card bordered={false} title="Inbound Webhook Endpoint">
                  <Form.Item label="Webhook URL">
                    <Input
                      readOnly
                      value={buildApiUrl(`/integrations/webhooks/${editingRepository.id}`)}
                      addonAfter={
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={() => {
                            void navigator.clipboard.writeText(buildApiUrl(`/integrations/webhooks/${editingRepository.id}`));
                            messageApi.success("Webhook URL copied");
                          }}
                        >
                          Copy
                        </Button>
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    name="inboundWebhookSecret"
                    label={
                      editingRepository.inboundWebhookSecretConfigured
                        ? "Webhook Signature Secret (leave blank to keep existing)"
                        : "Webhook Signature Secret (optional)"
                    }
                    extra="Optional. Use this only for webhook sources that support HMAC-SHA256 signatures. When set, matching requests must include X-Webhook-Signature or GitHub's X-Hub-Signature-256."
                  >
                    <Input.Password />
                  </Form.Item>
                  {editingRepository.inboundWebhookSecretConfigured ? (
                    <Form.Item name="clearInboundWebhookSecret" valuePropName="checked">
                      <Checkbox>Clear stored inbound webhook secret</Checkbox>
                    </Form.Item>
                  ) : null}
                </Card>

                <Card
                  bordered={false}
                  title="Integration Rules"
                  extra={
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setEditingRule(null);
                        setRuleEditorOpen(true);
                      }}
                    >
                      Add Rule
                    </Button>
                  }
                >
                  {integrationRules.length === 0 ? (
                    <Typography.Text type="secondary">No integration rules configured. Add a rule to match incoming webhook payloads and create tasks automatically.</Typography.Text>
                  ) : (
                    <Flex vertical gap={8}>
                      {integrationRules.map((rule) => (
                        <Card key={rule.id} size="small" bordered>
                          <Flex justify="space-between" align="center">
                            <Flex align="center" gap={12}>
                              <Switch
                                checked={rule.enabled}
                                size="small"
                                onChange={async (checked) => {
                                  try {
                                    await api.updateIntegrationRule(editingRepository.id, rule.id, { enabled: checked });
                                    await loadIntegrationRules(editingRepository.id);
                                  } catch {
                                    messageApi.error("Failed to toggle rule");
                                  }
                                }}
                              />
                              <Typography.Text strong>{rule.name}</Typography.Text>
                              <Tag>{rule.filter.conditions.length} condition{rule.filter.conditions.length !== 1 ? "s" : ""}</Tag>
                            </Flex>
                            <Space>
                              <Button
                                icon={<EditOutlined />}
                                size="small"
                                onClick={() => {
                                  setEditingRule(rule);
                                  setRuleEditorOpen(true);
                                }}
                              />
                              <Button
                                icon={<DeleteOutlined />}
                                size="small"
                                danger
                                onClick={async () => {
                                  try {
                                    await api.deleteIntegrationRule(editingRepository.id, rule.id);
                                    await loadIntegrationRules(editingRepository.id);
                                    messageApi.success("Rule deleted");
                                  } catch {
                                    messageApi.error("Failed to delete rule");
                                  }
                                }}
                              />
                            </Space>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  )}
                </Card>

                <Card bordered={false} title="Webhook Inbox" extra={
                  <Button size="small" onClick={() => void loadInboxEntries(editingRepository.id)}>Refresh</Button>
                }>
                  {inboxEntries.length === 0 ? (
                    <Typography.Text type="secondary">No webhook deliveries received yet.</Typography.Text>
                  ) : (
                    <Table
                      dataSource={inboxEntries}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      columns={[
                        {
                          title: "Received",
                          dataIndex: "receivedAt",
                          width: 180,
                          render: (value: string) => new Date(value).toLocaleString()
                        },
                        {
                          title: "Source IP",
                          dataIndex: "sourceIp",
                          width: 140,
                          render: (value: string | null) => value ?? "-"
                        },
                        {
                          title: "Headers",
                          dataIndex: "headers",
                          width: 110,
                          render: (value: WebhookInboxEntry["headers"], record: WebhookInboxEntry) => (
                            <Button
                              icon={<EyeOutlined />}
                              size="small"
                              onClick={() => setInboxJsonModal({ title: `Headers - ${new Date(record.receivedAt).toLocaleString()}`, value })}
                            >
                              Headers
                            </Button>
                          )
                        },
                        {
                          title: "Body Preview",
                          dataIndex: "body",
                          ellipsis: true,
                          render: (value: unknown, record: WebhookInboxEntry) => {
                            const text = formatJsonValue(value).replace(/\s+/g, " ");
                            const preview = text.length > 80 ? `${text.slice(0, 80)}...` : text;
                            return (
                              <Flex align="center" justify="space-between" gap={8}>
                                <Typography.Text ellipsis style={{ minWidth: 0 }}>
                                  {preview}
                                </Typography.Text>
                                <Button
                                  icon={<EyeOutlined />}
                                  size="small"
                                  onClick={() => setInboxJsonModal({ title: `Body - ${new Date(record.receivedAt).toLocaleString()}`, value })}
                                >
                                  Body
                                </Button>
                              </Flex>
                            );
                          }
                        },
                        {
                          title: "Matched",
                          dataIndex: "matchedRuleId",
                          width: 100,
                          render: (value: string | null) => value ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>
                        },
                        {
                          title: "",
                          width: 80,
                          render: (_: unknown, record: WebhookInboxEntry) => (
                            <Space>
                              <Button icon={<EyeOutlined />} size="small" onClick={() => setInboxDetailEntry(record)} />
                              <Button icon={<DeleteOutlined />} size="small" danger onClick={async () => {
                                try {
                                  await api.deleteWebhookInboxEntry(editingRepository.id, record.id);
                                  await loadInboxEntries(editingRepository.id);
                                } catch {
                                  messageApi.error("Failed to delete entry");
                                }
                              }} />
                            </Space>
                          )
                        }
                      ]}
                    />
                  )}
                </Card>

                <IntegrationRuleEditorModal
                  open={ruleEditorOpen}
                  rule={editingRule}
                  users={users}
                  onClose={() => setRuleEditorOpen(false)}
                  onSave={async (input: CreateIntegrationRuleInput) => {
                    try {
                      if (editingRule) {
                        await api.updateIntegrationRule(editingRepository.id, editingRule.id, input);
                      } else {
                        await api.createIntegrationRule(editingRepository.id, input);
                      }
                      setRuleEditorOpen(false);
                      await loadIntegrationRules(editingRepository.id);
                      messageApi.success(editingRule ? "Rule updated" : "Rule created");
                    } catch {
                      messageApi.error("Failed to save rule");
                    }
                  }}
                />

                <Modal
                  open={Boolean(inboxDetailEntry)}
                  title="Webhook Delivery Detail"
                  onCancel={() => setInboxDetailEntry(null)}
                  footer={[
                    <Button
                      key="create-rule"
                      onClick={() => {
                        if (!inboxDetailEntry) return;
                        setEditingRule(null);
                        setRuleEditorOpen(true);
                        setInboxDetailEntry(null);
                      }}
                    >
                      Create Rule from This
                    </Button>,
                    <Button key="close" type="primary" onClick={() => setInboxDetailEntry(null)}>Close</Button>
                  ]}
                  width={720}
                >
                  {inboxDetailEntry ? (
                    <Flex vertical gap={16}>
                      <div>
                        <Typography.Text strong>Headers</Typography.Text>
                        <pre style={{ maxHeight: 200, overflow: "auto", fontSize: 12, background: "#f5f5f5", padding: 8, borderRadius: 4 }}>
                          {formatJsonValue(inboxDetailEntry.headers)}
                        </pre>
                      </div>
                      <div>
                        <Typography.Text strong>Body</Typography.Text>
                        <pre style={{ maxHeight: 400, overflow: "auto", fontSize: 12, background: "#f5f5f5", padding: 8, borderRadius: 4 }}>
                          {formatJsonValue(inboxDetailEntry.body)}
                        </pre>
                      </div>
                    </Flex>
                  ) : null}
                </Modal>

                <Modal
                  open={Boolean(inboxJsonModal)}
                  title={inboxJsonModal?.title ?? "Webhook JSON"}
                  onCancel={() => setInboxJsonModal(null)}
                  footer={<Button type="primary" onClick={() => setInboxJsonModal(null)}>Close</Button>}
                  width={860}
                  styles={{ body: { paddingTop: 12 } }}
                >
                  {inboxJsonModal ? (
                    <pre
                      style={{
                        maxHeight: "70vh",
                        overflow: "auto",
                        fontSize: 12,
                        background: "#f5f5f5",
                        padding: 12,
                        borderRadius: 4,
                        whiteSpace: "pre"
                      }}
                    >
                      {formatJsonValue(inboxJsonModal.value)}
                    </pre>
                  ) : null}
                </Modal>
              </Flex>
            ) : (
              <Alert message="Integration rules can be configured after the repository is created." type="info" showIcon />
            )
          ) : null}

          {mode === "edit" && editingRepository ? (
            <Card bordered={false} title="Repository ID">
              <Typography.Paragraph copyable style={{ marginBottom: 0, wordBreak: "break-all" }}>
                {editingRepository.id}
              </Typography.Paragraph>
            </Card>
          ) : null}

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
                {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
              </Typography.Text>
              <Space wrap>
                <Button onClick={goBack}>Cancel</Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                  disabled={!hasUnsavedChanges || submitting}
                >
                  {mode === "edit" ? "Save" : "Create"}
                </Button>
              </Space>
            </Flex>
          </Card>
        </Flex>
      </Form>
    </>
  );
}
