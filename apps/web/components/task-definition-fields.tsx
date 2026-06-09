"use client";

import { useEffect, useState } from "react";
import type { FormInstance } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type {
  AgentProvider,
  CodexCredentialSource,
  CreateTaskPromptAttachmentInput,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  ProviderProfile,
  Repository,
  Snippet,
  SnippetVariable,
  SystemSettings,
  TaskBranchStrategy,
  TaskDefinitionInput,
  TaskSourceType,
  TaskType
} from "@agentswarm/shared-types";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  getModelsForProvider
} from "@agentswarm/shared-types";
import { Alert, Button, Card, Checkbox, Col, DatePicker, Flex, Form, Input, Modal, Row, Select, Space, Typography, message } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { api } from "../src/api/client";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";
import { useSnippets } from "../src/hooks/useSnippets";
import { trackEvent } from "../src/utils/analytics";
import { applySnippetVariables, insertSnippetContent } from "../src/utils/snippets";
import { type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { useAuth } from "./auth-provider";
import { TaskPromptAttachmentsInput } from "./task-prompt-attachments-input";

export type TaskDefinitionFormValues = {
  sourceType?: TaskSourceType;
  title?: string;
  deadline?: string | null | Dayjs;
  repoId?: string;
  prompt?: string;
  notes?: string;
  taskType?: TaskType;
  provider?: AgentProvider;
  model?: string;
  providerProfile?: ProviderProfile;
  codexCredentialSource?: CodexCredentialSource;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  issueNumber?: number;
  includeComments?: boolean;
  pullRequestNumber?: number;
  snippetId?: string;
  snippetVariables?: Record<string, string>;
};

export interface TaskDefinitionFieldsProps {
  form: FormInstance<TaskDefinitionFormValues>;
  syncSettingsDefaults?: boolean;
  promptImageFiles?: SelectedTaskPromptImageFile[];
  onPromptImageFilesChange?: (nextFiles: SelectedTaskPromptImageFile[]) => void;
}

type SnippetVariableFormValues = Record<string, string>;

const providerOptions = (
  hasOpenAi: boolean,
  hasAnthropic: boolean
): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex (OpenAI)", value: "codex", disabled: !hasOpenAi },
  { label: getAgentProviderLabel("claude"), value: "claude", disabled: !hasAnthropic }
];

const codexCredentialSourceOptions: Array<{ label: string; value: CodexCredentialSource }> = [
  { label: "Auto (Profile then Global)", value: "auto" },
  { label: "Profile auth.json only", value: "profile" },
  { label: "Global OpenAI key only", value: "global" }
];

const getProviderDefaultModel = (provider: AgentProvider, settings?: SystemSettings | null): string =>
  provider === "claude"
    ? settings?.claudeDefaultModel ?? getDefaultModelForProvider(provider)
    : settings?.codexDefaultModel ?? getDefaultModelForProvider(provider);

const getProviderDefaultProfile = (provider: AgentProvider, settings?: SystemSettings | null): ProviderProfile =>
  provider === "claude" ? settings?.claudeDefaultEffort ?? "high" : settings?.codexDefaultEffort ?? "high";

const deriveTitleFromPrompt = (prompt: string): string => {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }

  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  if (heading) {
    return heading.replace(/^#{1,6}\s+/, "").trim();
  }

  return lines[0];
};

export const getTaskDefinitionDeadlineIso = (value: TaskDefinitionFormValues["deadline"]): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = dayjs.isDayjs(value) ? value : dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : undefined;
};

export const getTaskDefinitionInitialValues = (
  settings?: SystemSettings | null
): Partial<TaskDefinitionFormValues> => {
  const provider = settings?.defaultProvider ?? "codex";
  return {
    sourceType: "blank",
    taskType: "build",
    provider,
    model: getProviderDefaultModel(provider, settings),
    providerProfile: getProviderDefaultProfile(provider, settings),
    codexCredentialSource: "auto",
    branchStrategy: "feature_branch",
    includeComments: true
  };
};

