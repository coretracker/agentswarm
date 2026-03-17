"use client";

import { useEffect, useState } from "react";
import type { FormInstance } from "antd";
import type {
  AgentProvider,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  ProviderProfile,
  Repository,
  SystemSettings,
  TaskBranchStrategy,
  TaskDefinitionInput,
  TaskSourceType,
  TaskType
} from "@agentswarm/shared-types";
import { getDefaultModelForProvider, getEffortOptionsForProvider } from "@agentswarm/shared-types";
import { Alert, Card, Checkbox, Col, Flex, Form, Input, Row, Select, Space, Typography } from "antd";
import { api } from "../src/api/client";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";
import { useAuth } from "./auth-provider";

export type TaskDefinitionFormValues = {
  sourceType?: TaskSourceType;
  title?: string;
  repoId?: string;
  requirements?: string;
  taskType?: TaskType;
  provider?: AgentProvider;
  model?: string;
  providerProfile?: ProviderProfile;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  issueNumber?: number;
  includeComments?: boolean;
  pullRequestNumber?: number;
  saveAsPreset?: boolean;
};

export interface TaskDefinitionFieldsProps {
  form: FormInstance<TaskDefinitionFormValues>;
  showSaveAsPreset?: boolean;
  syncSettingsDefaults?: boolean;
}

const providerOptions = (
  hasOpenAi: boolean,
  hasAnthropic: boolean
): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex (OpenAI)", value: "codex", disabled: !hasOpenAi },
  { label: "Claude Code (Anthropic)", value: "claude", disabled: !hasAnthropic }
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
    taskType: "plan",
    provider,
    model: getProviderDefaultModel(provider, settings),
    providerProfile: getProviderDefaultProfile(provider, settings),
    branchStrategy: "feature_branch",
    includeComments: true
  };
};

