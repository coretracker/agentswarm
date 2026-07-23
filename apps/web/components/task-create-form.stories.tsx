import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import type { AuthSession, Repository, SystemSettings, Task } from "@verft/shared-types";
import { App, Button, Flex, Form, Space, Typography } from "antd";
import { api } from "../src/api/client";
import { type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { AuthProvider } from "./auth-provider";
import {
  TaskDefinitionFields,
  type TaskDefinitionFormValues,
  buildTaskDefinitionInput,
  getTaskDefinitionInitialValues
} from "./task-definition-fields";

const now = new Date("2026-07-22T09:00:00.000Z").toISOString();

const mockSession: AuthSession = {
  user: {
    id: "user-storybook",
    name: "Andreas",
    email: "andreas@example.com",
    githubUsername: "andreas",
    defaultProvider: null,
    defaultModel: null,
    defaultProviderProfile: null,
    active: true,
    roles: [{ id: "role-admin", name: "Admin", isSystem: true }],
    repositoryIds: [],
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    scopes: ["task:create", "task:build", "task:ask", "repo:list", "repo:read", "settings:read"],
    allowedProviders: [],
    allowedModels: [],
    allowedEfforts: []
  },
  expiresAt: new Date("2026-07-22T17:00:00.000Z").toISOString()
};

const mockRepositories: Repository[] = [
  {
    id: "repo-verft",
    name: "verft",
    url: "https://github.com/example/verft",
    defaultBranch: "main",
    defaultProvider: "codex",
    defaultModel: "gpt-5.5",
    defaultProviderProfile: "high",
    envVars: [],
    envSecrets: [],
    mcpServers: [],
    hostCommands: ["npm run ci"],
    webhookUrl: null,
    webhookEnabled: false,
    webhookSecretConfigured: false,
    webhookLastAttemptAt: null,
    webhookLastStatus: null,
    webhookLastError: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "repo-harness",
    name: "agent-harness",
    url: "https://github.com/example/agent-harness",
    defaultBranch: "develop",
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-8",
    defaultProviderProfile: "max",
    envVars: [],
    envSecrets: [],
    mcpServers: [],
    hostCommands: [],
    webhookUrl: null,
    webhookEnabled: false,
    webhookSecretConfigured: false,
    webhookLastAttemptAt: null,
    webhookLastStatus: null,
    webhookLastError: null,
    createdAt: now,
    updatedAt: now
  }
];

const mockSettings: SystemSettings = {
  defaultProvider: "codex",
  maxAgents: 4,
  archivedTaskAutoDeleteEnabled: false,
  archivedTaskAutoDeleteDays: 30,
  branchPrefix: "task/",
  workspaceProvisioningMode: "hybrid",
  gitUsername: "verft-agent",
  gitAuthorName: "Verft Agent",
  gitAuthorEmail: "agent@example.com",
  hostexec: {
    enabled: false,
    url: null,
    bearerTokenEnvVar: null
  },
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  githubTokenConfigured: true,
  openaiApiKeyConfigured: true,
  anthropicApiKeyConfigured: true,
  slackSigningSecretConfigured: false,
  slackBotTokenConfigured: false,
  codexDefaultModel: "gpt-5.5",
  codexModels: [
    { label: "GPT-5.5", value: "gpt-5.5" },
    { label: "GPT-5.4 mini", value: "gpt-5.4-mini" }
  ],
  codexDefaultEffort: "high",
  claudeDefaultModel: "claude-opus-4-8",
  claudeModels: [
    { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" }
  ],
  claudeDefaultEffort: "high"
};

const createMockTask = (values: TaskDefinitionFormValues): Task => ({
  id: "task-storybook-created",
  title: values.title ?? "Storybook task",
  pinned: false,
  hasPendingCheckpoint: false,
  autoApplyCheckpoints: false,
  activeInteractiveSession: false,
  activeTerminalSessionMode: null,
  linkedWorkspaces: [],
  parentTaskId: null,
  rootTaskId: null,
  ownerUserId: mockSession.user.id,
  creatorName: mockSession.user.name,
  repoId: values.repoId ?? "repo-verft",
  repoName: mockRepositories.find((repository) => repository.id === values.repoId)?.name ?? "verft",
  repoUrl: "https://github.com/example/verft",
  repoDefaultBranch: "main",
  githubPrNumber: null,
  githubIssueNumber: null,
  slackChannelId: null,
  slackThreadTs: null,
  taskType: values.taskType ?? "build",
  provider: values.provider ?? "codex",
  providerProfile: values.providerProfile ?? "high",
  modelOverride: values.model ?? null,
  baseBranch: values.baseBranch ?? "main",
  branchStrategy: values.branchStrategy ?? "feature_branch",
  complexity: "normal",
  branchName: "task/storybook-created-task",
  workspaceBaseRef: values.baseBranch ?? "main",
  prompt: values.prompt ?? "",
  resultMarkdown: null,
  executionSummary: "",
  branchDiff: null,
  pullCount: 0,
  pushCount: 0,
  lastAction: values.taskType ?? "build",
  status: values.taskType === "ask" ? "ask_queued" : "build_queued",
  workflowStatus: "ready",
  executionStatus: "queued",
  executionAction: values.taskType ?? "build",
  reviewReason: null,
  logs: [],
  enqueued: true,
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  finishedAt: null,
  errorMessage: null
});

api.getSession = async () => mockSession;
api.listRepositories = async () => mockRepositories;
api.listRepositoryBranches = async (id) => ({
  branches: id === "repo-harness" ? ["develop", "feature/runner-cache"] : ["main", "develop", "feature/storybook-coverage"]
});
api.getSettings = async () => mockSettings;
api.listModels = async (provider) => ({
  models: provider === "claude" ? mockSettings.claudeModels : mockSettings.codexModels,
  source: "cache"
});
api.createTask = async (input) => createMockTask({
  title: input.title,
  repoId: input.repoId,
  prompt: input.prompt,
  taskType: input.taskType,
  provider: input.provider,
  model: input.modelOverride ?? input.model,
  providerProfile: input.providerProfile,
  baseBranch: input.baseBranch,
  branchStrategy: input.branchStrategy
});

function TaskCreateFormDemo() {
  const [form] = Form.useForm<TaskDefinitionFormValues>();
  const { message } = App.useApp();
  const [promptImageFiles, setPromptImageFiles] = useState<SelectedTaskPromptImageFile[]>([]);

  const handleSubmit = async (values: TaskDefinitionFormValues) => {
    const definition = buildTaskDefinitionInput(values);
    await api.createTask({
      title: definition.title,
      repoId: definition.repoId,
      prompt: definition.prompt,
      taskType: definition.taskType,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy
    });
    message.success("Storybook task created");
  };

  return (
    <AuthProvider>
      <App>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          scrollToFirstError={{ focus: true }}
          initialValues={{
            ...getTaskDefinitionInitialValues(mockSettings, mockRepositories[0], mockSession.user),
            repoId: "repo-verft",
            baseBranch: "main",
            title: "Add create task form to Storybook",
            prompt: "Add a Storybook story that renders the create task form with realistic repository defaults."
          }}
          onFinish={handleSubmit}
        >
          <Flex vertical gap={16}>
            <Flex align="center" justify="space-between" gap={16} wrap="wrap">
              <Flex vertical gap={0}>
                <Typography.Title level={2} style={{ margin: 0 }}>
                  New Build Task
                </Typography.Title>
                <Typography.Text type="secondary">
                  Pick a repository, describe the work, and start.
                </Typography.Text>
              </Flex>
              <Space>
                <Button>Cancel</Button>
                <Button>Save Draft</Button>
                <Button type="primary" htmlType="submit">
                  Create Task
                </Button>
              </Space>
            </Flex>

            <TaskDefinitionFields
              form={form}
              promptImageFiles={promptImageFiles}
              onPromptImageFilesChange={setPromptImageFiles}
            />
          </Flex>
        </Form>
      </App>
    </AuthProvider>
  );
}

const meta = {
  title: "Components/TaskCreateForm",
  component: TaskCreateFormDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen"
  },
  render: () => <TaskCreateFormDemo />
} satisfies Meta<typeof TaskCreateFormDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
