"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormInstance } from "antd";
import type {
  AgentProvider,
  CreateTaskPromptAttachmentInput,
  ProviderProfile,
  Repository,
  SystemSettings,
  TaskBranchStrategy,
  TaskDefinitionInput,
  TaskType,
  User
} from "@verft/shared-types";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  getModelsForProvider
} from "@verft/shared-types";
import { Alert, Card, Col, Collapse, Flex, Form, Input, Row, Segmented, Select, Space, Typography, message } from "antd";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";
import { api } from "../src/api/client";
import { type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";
import { useAuth } from "./auth-provider";
import { TaskPromptAttachmentsInput } from "./task-prompt-attachments-input";

export type TaskDefinitionFormValues = {
  title?: string;
  repoId?: string;
  prompt?: string;
  taskType?: TaskType;
  provider?: AgentProvider;
  model?: string;
  providerProfile?: ProviderProfile;
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

const providerOptions = (): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex (OpenAI)", value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

const taskCreateCardBodyStyle = { padding: 16 };

const getProviderDefaultModel = (provider: AgentProvider, settings?: SystemSettings | null): string =>
  provider === "claude"
    ? settings?.claudeDefaultModel ?? getDefaultModelForProvider(provider)
    : settings?.codexDefaultModel ?? getDefaultModelForProvider(provider);

const getProviderDefaultProfile = (provider: AgentProvider, settings?: SystemSettings | null): ProviderProfile =>
  provider === "claude" ? settings?.claudeDefaultEffort ?? "high" : settings?.codexDefaultEffort ?? "high";

const getProviderConfiguredModels = (provider: AgentProvider, settings?: SystemSettings | null) => {
  const models = provider === "claude" ? settings?.claudeModels : settings?.codexModels;
  return models && models.length > 0 ? models : getModelsForProvider(provider);
};

const getResolvedProviderForDefaults = (
  repository?: Repository | null,
  settings?: SystemSettings | null,
  user?: Pick<User, "defaultProvider"> | null
): AgentProvider => user?.defaultProvider ?? repository?.defaultProvider ?? settings?.defaultProvider ?? "codex";

const getTaskDefinitionResolvedDefaults = (
  settings?: SystemSettings | null,
  repository?: Repository | null,
  user?: Pick<User, "defaultProvider" | "defaultModel" | "defaultProviderProfile"> | null
): { provider: AgentProvider; model: string; providerProfile: ProviderProfile } => {
  const provider = getResolvedProviderForDefaults(repository, settings, user);
  return {
    provider,
    model: user?.defaultModel ?? repository?.defaultModel ?? getProviderDefaultModel(provider, settings),
    providerProfile: user?.defaultProviderProfile ?? repository?.defaultProviderProfile ?? getProviderDefaultProfile(provider, settings)
  };
};

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

export const getTaskDefinitionInitialValues = (
  settings?: SystemSettings | null,
  repository?: Repository | null,
  user?: Pick<User, "defaultProvider" | "defaultModel" | "defaultProviderProfile"> | null
): Partial<TaskDefinitionFormValues> => {
  const resolvedDefaults = getTaskDefinitionResolvedDefaults(settings, repository, user);
  return {
    taskType: "build",
    provider: resolvedDefaults.provider,
    model: resolvedDefaults.model,
    providerProfile: resolvedDefaults.providerProfile,
    branchStrategy: "feature_branch"
  };
};

export const buildTaskDefinitionInput = (
  values: TaskDefinitionFormValues,
  promptAttachments: CreateTaskPromptAttachmentInput[] = []
): TaskDefinitionInput => {
  const provider = values.provider ?? "codex";

  return {
    title: values.title?.trim() ?? "",
    repoId: values.repoId ?? "",
    prompt: values.prompt?.trim() ?? "",
    ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
    taskType: values.taskType ?? "build",
    provider,
    model: values.model?.trim() ?? "",
    providerProfile: values.providerProfile ?? "high",
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
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const canBuildTasks = can("task:build");
  const canAskTasks = can("task:ask");
  const canRunAutomatedTask = canBuildTasks || canAskTasks;

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedTitle = Form.useWatch("title", form);
  const selectedPrompt = Form.useWatch("prompt", form);
  const selectedBaseBranch = Form.useWatch("baseBranch", form);
  const selectedBranchStrategy = Form.useWatch("branchStrategy", form);
  const selectedModel = Form.useWatch("model", form);
  const selectedProviderProfile = Form.useWatch("providerProfile", form);
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "build";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const { models: providerModels, loading: providerModelsLoading, source: providerModelsSource } = useProviderModels(selectedProvider);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const baseBranchOptions = useMemo(() => {
    const values = new Set<string>();
    if (selectedRepository?.defaultBranch) {
      values.add(selectedRepository.defaultBranch);
    }
    for (const branch of branchOptions) {
      if (branch.trim()) {
        values.add(branch.trim());
      }
    }
    if (selectedBaseBranch?.trim()) {
      values.add(selectedBaseBranch.trim());
    }
    return Array.from(values).map((branch) => ({ label: branch, value: branch }));
  }, [branchOptions, selectedBaseBranch, selectedRepository?.defaultBranch]);
  const effectiveTaskType = selectedTaskType;
  const isImplementationTask = effectiveTaskType === "build";
  const roleAllowedProviders = session?.user.allowedProviders ?? [];
  const roleAllowedModels = session?.user.allowedModels ?? [];
  const roleAllowedEfforts = session?.user.allowedEfforts ?? [];
  const providerSelectOptions = providerOptions().map(
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
    const resolvedDefaults = getTaskDefinitionResolvedDefaults(settings, selectedRepository, session?.user);
    const effectiveProvider =
      form.isFieldTouched("provider") && currentProvider ? currentProvider : resolvedDefaults.provider;
    if (!form.isFieldTouched("provider")) {
      form.setFieldValue("provider", resolvedDefaults.provider);
    }
    if (!form.isFieldTouched("model")) {
      form.setFieldValue("model", selectedRepository?.defaultModel ?? getProviderDefaultModel(effectiveProvider, settings));
    }
    if (!form.isFieldTouched("providerProfile")) {
      form.setFieldValue(
        "providerProfile",
        selectedRepository?.defaultProviderProfile ?? getProviderDefaultProfile(effectiveProvider, settings)
      );
    }
  }, [form, selectedRepository, session?.user, settings, syncSettingsDefaults]);

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
    if (selectedTaskType === "build" && !canBuildTasks && canAskTasks) {
      form.setFieldValue("taskType", "ask");
      return;
    }

    if (selectedTaskType === "ask" && !canAskTasks && canBuildTasks) {
      form.setFieldValue("taskType", "build");
    }
  }, [canAskTasks, canBuildTasks, form, selectedTaskType]);

  useEffect(() => {
    if (!selectedRepository || selectedBaseBranch?.trim()) {
      return;
    }
    form.setFieldValue("baseBranch", selectedRepository.defaultBranch);
  }, [form, selectedBaseBranch, selectedRepository]);

  useEffect(() => {
    if (!selectedRepoId) {
      setBranchOptions([]);
      setBranchesError(null);
      setBranchesLoading(false);
      return;
    }

    let active = true;
    setBranchesLoading(true);
    setBranchesError(null);
    void api
      .listRepositoryBranches(selectedRepoId)
      .then((response) => {
        if (!active) {
          return;
        }
        setBranchOptions(response.branches);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setBranchOptions([]);
        setBranchesError(error instanceof Error ? error.message : "Failed to load branches");
      })
      .finally(() => {
        if (active) {
          setBranchesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRepoId]);

  useEffect(() => {
    if (form.isFieldTouched("title")) {
      return;
    }

    const nextTitle = deriveTitleFromPrompt(String(selectedPrompt ?? "")).slice(0, 96);
    if (nextTitle && nextTitle !== selectedTitle) {
      form.setFieldValue("title", nextTitle);
    }
  }, [form, selectedPrompt, selectedTitle]);

  const promptPanelTitle = effectiveTaskType === "ask" ? "Question" : "Prompt";
  const canAttachPromptImages = allowPromptAttachments;
  const selectedProviderLabel =
    providerSelectOptions.find((option) => option.value === selectedProvider)?.label ?? getAgentProviderLabel(selectedProvider);
  const selectedModelLabel = allowedModelOptions.find((option) => option.value === selectedModel)?.label ?? selectedModel;
  const selectedProfileLabel =
    allowedEffortOptions.find((option) => option.value === selectedProviderProfile)?.label ?? selectedProviderProfile;
  const branchSummary =
    selectedBranchStrategy === "work_on_branch"
      ? `work on ${selectedBaseBranch || selectedRepository?.defaultBranch || "branch"}`
      : `feature branch from ${selectedBaseBranch || selectedRepository?.defaultBranch || "base"}`;
  const defaultSummary = selectedRepository
    ? [selectedRepository.defaultBranch, selectedProviderLabel, selectedModelLabel, selectedProfileLabel]
        .filter(Boolean)
        .join(" · ")
    : null;
  const executionSummary = [selectedProviderLabel, selectedModelLabel, selectedProfileLabel, branchSummary]
    .filter(Boolean)
    .join(" · ");

  const renderPromptPanel = () => (
    <>
      <Form.Item
        name="title"
        label="Title"
        rules={[{ required: true, message: "Enter a task title" }]}
        style={{ marginBottom: 16 }}
      >
        <Input placeholder="Short task title" size="large" />
      </Form.Item>
      <Form.Item
        label={promptPanelTitle}
        style={{ marginBottom: 0, flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Flex vertical gap={12} style={{ flex: 1 }}>
          <Form.Item
            name="prompt"
            style={{ marginBottom: 0 }}
            rules={[{ required: true, message: effectiveTaskType === "ask" ? "Enter a question" : "Enter a prompt" }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 8, maxRows: 22 }}
              showCount
              style={{ resize: "none", fontSize: 15, lineHeight: 1.6 }}
              placeholder={
                effectiveTaskType === "ask"
                  ? "Ask a repository question. Include the files, behavior, or decision you want explained."
                  : "Describe the goal, constraints, relevant files, and what done looks like."
              }
            />
          </Form.Item>
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
    </>
  );

  const promptPanelHeader = (
    <Flex align="center" justify="space-between" gap={12} wrap="wrap">
      <Typography.Text strong>{promptPanelTitle}</Typography.Text>
      <Form.Item name="taskType" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
        <Segmented options={taskTypeOptions} disabled={taskTypeOptions.length <= 1} />
      </Form.Item>
    </Flex>
  );

  return (
    <Row gutter={[20, 20]} align="stretch">
      <Col span={24}>
        <Flex vertical gap={12}>
          <Card bordered={false} styles={{ body: taskCreateCardBodyStyle }}>
            <Flex vertical gap={10}>
              {!canRunAutomatedTask ? (
                <Alert
                  type="warning"
                  showIcon
                  message="This role cannot create build or ask tasks."
                  description="Ask an administrator to grant task mode permissions in Settings."
                />
              ) : null}

              <Row gutter={[12, 8]}>
                <Col xs={24} lg={isImplementationTask ? 9 : 12}>
                  <Form.Item name="repoId" label="Repository" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                    <Select
                      showSearch
                      options={repositories.map((repository) => ({ label: repository.name, value: repository.id }))}
                      placeholder="Select repository"
                      disabled={lockRepository}
                      optionFilterProp="label"
                      onChange={(repoId) => {
                        const repository = repositories.find((item) => item.id === repoId);
                        form.setFieldValue("baseBranch", repository?.defaultBranch ?? "");
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={isImplementationTask ? 8 : 12}>
                  <Form.Item
                    name="baseBranch"
                    label="Base Branch"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 0 }}
                    extra={branchesError ? `Branch lookup failed: ${branchesError}` : undefined}
                  >
                    <Select
                      showSearch
                      options={baseBranchOptions}
                      loading={branchesLoading}
                      placeholder={selectedRepository?.defaultBranch ?? "Select branch"}
                      disabled={!selectedRepository}
                      optionFilterProp="label"
                      filterOption={(input, option) =>
                        String(option?.label ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      notFoundContent={branchesLoading ? "Loading branches..." : "No branches found"}
                    />
                  </Form.Item>
                </Col>
                {isImplementationTask ? (
                  <Col xs={24} lg={7}>
                    <Form.Item name="branchStrategy" label="Branch Strategy" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                      <Select
                        options={[
                          { label: "Create feature branch", value: "feature_branch" },
                          { label: "Work on existing branch", value: "work_on_branch" }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {defaultSummary ? `${selectedRepository?.name}: ${defaultSummary}` : "Select a repository to load its defaults."}
              </Typography.Text>
            </Flex>
          </Card>

          <Card
            bordered={false}
            title={promptPanelHeader}
            styles={{
              header: {
                paddingInline: 16
              },
              body: {
                ...taskCreateCardBodyStyle,
                display: "flex",
                flexDirection: "column",
                minHeight: 420
              }
            }}
          >
            {renderPromptPanel()}
          </Card>

          <Card bordered={false} styles={{ body: taskCreateCardBodyStyle }}>
            <Collapse
              ghost
              defaultActiveKey={[]}
              expandIconPosition="end"
              style={{ margin: -12 }}
              items={[
                {
                  key: "execution",
                  forceRender: true,
                  label: (
                    <Flex vertical gap={2}>
                      <Typography.Text strong>Execution settings</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {executionSummary}
                      </Typography.Text>
                    </Flex>
                  ),
                  children: (
                    <Flex vertical>
                      <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
                        <Select
                          options={providerSelectOptions}
                          onChange={(value: AgentProvider) => {
                            const nextModels = getProviderConfiguredModels(value, settings).filter(
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

                      <Form.Item
                        name="model"
                        label="Model"
                        rules={[{ required: true }]}
                        extra={
                          providerModelsSource === "api"
                            ? "Model suggestions were refreshed from the provider."
                            : roleAllowedModels.length === 0
                              ? "Model choices come from the model list in Settings."
                              : "Model choices are restricted by your role."
                        }
                      >
                        <Select
                          showSearch
                          options={allowedModelOptions}
                          loading={providerModelsLoading}
                          optionFilterProp="label"
                          placeholder="Select model"
                        />
                      </Form.Item>

                      <Form.Item name="providerProfile" label="Effort" rules={[{ required: true }]}>
                        <Select options={allowedEffortOptions} />
                      </Form.Item>
                    </Flex>
                  )
                }
              ]}
            />
          </Card>
        </Flex>
      </Col>
    </Row>
  );
}