export const stripSaveAsPreset = (values: TaskDefinitionFormValues): TaskDefinitionInput => {
  if (values.sourceType === "blank") {
    return {
      sourceType: "blank",
      title: values.title?.trim() ?? "",
      repoId: values.repoId ?? "",
      requirements: values.requirements?.trim() ?? "",
      taskType: values.taskType ?? "plan",
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
      repoId: values.repoId ?? "",
      issueNumber: values.issueNumber ?? 0,
      includeComments: values.includeComments ?? true,
      taskType: values.taskType === "build" || values.taskType === "ask" ? values.taskType : "plan",
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
    repoId: values.repoId ?? "",
    pullRequestNumber: values.pullRequestNumber ?? 0,
    provider: values.provider ?? "codex",
    model: values.model?.trim() ?? "",
    providerProfile: values.providerProfile ?? "high"
  };
};

export function TaskDefinitionFields({
  form,
  showSaveAsPreset = false,
  syncSettingsDefaults = true
}: TaskDefinitionFieldsProps) {
  const { can } = useAuth();
  const { repositories } = useRepositories();
  const { settings } = useSettings();
  const [githubIssues, setGitHubIssues] = useState<GitHubIssueReference[]>([]);
  const [githubPullRequests, setGitHubPullRequests] = useState<GitHubPullRequestReference[]>([]);
  const [githubBranches, setGitHubBranches] = useState<GitHubBranchReference[]>([]);
  const [githubOptionsLoading, setGitHubOptionsLoading] = useState(false);
  const canReadRepositoryMetadata = can("repo:read");

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "plan";
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
  const effectiveTaskType = isPullRequestSource ? "plan" : selectedTaskType;
  const isImplementationTask = effectiveTaskType === "plan" || effectiveTaskType === "build";
  const baseBranchLabel = isBlankSource || isIssueSource ? "Base Branch" : undefined;
  const providerMissingCredentials =
    selectedProvider === "codex" ? !settings?.openaiApiKeyConfigured : !settings?.anthropicApiKeyConfigured;
  const sourceOptions: Array<{ label: string; value: TaskSourceType }> = [
    { label: "Blank", value: "blank" },
    ...(canReadRepositoryMetadata
      ? [
          { label: "From Issue", value: "issue" as const },
          { label: "From Pull Request", value: "pull_request" as const }
        ]
      : [])
  ];

  useEffect(() => {
    if (canReadRepositoryMetadata || selectedSourceType === "blank") {
      return;
    }

    form.setFieldValue("sourceType", "blank");
  }, [canReadRepositoryMetadata, form, selectedSourceType]);

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

  const requirementsTitle = isBlankSource ? (effectiveTaskType === "ask" ? "Question" : "Requirements") : "Imported Context";

  const renderRequirementsPanel = (repository: Repository | null) => {
    if (isBlankSource) {
      return (
        <>
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: "Enter a task title" }]}
            style={{ marginBottom: 16 }}
          >
            <Input placeholder="Refresh README and docs structure" size="large" />
          </Form.Item>
          <Form.Item
            name="requirements"
            label={requirementsTitle}
            rules={[{ required: true, message: effectiveTaskType === "ask" ? "Enter a question" : "Enter requirements" }]}
            style={{ marginBottom: 0, flex: 1, display: "flex", flexDirection: "column" }}
          >
            <Input.TextArea
              rows={20}
              style={{ flex: 1, resize: "none" }}
              placeholder={
                effectiveTaskType === "ask"
                  ? "Ask a repository question."
                  : "Describe the requirements, constraints, and expected outcome."
              }
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
            description="The issue title, body, and optional comments become the task requirements. Use the left-side configuration to select the issue and task behavior."
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
        </Flex>
      );
    }

    return (
      <Flex vertical gap={16}>
        <Alert
          type="info"
          showIcon
          message="Pull request review threads are imported from GitHub"
          description="AgentSwarm will create a plan task from unresolved pull request review threads and continue work on the pull request branch."
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
                  form.setFieldValue("taskType", "plan");
                  form.setFieldValue("branchStrategy", "work_on_branch");
                }

                if (value === "issue" && form.getFieldValue("taskType") === "review") {
                  form.setFieldValue("taskType", "plan");
                }

                if (value !== "blank") {
                  form.setFieldValue("requirements", undefined);
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
              }}
            />
          </Form.Item>

          {isBlankSource ? (
            <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: "Plan", value: "plan" },
                  { label: "Build", value: "build" },
                  { label: "Review", value: "review" },
                  { label: "Ask", value: "ask" }
                ]}
              />
            </Form.Item>
          ) : null}

          <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
            <Select
              options={providerOptions(Boolean(settings?.openaiApiKeyConfigured), Boolean(settings?.anthropicApiKeyConfigured))}
              onChange={(value: AgentProvider) => {
                form.setFieldValue("model", getProviderDefaultModel(value, settings));
                form.setFieldValue("providerProfile", getProviderDefaultProfile(value, settings));
              }}
            />
          </Form.Item>

          <Form.Item name="model" label="Model" rules={[{ required: true }]}>
            <Select options={providerModels} loading={providerModelsLoading} showSearch optionFilterProp="label" />
          </Form.Item>

          <Form.Item name="providerProfile" label="Effort" rules={[{ required: true }]}>
            <Select options={getEffortOptionsForProvider(selectedProvider)} />
          </Form.Item>

          {providerMissingCredentials ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${selectedProvider === "codex" ? "OpenAI" : "Anthropic"} credentials are missing`}
              description="Configure the provider credential in Settings before running this task."
            />
          ) : null}

          {isIssueSource ? (
            <>
              <Form.Item name="issueNumber" label="Issue" rules={[{ required: true }]}>
                <Select
                  showSearch
                  loading={githubOptionsLoading}
                  placeholder="Select open issue"
                  optionFilterProp="label"
                  options={githubIssues.map((issue) => ({
                    label: `#${issue.number} ${issue.title}`,
                    value: issue.number
                  }))}
                />
              </Form.Item>
              <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: "Plan", value: "plan" },
                    { label: "Build", value: "build" },
                    { label: "Ask", value: "ask" }
                  ]}
                />
              </Form.Item>
              <Form.Item name="includeComments" valuePropName="checked">
                <Checkbox>Include issue comments</Checkbox>
              </Form.Item>
            </>
          ) : null}

          {isPullRequestSource ? (
            <Form.Item name="pullRequestNumber" label="Pull Request" rules={[{ required: true }]}>
              <Select
                showSearch
                loading={githubOptionsLoading}
                placeholder="Select open pull request"
                optionFilterProp="label"
                options={githubPullRequests.map((pullRequest) => ({
                  label: `#${pullRequest.number} ${pullRequest.title}`,
                  value: pullRequest.number
                }))}
              />
            </Form.Item>
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

          {(isBlankSource && isImplementationTask) || (isIssueSource && (selectedTaskType === "plan" || selectedTaskType === "build")) ? (
            <Form.Item name="branchStrategy" label="Branch Strategy" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: "Create feature branch", value: "feature_branch" },
                  { label: "Work on existing branch", value: "work_on_branch" }
                ]}
              />
            </Form.Item>
          ) : null}

          {showSaveAsPreset ? (
            <Form.Item name="saveAsPreset" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Save as preset</Checkbox>
            </Form.Item>
          ) : null}
        </Card>
      </Col>

      <Col xs={24} xl={16}>
        <Card
          bordered={false}
          title={requirementsTitle}
          styles={{
            body: {
              display: "flex",
              flexDirection: "column",
              minHeight: 640
            }
          }}
        >
          {renderRequirementsPanel(selectedRepository)}
        </Card>
      </Col>
    </Row>
  );
}
