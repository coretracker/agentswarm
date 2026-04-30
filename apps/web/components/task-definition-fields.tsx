"use client";

import { useEffect, useState } from "react";
import type { FormInstance } from "antd";
import type {
  AgentProvider,
  CreateTaskPromptAttachmentInput,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  ProviderProfile,
  Repository,
  SystemSettings,
  TaskBranchStrategy,
  TaskDefinitionInput,
  TaskSourceType,
  TaskStartMode,
  TaskType
} from "@agentswarm/shared-types";
import { getAgentProviderLabel, getDefaultModelForProvider, getEffortOptionsForProvider, getModelsForProvider } from "@agentswarm/shared-types";
import { Alert, Button, Card, Checkbox, Col, Flex, Form, Input, Row, Select, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";
import { type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { useAuth } from "./auth-provider";
import { TaskPromptAttachmentsInput } from "./task-prompt-attachments-input";

export type TaskDefinitionFormValues = {
  sourceType?: TaskSourceType;
  title?: string;
  repoId?: string;
  prompt?: string;
  notes?: string;
  startMode?: TaskStartMode;
  taskType?: TaskType;
  provider?: AgentProvider;
  model?: string;
  providerProfile?: ProviderProfile;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  issueNumber?: number;
  includeComments?: boolean;
  pullRequestNumber?: number;
};

export interface TaskDefinitionFieldsProps {
  form: FormInstance<TaskDefinitionFormValues>;
  syncSettingsDefaults?: boolean;
  promptImageFiles?: SelectedTaskPromptImageFile[];
  onPromptImageFilesChange?: (nextFiles: SelectedTaskPromptImageFile[]) => void;
}

const providerOptions = (
  hasOpenAi: boolean,
  hasAnthropic: boolean
): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex (OpenAI)", value: "codex", disabled: !hasOpenAi },
  { label: getAgentProviderLabel("claude"), value: "claude", disabled: !hasAnthropic }
];

const getProviderDefaultModel = (provider: AgentProvider, settings?: SystemSettings | null): string =>
  provider === "claude"
    ? settings?.claudeDefaultModel ?? getDefaultModelForProvider(provider)
    : settings?.codexDefaultModel ?? getDefaultModelForProvider(provider);

const getProviderDefaultProfile = (provider: AgentProvider, settings?: SystemSettings | null): ProviderProfile =>
  provider === "claude" ? settings?.claudeDefaultEffort ?? "high" : settings?.codexDefaultEffort ?? "high";

export const getTaskDefinitionInitialValues = (settings?: SystemSettings | null): Partial<TaskDefinitionFormValues> => {
  const provider = settings?.defaultProvider ?? "codex";
  return {
    sourceType: "blank",
    taskType: "build",
    provider,
    model: getProviderDefaultModel(provider, settings),
    providerProfile: getProviderDefaultProfile(provider, settings),
    branchStrategy: "feature_branch",
    includeComments: true,
    startMode: "prepare_workspace"
  };
};

/** Suggested title for blank tasks: "Build · …" or "Interactive · …" — updates until the title field is edited. */
export function buildBlankAutoTaskTitle(params: {
  taskType: TaskType;
  startMode?: TaskStartMode;
  repoName: string | undefined;
  branchName: string | undefined;
  modelLabel: string;
}): string {
  const kind =
    params.startMode === "prepare_workspace"
      ? "Interactive"
      : params.taskType === "ask"
        ? "Ask"
        : "Build";
  const repo = params.repoName?.trim() || "Repository";
  const branch = params.branchName?.trim() || "—";
  const model = params.modelLabel.trim() || "—";
  return `${kind} · ${repo} · ${branch} · ${model}`;
}

export const buildTaskDefinitionInput = (
  values: TaskDefinitionFormValues,
  promptAttachments: CreateTaskPromptAttachmentInput[] = []
): TaskDefinitionInput => {
  if (values.sourceType === "blank") {
    return {
      sourceType: "blank",
      title: values.title?.trim() ?? "",
      repoId: values.repoId ?? "",
      prompt: values.prompt?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
      startMode: values.startMode ?? "run_now",
      taskType: values.taskType ?? "build",
      provider: values.provider ?? "codex",
      model: values.model?.trim() ?? "",
      providerProfile: values.providerProfile ?? "high",
      baseBranch: values.baseBranch?.trim() ?? "",
      branchStrategy: values.branchStrategy ?? "feature_branch"
    };
  }

  if (values.sourceType === "issue") {
    return {
      sourceType: "issue",
      title: values.title?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      repoId: values.repoId ?? "",
      issueNumber: values.issueNumber ?? 0,
      includeComments: values.includeComments ?? true,
      startMode: values.startMode ?? "run_now",
      taskType: values.taskType === "build" || values.taskType === "ask" ? values.taskType : "build",
      provider: values.provider ?? "codex",
      model: values.model?.trim() ?? "",
      providerProfile: values.providerProfile ?? "high",
      baseBranch: values.baseBranch?.trim() ?? "",
      branchStrategy: values.branchStrategy ?? "feature_branch"
    };
  }

  return {
    sourceType: "pull_request",
    title: values.title?.trim() || undefined,
    notes: values.notes?.trim() || undefined,
    repoId: values.repoId ?? "",
    pullRequestNumber: values.pullRequestNumber ?? 0,
    provider: values.provider ?? "codex",
    model: values.model?.trim() ?? "",
    providerProfile: values.providerProfile ?? "high"
  };
};

export function TaskDefinitionFields({
  form,
  syncSettingsDefaults = true,
  promptImageFiles = [],
  onPromptImageFilesChange
}: TaskDefinitionFieldsProps) {
  const { can, session } = useAuth();
  const { repositories } = useRepositories();
  const { settings } = useSettings();
  const [githubIssues, setGitHubIssues] = useState<GitHubIssueReference[]>([]);
  const [githubPullRequests, setGitHubPullRequests] = useState<GitHubPullRequestReference[]>([]);
  const [githubBranches, setGitHubBranches] = useState<GitHubBranchReference[]>([]);
  const [githubOptionsLoading, setGitHubOptionsLoading] = useState(false);
  const canReadRepositoryMetadata = can("repo:read");
  const canBuildTasks = can("task:build");
  const canAskTasks = can("task:ask");
  const canUseInteractiveTerminal = can("task:interactive");
  const canRunAutomatedTask = canBuildTasks || canAskTasks;

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedModel = Form.useWatch("model", form);
  const selectedBaseBranch = Form.useWatch("baseBranch", form);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const selectedStartMode = (Form.useWatch("startMode", form) as TaskStartMode | undefined) ?? "prepare_workspace";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const selectedIssueNumber = Form.useWatch("issueNumber", form);
  const selectedPullRequestNumber = Form.useWatch("pullRequestNumber", form);
  const { models: providerModels, loading: providerModelsLoading } = useProviderModels(selectedProvider);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const selectedIssue = githubIssues.find((issue) => issue.number === selectedIssueNumber) ?? null;
  const selectedPullRequest = githubPullRequests.find((pullRequest) => pullRequest.number === selectedPullRequestNumber) ?? null;
  const isBlankSource = selectedSourceType === "blank";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const effectiveTaskType = isPullRequestSource ? "build" : selectedTaskType;
  const isImplementationTask = effectiveTaskType === "build";
  const baseBranchLabel = isBlankSource || isIssueSource ? "Base Branch" : undefined;
  const providerMissingCredentials =
    selectedProvider === "codex"
      ? !(settings?.openaiApiKeyConfigured || session?.user.codexAuthJsonConfigured)
      : !settings?.anthropicApiKeyConfigured;
  const roleAllowedProviders = session?.user.allowedProviders ?? [];
  const roleAllowedModels = session?.user.allowedModels ?? [];
  const roleAllowedEfforts = session?.user.allowedEfforts ?? [];
  const providerSelectOptions = providerOptions(
    Boolean(settings?.openaiApiKeyConfigured || session?.user.codexAuthJsonConfigured),
    Boolean(settings?.anthropicApiKeyConfigured)
  ).map(
    (option) => ({
      ...option,
      disabled: Boolean(option.disabled || (roleAllowedProviders.length > 0 && !roleAllowedProviders.includes(option.value)))
    })
  );
  const allowedModelOptions = providerModels.filter(
    (option) => roleAllowedModels.length === 0 || roleAllowedModels.includes(option.value)
  );
  const allowedEffortOptions = getEffortOptionsForProvider(selectedProvider).filter(
    (option) => roleAllowedEfforts.length === 0 || roleAllowedEfforts.includes(option.value)
  );
  const sourceOptions: Array<{ label: string; value: TaskSourceType }> = [
    { label: "Blank", value: "blank" },
    ...(canReadRepositoryMetadata
      ? [
          { label: "From Issue", value: "issue" as const },
          ...(canBuildTasks ? [{ label: "From Pull Request", value: "pull_request" as const }] : [])
        ]
      : [])
  ];
  const startModeOptions: Array<{ label: string; value: TaskStartMode }> = [
    ...(canRunAutomatedTask ? [{ label: "Run automated agent now", value: "run_now" as const }] : []),
    ...(canUseInteractiveTerminal ? [{ label: "Prepare workspace only", value: "prepare_workspace" as const }] : [])
  ];
  const taskTypeOptions: Array<{ label: string; value: TaskType }> = [
    ...(canBuildTasks ? [{ label: "Build", value: "build" as const }] : []),
    ...(canAskTasks ? [{ label: "Ask", value: "ask" as const }] : [])
  ];

  useEffect(() => {
    if (canReadRepositoryMetadata || selectedSourceType === "blank") {
      return;
    }

    form.setFieldValue("sourceType", "blank");
  }, [canReadRepositoryMetadata, form, selectedSourceType]);

  useEffect(() => {
    if (selectedSourceType === "pull_request" && !canBuildTasks) {
      form.setFieldValue("sourceType", canReadRepositoryMetadata ? "issue" : "blank");
    }
  }, [canBuildTasks, canReadRepositoryMetadata, form, selectedSourceType]);

  useEffect(() => {
    if (!settings || !syncSettingsDefaults) {
      return;
    }

    const currentProvider = form.getFieldValue("provider") as AgentProvider | undefined;
    const shouldReplaceProvider = !form.isFieldTouched("provider") && (!currentProvider || currentProvider === "codex");
    const nextProvider = shouldReplaceProvider ? settings.defaultProvider : currentProvider ?? settings.defaultProvider;
    const providerChanged = nextProvider !== currentProvider;

    if (shouldReplaceProvider) {
      form.setFieldValue("provider", nextProvider);
    }

    const currentModel = form.getFieldValue("model") as string | undefined;
    const currentProfile = form.getFieldValue("providerProfile") as ProviderProfile | undefined;
    const genericModel = getDefaultModelForProvider(currentProvider ?? nextProvider);

    if (!form.isFieldTouched("model") && (providerChanged || !currentModel || currentModel === genericModel)) {
      form.setFieldValue("model", getProviderDefaultModel(nextProvider, settings));
    }

    if (!form.isFieldTouched("providerProfile") && (providerChanged || !currentProfile || currentProfile === "high")) {
      form.setFieldValue("providerProfile", getProviderDefaultProfile(nextProvider, settings));
    }
  }, [form, settings, syncSettingsDefaults]);

  useEffect(() => {
    const selected = providerSelectOptions.find((option) => option.value === selectedProvider && !option.disabled);
    if (selected) {
      return;
    }

    const fallback = providerSelectOptions.find((option) => !option.disabled);
    if (!fallback) {
      return;
    }

    form.setFieldValue("provider", fallback.value);
  }, [form, providerSelectOptions, selectedProvider]);

  useEffect(() => {
    if (allowedModelOptions.length === 0) {
      return;
    }
    if (allowedModelOptions.some((option) => option.value === selectedModel)) {
      return;
    }
    form.setFieldValue("model", allowedModelOptions[0]?.value);
  }, [allowedModelOptions, form, selectedModel]);

  useEffect(() => {
    if (allowedEffortOptions.length === 0) {
      return;
    }
    const currentProfile = form.getFieldValue("providerProfile") as ProviderProfile | undefined;
    if (currentProfile && allowedEffortOptions.some((option) => option.value === currentProfile)) {
      return;
    }
    form.setFieldValue("providerProfile", allowedEffortOptions[0]?.value);
  }, [allowedEffortOptions, form]);

  useEffect(() => {
    if (selectedSourceType !== "blank") {
      return;
    }
    if (form.isFieldTouched("title")) {
      return;
    }
    const modelLabel =
      providerModels.find((option) => option.value === selectedModel)?.label ??
      (typeof selectedModel === "string" ? selectedModel : "");
    form.setFieldValue(
      "title",
      buildBlankAutoTaskTitle({
        taskType: selectedTaskType,
        startMode: selectedStartMode,
        repoName: selectedRepository?.name,
        branchName: typeof selectedBaseBranch === "string" ? selectedBaseBranch : undefined,
        modelLabel
      })
    );
  }, [
    form,
    providerModels,
    selectedBaseBranch,
    selectedModel,
    selectedRepository?.name,
    selectedSourceType,
    selectedStartMode,
    selectedTaskType
  ]);

  useEffect(() => {
    if ((isBlankSource || isIssueSource) && selectedStartMode === "prepare_workspace" && selectedTaskType !== "build") {
      form.setFieldValue("taskType", "build");
    }
  }, [form, isBlankSource, isIssueSource, selectedStartMode, selectedTaskType]);

  useEffect(() => {
    if (selectedTaskType === "build" && !canBuildTasks && canAskTasks) {
      form.setFieldValue("taskType", "ask");
      return;
    }

    if (selectedTaskType === "ask" && !canAskTasks && canBuildTasks) {
      form.setFieldValue("taskType", "build");
    }
  }, [canAskTasks, canBuildTasks, form, selectedTaskType]);

  useEffect(() => {
    if (!(isBlankSource || isIssueSource)) {
      return;
    }

    if (selectedStartMode === "prepare_workspace" && !canUseInteractiveTerminal) {
      form.setFieldValue("startMode", "run_now");
      return;
    }

    if (selectedStartMode !== "prepare_workspace" && !canRunAutomatedTask && canUseInteractiveTerminal) {
      form.setFieldValue("startMode", "prepare_workspace");
    }
  }, [canRunAutomatedTask, canUseInteractiveTerminal, form, isBlankSource, isIssueSource, selectedStartMode]);

  useEffect(() => {
    if ((isBlankSource || isIssueSource) && selectedStartMode === "idle") {
      form.setFieldValue("startMode", "run_now");
    }
  }, [form, isBlankSource, isIssueSource, selectedStartMode]);

  useEffect(() => {
    if (!selectedRepoId || !canReadRepositoryMetadata) {
      setGitHubIssues([]);
      setGitHubPullRequests([]);
      setGitHubBranches([]);
      return;
    }

    let active = true;
    setGitHubOptionsLoading(true);

    void Promise.all([
      api.listGitHubBranches(selectedRepoId).catch(() => []),
      api.listGitHubIssues(selectedRepoId).catch(() => []),
      api.listGitHubPullRequests(selectedRepoId).catch(() => [])
    ]).then(([branches, issues, pullRequests]) => {
      if (!active) {
        return;
      }

      setGitHubBranches(branches);
      setGitHubIssues(issues);
      setGitHubPullRequests(pullRequests);
      setGitHubOptionsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [canReadRepositoryMetadata, selectedRepoId]);

  const promptPanelTitle = isBlankSource ? (effectiveTaskType === "ask" ? "Question" : "Prompt") : "Imported Context";
  const requirePromptForBlank = selectedStartMode === "run_now";
  const disableBlankPromptInput = isBlankSource && selectedStartMode === "prepare_workspace";
  const canAttachPromptImages = isBlankSource && selectedStartMode === "run_now";

  useEffect(() => {
    if (selectedSourceType === "blank") {
      return;
    }

    if ((promptImageFiles?.length ?? 0) > 0) {
      onPromptImageFilesChange?.([]);
    }
  }, [onPromptImageFilesChange, promptImageFiles?.length, selectedSourceType]);

  const renderPromptPanel = (repository: Repository | null) => {
    if (isBlankSource) {
      return (
        <>
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: "Enter a task title" }]}
            style={{ marginBottom: 16 }}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Suggested from task type, repository, base branch, and model until you edit this field.
              </Typography.Text>
            }
          >
            <Input placeholder="Build · my-org/my-repo · main · GPT-5.4" size="large" />
          </Form.Item>
          <Form.Item
            name="prompt"
            label={promptPanelTitle}
            rules={
              requirePromptForBlank
                ? [{ required: true, message: effectiveTaskType === "ask" ? "Enter a question" : "Enter a prompt" }]
                : []
            }
            extra={
              disableBlankPromptInput ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Disabled for workspace preparation only. Switch to run now to enter a prompt.
                </Typography.Text>
              ) : !requirePromptForBlank ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Optional for this start mode — you can describe intent later or work only in Interactive.
                </Typography.Text>
              ) : undefined
            }
            style={{ marginBottom: 0, flex: 1, display: "flex", flexDirection: "column" }}
          >
            <Flex vertical gap={12} style={{ flex: 1 }}>
              <Input.TextArea
                autoSize={{ minRows: 12, maxRows: 28 }}
                style={{ resize: "none" }}
                disabled={disableBlankPromptInput}
                placeholder={
                  disableBlankPromptInput
                    ? "Prompt is disabled while preparing the workspace only."
                    : effectiveTaskType === "ask"
                    ? requirePromptForBlank
                      ? "Ask a repository question."
                      : "Optional question for the agent when you start a run."
                    : requirePromptForBlank
                      ? "Describe the goal, constraints, and expected outcome in your prompt."
                      : "Optional — add a goal now or open Interactive after the workspace is prepared."
                }
              />
              <TaskPromptAttachmentsInput
                files={promptImageFiles}
                onChange={(nextFiles) => onPromptImageFilesChange?.(nextFiles)}
                onError={(errorMessage) => void message.error(errorMessage)}
                disabled={!canAttachPromptImages || !onPromptImageFilesChange}
              />
            </Flex>
          </Form.Item>
          <Form.Item
            name="notes"
            label="Notes (Markdown)"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Optional. These notes are shown in the task Info tab below current configuration.
              </Typography.Text>
            }
            style={{ marginTop: 16, marginBottom: 0 }}
          >
            <Input.TextArea
              autoSize={{ minRows: 6, maxRows: 16 }}
              style={{ resize: "none" }}
              placeholder="Add markdown notes for context, acceptance criteria, links, or reminders."
            />
          </Form.Item>
        </>
      );
    }

    if (isIssueSource) {
      return (
        <Flex vertical gap={16}>
          <Alert
            type="info"
            showIcon
            message="Issue content is imported from GitHub"
            description="The issue title, body, and optional comments become the task prompt. Use the left-side configuration to select the issue and task behavior."
          />
          <Form.Item name="title" label="Task Title Override" style={{ marginBottom: 0 }}>
            <Input placeholder="Optional. Leave blank to use the issue title." size="large" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Imported against repository <Typography.Text code>{repository?.name ?? "unknown"}</Typography.Text>.
          </Typography.Paragraph>
          {selectedIssue ? (
            <Alert
              type="success"
              showIcon
              message={`Issue #${selectedIssue.number}: ${selectedIssue.title}`}
              description={
                <Typography.Link href={selectedIssue.url} target="_blank">
                  Open issue in GitHub
                </Typography.Link>
              }
            />
          ) : null}
          <Form.Item
            name="notes"
            label="Notes (Markdown)"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Optional. These notes are shown in the task Info tab below current configuration.
              </Typography.Text>
            }
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea
              autoSize={{ minRows: 6, maxRows: 16 }}
              style={{ resize: "none" }}
              placeholder="Add markdown notes for context, acceptance criteria, links, or reminders."
            />
          </Form.Item>
        </Flex>
      );
    }

    return (
      <Flex vertical gap={16}>
        <Alert
          type="info"
          showIcon
          message="Pull request review threads are imported from GitHub"
          description="AgentSwarm will create a build task from unresolved pull request review threads and continue work on the pull request branch."
        />
        <Form.Item name="title" label="Task Title Override" style={{ marginBottom: 0 }}>
          <Input placeholder="Optional. Leave blank to use the pull request title." size="large" />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          The task targets the pull request head branch and uses <Typography.Text code>work_on_branch</Typography.Text>.
        </Typography.Paragraph>
        {selectedPullRequest ? (
          <Alert
            type="success"
            showIcon
            message={`PR #${selectedPullRequest.number}: ${selectedPullRequest.title}`}
            description={
              <Space wrap>
                <Typography.Link href={selectedPullRequest.url} target="_blank">
                  Open pull request in GitHub
                </Typography.Link>
                <Typography.Text type="secondary">
                  {selectedPullRequest.baseBranch} {"->"} {selectedPullRequest.headBranch}
                </Typography.Text>
              </Space>
              }
            />
          ) : null}
        <Form.Item
          name="notes"
          label="Notes (Markdown)"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Optional. These notes are shown in the task Info tab below current configuration.
            </Typography.Text>
          }
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            autoSize={{ minRows: 6, maxRows: 16 }}
            style={{ resize: "none" }}
            placeholder="Add markdown notes for context, acceptance criteria, links, or reminders."
          />
        </Form.Item>
      </Flex>
    );
  };

  return (
    <Row gutter={[24, 24]} align="stretch">
      <Col xs={24} xl={8}>
        <Card bordered={false} title="Configuration" styles={{ body: { display: "flex", flexDirection: "column", gap: 0 } }}>
          <Form.Item name="sourceType" label="Source" rules={[{ required: true }]}>
            <Select
              options={sourceOptions}
              onChange={(value: TaskSourceType) => {
                if (value === "pull_request") {
                  form.setFieldValue("taskType", "build");
                  form.setFieldValue("branchStrategy", "work_on_branch");
                  form.setFieldValue("startMode", "run_now");
                }

                if (value !== "blank") {
                  form.setFieldValue("prompt", undefined);
                }

                if (value === "issue" || value === "pull_request") {
                  form.setFieldValue("title", undefined);
                  form.setFields([{ name: "title", touched: false }]);
                }
              }}
            />
          </Form.Item>

          <Form.Item name="repoId" label="Repository" rules={[{ required: true }]}>
            <Select
              options={repositories.map((repository) => ({ label: repository.name, value: repository.id }))}
              placeholder="Select repository"
              onChange={(repoId) => {
                const repository = repositories.find((item) => item.id === repoId);
                form.setFieldValue("baseBranch", repository?.defaultBranch ?? "");
                form.setFieldValue("issueNumber", undefined);
                form.setFieldValue("pullRequestNumber", undefined);
              }}
            />
          </Form.Item>

          {isPullRequestSource ? (
            <Form.Item name="pullRequestNumber" label="Pull Request" rules={[{ required: true }]}>
              <Select
                showSearch
                loading={githubOptionsLoading}
                placeholder={selectedRepoId ? "Select open pull request" : "Select repository first"}
                optionFilterProp="label"
                disabled={!selectedRepoId}
                options={githubPullRequests.map((pullRequest) => ({
                  label: `#${pullRequest.number} ${pullRequest.title}`,
                  value: pullRequest.number
                }))}
              />
            </Form.Item>
          ) : null}

          {isIssueSource ? (
            <>
              <Form.Item name="issueNumber" label="Issue" rules={[{ required: true }]}>
                <Select
                  showSearch
                  loading={githubOptionsLoading}
                  placeholder={selectedRepoId ? "Select open issue" : "Select repository first"}
                  optionFilterProp="label"
                  disabled={!selectedRepoId}
                  options={githubIssues.map((issue) => ({
                    label: `#${issue.number} ${issue.title}`,
                    value: issue.number
                  }))}
                />
              </Form.Item>
              <Form.Item name="includeComments" valuePropName="checked">
                <Checkbox>Include issue comments</Checkbox>
              </Form.Item>
            </>
          ) : null}

          {isBlankSource || isIssueSource ? (
            <Form.Item name="startMode" label="Start mode" rules={[{ required: true }]}>
              <Select options={startModeOptions} />
            </Form.Item>
          ) : null}

          {isBlankSource && selectedStartMode !== "prepare_workspace" ? (
            <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
              <Select options={taskTypeOptions} />
            </Form.Item>
          ) : null}

          {!canRunAutomatedTask && !canUseInteractiveTerminal ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="This role cannot create build, ask, or interactive tasks."
              description="Ask an administrator to grant task mode permissions in Settings."
            />
          ) : null}

          <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
            <Select
              options={providerSelectOptions}
              onChange={(value: AgentProvider) => {
                const nextModels = getModelsForProvider(value).filter(
                  (option) => roleAllowedModels.length === 0 || roleAllowedModels.includes(option.value)
                );
                const nextEfforts = getEffortOptionsForProvider(value).filter(
                  (option) => roleAllowedEfforts.length === 0 || roleAllowedEfforts.includes(option.value)
                );
                form.setFieldValue("model", nextModels[0]?.value ?? getProviderDefaultModel(value, settings));
                form.setFieldValue("providerProfile", nextEfforts[0]?.value ?? getProviderDefaultProfile(value, settings));
              }}
            />
          </Form.Item>

          <Form.Item name="model" label="Model" rules={[{ required: true }]}>
            <Select options={allowedModelOptions} loading={providerModelsLoading} showSearch optionFilterProp="label" />
          </Form.Item>

          <Form.Item name="providerProfile" label="Effort" rules={[{ required: true }]}>
            <Select options={allowedEffortOptions} />
          </Form.Item>

          {providerMissingCredentials ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${selectedProvider === "codex" ? "Codex" : "Anthropic"} credentials are missing`}
              description={
                selectedProvider === "codex"
                  ? "Configure Codex auth.json in your Profile or set an OpenAI API key in Settings before running this task."
                  : "Configure the provider credential in Settings before running this task."
              }
            />
          ) : null}

          {isIssueSource ? (
            <>
              {selectedStartMode !== "prepare_workspace" ? (
                <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
                  <Select options={taskTypeOptions} />
                </Form.Item>
              ) : null}
            </>
          ) : null}

          {(isBlankSource || isIssueSource) && baseBranchLabel ? (
            <Form.Item name="baseBranch" label={baseBranchLabel} rules={[{ required: true }]}>
              <Select
                showSearch
                loading={githubOptionsLoading}
                placeholder={selectedRepository?.defaultBranch ?? "develop"}
                optionFilterProp="label"
                options={
                  canReadRepositoryMetadata
                    ? githubBranches.map((branch) => ({
                        label: branch.isDefault ? `${branch.name} (default)` : branch.name,
                        value: branch.name
                      }))
                    : selectedRepository
                      ? [{ label: selectedRepository.defaultBranch, value: selectedRepository.defaultBranch }]
                      : []
                }
              />
            </Form.Item>
          ) : null}

          {(isBlankSource && isImplementationTask) || (isIssueSource && selectedTaskType === "build") ? (
            <Form.Item name="branchStrategy" label="Branch Strategy" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: "Create feature branch", value: "feature_branch" },
                  { label: "Work on existing branch", value: "work_on_branch" }
                ]}
              />
            </Form.Item>
          ) : null}
        </Card>
      </Col>

      <Col xs={24} xl={16}>
        <Card
          bordered={false}
          title={promptPanelTitle}
          styles={{
            body: {
              display: "flex",
              flexDirection: "column",
              minHeight: 640
            }
          }}
        >
          {renderPromptPanel(selectedRepository)}
        </Card>
      </Col>
    </Row>
  );
}
