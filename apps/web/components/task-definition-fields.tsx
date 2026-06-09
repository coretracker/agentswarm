"use client";

import { useEffect, useState } from "react";
import type { FormInstance } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type {
  AgentProvider,
  CodexCredentialSource,
  CreateTaskPromptAttachmentInput,
  GitHubBranchReference,
  ProviderProfile,
  Repository,
  Snippet,
  SystemSettings,
  TaskBranchStrategy,
  TaskDefinitionInput,
  TaskType
} from "@agentswarm/shared-types";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  getModelsForProvider
} from "@agentswarm/shared-types";
import { Alert, Button, Card, Col, DatePicker, Flex, Form, Input, Modal, Row, Select, Typography, message } from "antd";
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
};

export interface TaskDefinitionFieldsProps {
  form: FormInstance<TaskDefinitionFormValues>;
  syncSettingsDefaults?: boolean;
  lockRepository?: boolean;
  allowPromptAttachments?: boolean;
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
  { label: "Global OpenAI key or auth.json", value: "global" }
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
    taskType: "build",
    provider,
    model: getProviderDefaultModel(provider, settings),
    providerProfile: getProviderDefaultProfile(provider, settings),
    codexCredentialSource: "auto",
    branchStrategy: "feature_branch"
  };
};

export const buildTaskDefinitionInput = (
  values: TaskDefinitionFormValues,
  promptAttachments: CreateTaskPromptAttachmentInput[] = []
): TaskDefinitionInput => {
  const provider = values.provider ?? "codex";
  const codexCredentialSource = provider === "codex" ? (values.codexCredentialSource ?? "auto") : undefined;

  return {
    title: values.title?.trim() ?? "",
    deadline: getTaskDefinitionDeadlineIso(values.deadline) ?? null,
    repoId: values.repoId ?? "",
    prompt: values.prompt?.trim() ?? "",
    notes: values.notes?.trim() || undefined,
    ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
    taskType: values.taskType ?? "build",
    provider,
    model: values.model?.trim() ?? "",
    providerProfile: values.providerProfile ?? "high",
    ...(codexCredentialSource ? { codexCredentialSource } : {}),
    baseBranch: values.baseBranch?.trim() ?? "",
    branchStrategy: values.branchStrategy ?? "feature_branch"
  };
};

export function TaskDefinitionFields({
  form,
  syncSettingsDefaults = true,
  lockRepository = false,
  allowPromptAttachments = true,
  promptImageFiles = [],
  onPromptImageFilesChange
}: TaskDefinitionFieldsProps) {
  const { can, session } = useAuth();
  const { repositories } = useRepositories();
  const { settings } = useSettings();
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
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const selectedPrompt = Form.useWatch("prompt", form);
  const { models: providerModels, loading: providerModelsLoading } = useProviderModels(selectedProvider);
  const { snippets, loading: snippetsLoading } = useSnippets(canUseSnippets);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const effectiveTaskType = selectedTaskType;
  const isImplementationTask = effectiveTaskType === "build";
  const hasGlobalCodexCredentials = Boolean(settings?.openaiApiKeyConfigured || settings?.codexAuthJsonConfigured);
  const hasAnyCodexCredentials = Boolean(hasGlobalCodexCredentials || session?.user.codexAuthJsonConfigured);
  const providerMissingCredentials =
    selectedProvider === "codex"
      ? !hasAnyCodexCredentials
      : !settings?.anthropicApiKeyConfigured;
  const roleAllowedProviders = session?.user.allowedProviders ?? [];
  const roleAllowedModels = session?.user.allowedModels ?? [];
  const roleAllowedEfforts = session?.user.allowedEfforts ?? [];
  const providerSelectOptions = providerOptions(
    hasAnyCodexCredentials,
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
  const taskTypeOptions: Array<{ label: string; value: TaskType }> = [
    ...(canBuildTasks ? [{ label: "Build", value: "build" as const }] : []),
    ...(canAskTasks ? [{ label: "Ask", value: "ask" as const }] : [])
  ];

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
    if (!selectedRepoId || !canReadRepositoryMetadata) {
      setGitHubBranches([]);
      return;
    }

    let active = true;
    setGitHubOptionsLoading(true);

    void api.listGitHubBranches(selectedRepoId).catch(() => []).then((branches) => {
      if (!active) {
        return;
      }

      setGitHubBranches(branches);
      setGitHubOptionsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [canReadRepositoryMetadata, selectedRepoId]);

  const promptPanelTitle = effectiveTaskType === "ask" ? "Question" : "Prompt";
  const canAttachPromptImages = allowPromptAttachments;
  const canUsePromptMagic = true;
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

  const renderPromptPanel = () => (
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
          {allowPromptAttachments ? (
            <TaskPromptAttachmentsInput
              files={promptImageFiles}
              onChange={(nextFiles) => onPromptImageFilesChange?.(nextFiles)}
              onError={(errorMessage) => void message.error(errorMessage)}
              disabled={!canAttachPromptImages || !onPromptImageFilesChange}
            />
          ) : null}
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

  return (
    <>
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} xl={8}>
          <Card bordered={false} title="Configuration" styles={{ body: { display: "flex", flexDirection: "column", gap: 0 } }}>
            <Form.Item name="repoId" label="Repository" rules={[{ required: true }]}>
              <Select
                options={repositories.map((repository) => ({ label: repository.name, value: repository.id }))}
                placeholder="Select repository"
                disabled={lockRepository}
                onChange={(repoId) => {
                  const repository = repositories.find((item) => item.id === repoId);
                  form.setFieldValue("baseBranch", repository?.defaultBranch ?? "");
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

            <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
              <Select options={taskTypeOptions} />
            </Form.Item>

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
                  ? "Configure Codex auth.json in your Profile or Settings, or set an OpenAI API key in Settings before running this task."
                  : "Configure the provider credential in Settings before running this task."
                }
              />
            ) : null}

            <Form.Item name="baseBranch" label="Base Branch" rules={[{ required: true }]}>
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

            {isImplementationTask ? (
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
            {renderPromptPanel()}
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