export const buildTaskDefinitionInput = (
  values: TaskDefinitionFormValues,
  promptAttachments: CreateTaskPromptAttachmentInput[] = [],
  snippetContent?: string,
  snippetVariablesDefinition: SnippetVariable[] = []
): TaskDefinitionInput => {
  const provider = values.provider ?? "codex";
  const codexCredentialSource = provider === "codex" ? (values.codexCredentialSource ?? "auto") : undefined;

  if (values.sourceType === "blank") {
    return {
      sourceType: "blank",
      title: values.title?.trim() ?? "",
      deadline: getTaskDefinitionDeadlineIso(values.deadline) ?? null,
      repoId: values.repoId ?? "",
      prompt: values.prompt?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
      taskType: values.taskType ?? "build",
      provider,
      model: values.model?.trim() ?? "",
      providerProfile: values.providerProfile ?? "high",
      ...(codexCredentialSource ? { codexCredentialSource } : {}),
      baseBranch: values.baseBranch?.trim() ?? "",
      branchStrategy: values.branchStrategy ?? "feature_branch"
    };
  }

  if (values.sourceType === "issue") {
    return {
      sourceType: "issue",
      title: values.title?.trim() || undefined,
      deadline: getTaskDefinitionDeadlineIso(values.deadline) ?? null,
      notes: values.notes?.trim() || undefined,
      repoId: values.repoId ?? "",
      issueNumber: values.issueNumber ?? 0,
      includeComments: values.includeComments ?? true,
      taskType: values.taskType === "build" || values.taskType === "ask" ? values.taskType : "build",
      provider,
      model: values.model?.trim() ?? "",
      providerProfile: values.providerProfile ?? "high",
      ...(codexCredentialSource ? { codexCredentialSource } : {}),
      baseBranch: values.baseBranch?.trim() ?? "",
      branchStrategy: values.branchStrategy ?? "feature_branch"
    };
  }

  if (values.sourceType === "snippet") {
    const renderedPrompt = applySnippetVariables(snippetContent ?? "", snippetVariablesDefinition, values.snippetVariables ?? {});
    return {
      sourceType: "snippet",
      title: values.title?.trim() ?? "",
      deadline: getTaskDefinitionDeadlineIso(values.deadline) ?? null,
      repoId: values.repoId ?? "",
      snippetId: values.snippetId ?? "",
      prompt: renderedPrompt.trim(),
      notes: values.notes?.trim() ?? "",
      ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
      taskType: values.taskType ?? "build",
      provider,
      model: values.model?.trim() ?? "",
      providerProfile: values.providerProfile ?? "high",
      ...(codexCredentialSource ? { codexCredentialSource } : {}),
      baseBranch: values.baseBranch?.trim() ?? "",
      branchStrategy: values.branchStrategy ?? "feature_branch"
    };
  }

  return {
    sourceType: "pull_request",
    title: values.title?.trim() || undefined,
    deadline: getTaskDefinitionDeadlineIso(values.deadline) ?? null,
    notes: values.notes?.trim() || undefined,
    repoId: values.repoId ?? "",
    pullRequestNumber: values.pullRequestNumber ?? 0,
    provider,
    model: values.model?.trim() ?? "",
    providerProfile: values.providerProfile ?? "high",
    ...(codexCredentialSource ? { codexCredentialSource } : {})
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
  const [magicPromptLoading, setMagicPromptLoading] = useState(false);
  const [selectedSnippetToInsertId, setSelectedSnippetToInsertId] = useState<string | null>(null);
  const [pendingSnippetForInsert, setPendingSnippetForInsert] = useState<Snippet | null>(null);
  const [snippetVariableModalOpen, setSnippetVariableModalOpen] = useState(false);
  const [snippetVariableForm] = Form.useForm<SnippetVariableFormValues>();
  const canReadRepositoryMetadata = can("repo:read");
  const canBuildTasks = can("task:build");
  const canAskTasks = can("task:ask");
  const canRunAutomatedTask = canBuildTasks || canAskTasks;
  const canUseSnippets = can("snippet:list");

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedModel = Form.useWatch("model", form);
  const selectedBaseBranch = Form.useWatch("baseBranch", form);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const selectedIssueNumber = Form.useWatch("issueNumber", form);
  const selectedPullRequestNumber = Form.useWatch("pullRequestNumber", form);
  const selectedSnippetId = Form.useWatch("snippetId", form);
  const selectedPrompt = Form.useWatch("prompt", form);
  const { models: providerModels, loading: providerModelsLoading } = useProviderModels(selectedProvider);
  const { snippets, loading: snippetsLoading } = useSnippets(canUseSnippets);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const selectedIssue = githubIssues.find((issue) => issue.number === selectedIssueNumber) ?? null;
  const selectedPullRequest = githubPullRequests.find((pullRequest) => pullRequest.number === selectedPullRequestNumber) ?? null;
  const isBlankSource = selectedSourceType === "blank";
  const isSnippetSource = selectedSourceType === "snippet";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const effectiveTaskType = isPullRequestSource ? "build" : selectedTaskType;
  const isImplementationTask = effectiveTaskType === "build";
  const baseBranchLabel = isBlankSource || isSnippetSource || isIssueSource ? "Base Branch" : undefined;
  const selectedSnippet = snippets.find((snippet) => snippet.id === selectedSnippetId) ?? null;
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
    ...(canUseSnippets ? [{ label: "Snippet", value: "snippet" as const }] : []),
    ...(canReadRepositoryMetadata
      ? [
          { label: "From Issue", value: "issue" as const },
          ...(canBuildTasks ? [{ label: "From Pull Request", value: "pull_request" as const }] : [])
        ]
      : [])
  ];
  const taskTypeOptions: Array<{ label: string; value: TaskType }> = [
    ...(canBuildTasks ? [{ label: "Build", value: "build" as const }] : []),
    ...(canAskTasks ? [{ label: "Ask", value: "ask" as const }] : [])
  ];

  useEffect(() => {
    if (canReadRepositoryMetadata || selectedSourceType === "blank" || selectedSourceType === "snippet") {
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
    if (providerModelsLoading) {
      return;
    }
    if (allowedModelOptions.length === 0) {
      return;
    }
    if (allowedModelOptions.some((option) => option.value === selectedModel)) {
      return;
    }
    form.setFieldValue("model", allowedModelOptions[0]?.value);
  }, [allowedModelOptions, form, providerModelsLoading, selectedModel]);

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
    if (selectedProvider !== "codex") {
      return;
    }
    const current = form.getFieldValue("codexCredentialSource") as CodexCredentialSource | undefined;
    if (current === "auto" || current === "profile" || current === "global") {
      return;
    }
    form.setFieldValue("codexCredentialSource", "auto");
  }, [form, selectedProvider]);

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
    if (!isSnippetSource || !selectedSnippet) {
      return;
    }
    const defaults = Object.fromEntries((selectedSnippet.variables ?? []).map((variable) => [variable.name, variable.defaultValue ?? ""]));
    form.setFieldValue("snippetVariables", defaults);
  }, [form, isSnippetSource, selectedSnippet]);

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

  const promptPanelTitle = isBlankSource
    ? (effectiveTaskType === "ask" ? "Question" : "Prompt")
    : isSnippetSource
      ? "Snippet Variables"
      : "Imported Context";
  const canAttachPromptImages = isBlankSource;
  const canUsePromptMagic = isBlankSource;
  const promptIsEmpty = (selectedPrompt?.trim().length ?? 0) === 0;

  const handleGeneratePromptMagic = async (): Promise<void> => {
    const prompt = (form.getFieldValue("prompt") as string | undefined)?.trim() ?? "";
    if (!prompt || magicPromptLoading) {
      return;
    }

    setMagicPromptLoading(true);
    try {
      const response = await api.generateTaskPromptMagic({ prompt });
      const nextPrompt = response.prompt ?? "";
      const currentTitle = (form.getFieldValue("title") as string | undefined)?.trim() ?? "";
      const derivedTitle = deriveTitleFromPrompt(nextPrompt);
      const nextValues: Partial<TaskDefinitionFormValues> = { prompt: nextPrompt };
      if (!currentTitle && derivedTitle) {
        nextValues.title = derivedTitle.slice(0, 500);
      }
      form.setFieldsValue(nextValues);
      form.setFields([{ name: "prompt", value: nextPrompt }]);
      trackEvent("task_prompt_magic_used", {
        source: "task_create",
        input_length: prompt.length,
        output_length: nextPrompt.length
      });
      if (nextPrompt.trim() === prompt) {
        void message.info("Magic prompt returned a similar result.");
      } else {
        void message.success("Prompt improved.");
      }
    } catch (error) {
      const fallback = "Failed to generate prompt.";
      const errorMessage = error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
      void message.error(errorMessage);
    } finally {
      setMagicPromptLoading(false);
    }
  };

  const insertIntoPrompt = (snippetContent: string | null | undefined): void => {
    const currentPrompt = form.getFieldValue("prompt") as string | undefined;
    const nextPrompt = insertSnippetContent(currentPrompt, snippetContent);
    form.setFieldValue("prompt", nextPrompt);
    form.setFields([{ name: "prompt", value: nextPrompt }]);
  };

  const handleInsertSelectedSnippet = (): void => {
    if (!selectedSnippetToInsertId) {
      return;
    }

    const snippet = snippets.find((item) => item.id === selectedSnippetToInsertId);
    if (!snippet) {
      void message.error("Selected snippet is no longer available.");
      return;
    }

    if ((snippet.variables ?? []).length > 0) {
      setPendingSnippetForInsert(snippet);
      snippetVariableForm.resetFields();
      const defaultValues = Object.fromEntries(
        (snippet.variables ?? []).map((variable) => [variable.name, variable.defaultValue ?? ""])
      );
      snippetVariableForm.setFieldsValue(defaultValues);
      setSnippetVariableModalOpen(true);
      return;
    }

    insertIntoPrompt(snippet.content);
    setSelectedSnippetToInsertId(null);
  };

  const handleConfirmSnippetVariableInsert = async (): Promise<void> => {
    if (!pendingSnippetForInsert) {
      return;
    }

    try {
      const values = await snippetVariableForm.validateFields();
      const rendered = applySnippetVariables(pendingSnippetForInsert.content, pendingSnippetForInsert.variables, values);
      insertIntoPrompt(rendered);
      setSnippetVariableModalOpen(false);
      setPendingSnippetForInsert(null);
      snippetVariableForm.resetFields();
      setSelectedSnippetToInsertId(null);
    } catch {
      // Form-level validation messages are shown inline.
    }
  };

  const handleCloseSnippetVariableModal = (): void => {
    setSnippetVariableModalOpen(false);
    setPendingSnippetForInsert(null);
    snippetVariableForm.resetFields();
    setSelectedSnippetToInsertId(null);
  };

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
                Choose a short, descriptive task title.
              </Typography.Text>
            }
          >
            <Input placeholder="Your Task Title" size="large" />
          </Form.Item>
          <Form.Item
            label={promptPanelTitle}
            style={{ marginBottom: 0, flex: 1, display: "flex", flexDirection: "column" }}
          >
            <Flex vertical gap={12} style={{ flex: 1 }}>
              <div style={{ position: "relative" }}>
                <Button
                  size="small"
                  type="default"
                  icon={<RobotOutlined />}
                  title="Magic Wand"
                  aria-label="Magic Wand"
                  loading={magicPromptLoading}
                  disabled={!canUsePromptMagic || promptIsEmpty || magicPromptLoading}
                  onClick={() => void handleGeneratePromptMagic()}
                  style={{
                    position: "absolute",
                    right: 10,
                    bottom: 10,
                    zIndex: 1
                  }}
                />
                <Form.Item
                  name="prompt"
                  style={{ marginBottom: 0 }}
                  rules={[{ required: true, message: effectiveTaskType === "ask" ? "Enter a question" : "Enter a prompt" }]}
                >
                  <Input.TextArea
                    autoSize={{ minRows: 12, maxRows: 28 }}
                    style={{ resize: "none", paddingRight: 44, paddingBottom: 38 }}
                    placeholder={
                      effectiveTaskType === "ask"
                        ? "Ask a repository question."
                        : "Describe the goal, constraints, and expected outcome in your prompt."
                    }
                  />
                </Form.Item>
              </div>
              {canUseSnippets ? (
                <Flex gap={8} wrap="wrap">
                  <Select
                    showSearch
                    style={{ minWidth: 220, flex: 1 }}
                    placeholder={snippetsLoading ? "Loading snippets..." : "Select snippet"}
                    value={selectedSnippetToInsertId}
                    onChange={(value) => setSelectedSnippetToInsertId(value)}
                    optionFilterProp="label"
                    allowClear
                    loading={snippetsLoading}
                    disabled={snippetsLoading || snippets.length === 0}
                    options={snippets.map((snippet) => ({
                      label: snippet.name,
                      value: snippet.id
                    }))}
                  />
                  <Button onClick={handleInsertSelectedSnippet} disabled={!selectedSnippetToInsertId}>
                    Insert
                  </Button>
                </Flex>
              ) : null}
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

    if (isSnippetSource) {
      return (
        <Flex vertical gap={16}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: "Enter a task title" }]} style={{ marginBottom: 0 }}>
            <Input placeholder="Your Task Title" size="large" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="Prompt input is replaced by snippet variables"
            description="Pick a snippet and fill the fields below. This reduces mistakes and keeps setup fast."
          />
          <Form.Item name="snippetId" label="Snippet" rules={[{ required: true, message: "Select a snippet" }]} style={{ marginBottom: 0 }}>
            <Select
              showSearch
              loading={snippetsLoading}
              placeholder={snippetsLoading ? "Loading snippets..." : "Select snippet"}
              optionFilterProp="label"
              options={snippets.map((snippet) => ({ label: snippet.name, value: snippet.id }))}
              onChange={() => trackEvent("snippet_selected")}
            />
          </Form.Item>
          {(selectedSnippet?.variables ?? []).map((variable) => (
            <Form.Item
              key={variable.name}
              name={["snippetVariables", variable.name]}
              label={variable.title || variable.name}
              rules={[{ required: true, message: `Enter ${variable.title || variable.name}` }]}
              extra={variable.description || undefined}
              style={{ marginBottom: 0 }}
            >
              {variable.type === "multiline" ? (
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} placeholder={variable.defaultValue || ""} />
              ) : (
                <Input placeholder={variable.defaultValue || ""} />
              )}
            </Form.Item>
          ))}
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
    <>
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} xl={8}>
          <Card bordered={false} title="Configuration" styles={{ body: { display: "flex", flexDirection: "column", gap: 0 } }}>
          <Form.Item name="sourceType" label="Source" rules={[{ required: true }]}>
            <Select
              options={sourceOptions}
              onChange={(value: TaskSourceType) => {
                trackEvent("task_source_selected", { source: value });
                if (value === "pull_request") {
                  form.setFieldValue("taskType", "build");
                  form.setFieldValue("branchStrategy", "work_on_branch");
                }
                if (value === "snippet") {
                  form.setFieldValue("taskType", "build");
                }
                if (value !== "blank") {
                  form.setFieldValue("prompt", undefined);
                }

                if (value === "issue" || value === "pull_request") {
                  form.setFieldValue("title", undefined);
                  form.setFields([{ name: "title", touched: false }]);
                }
                if (value !== "snippet") {
                  form.setFieldValue("snippetId", undefined);
                  form.setFieldValue("snippetVariables", undefined);
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

          <Form.Item name="deadline" label="Deadline">
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format="YYYY-MM-DD HH:mm"
              placeholder="No deadline"
              style={{ width: "100%" }}
              allowClear
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

          {isBlankSource || isSnippetSource ? (
            <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
              <Select options={taskTypeOptions} />
            </Form.Item>
          ) : null}

          {!canRunAutomatedTask ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="This role cannot create build or ask tasks."
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

          {selectedProvider === "codex" ? (
            <Form.Item name="codexCredentialSource" label="Codex Credential Source" rules={[{ required: true }]}>
              <Select options={codexCredentialSourceOptions} />
            </Form.Item>
          ) : null}

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
            <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
              <Select options={taskTypeOptions} />
            </Form.Item>
          ) : null}

          {(isBlankSource || isSnippetSource || isIssueSource) && baseBranchLabel ? (
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

          {(isBlankSource && isImplementationTask) || (isSnippetSource && isImplementationTask) || (isIssueSource && selectedTaskType === "build") ? (
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
      <Modal
        title={pendingSnippetForInsert ? `Insert Snippet: ${pendingSnippetForInsert.name}` : "Insert Snippet"}
        open={snippetVariableModalOpen}
        onCancel={handleCloseSnippetVariableModal}
        destroyOnClose
        onOk={() => void handleConfirmSnippetVariableInsert()}
        okText="Insert"
      >
        <Form form={snippetVariableForm} layout="vertical">
          {(pendingSnippetForInsert?.variables ?? []).map((variable) => (
            <Form.Item
              key={variable.name}
              name={variable.name}
              label={variable.title.trim() || variable.name}
              tooltip={variable.description.trim() || undefined}
              rules={[{ required: true, message: `Enter ${variable.title.trim() || variable.name}` }]}
            >
              {variable.type === "multiline" ? (
                <Input.TextArea rows={4} placeholder={variable.description.trim() || variable.name} />
              ) : (
                <Input placeholder={variable.description.trim() || variable.name} />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  );
}
