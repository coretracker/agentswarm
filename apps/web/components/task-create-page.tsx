"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AgentProvider,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  ProviderProfile,
  Repository,
  TaskBranchStrategy,
  TaskQueueMode,
  TaskSourceType,
  TaskType
} from "@agentswarm/shared-types";
import {
  getDefaultModelForProvider,
  getEffortOptionsForProvider
} from "@agentswarm/shared-types";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { Alert, Button, Card, Checkbox, Col, Flex, Form, Input, Row, Select, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";
import { useAuth } from "./auth-provider";

type BlankTaskValues = {
  sourceType: "blank";
  title: string;
  repoId: string;
  requirements: string;
  taskType: TaskType;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
  queueMode: TaskQueueMode;
};

type IssueTaskValues = {
  sourceType: "issue";
  title?: string;
  repoId: string;
  issueNumber: number;
  includeComments: boolean;
  taskType: Extract<TaskType, "plan" | "build" | "ask">;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
  queueMode: TaskQueueMode;
};

type PullRequestTaskValues = {
  sourceType: "pull_request";
  title?: string;
  repoId: string;
  pullRequestNumber: number;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  queueMode: TaskQueueMode;
};

type TaskCreateSubmitValues = BlankTaskValues | IssueTaskValues | PullRequestTaskValues;

const providerOptions = (hasOpenAi: boolean, hasAnthropic: boolean): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex (OpenAI)", value: "codex", disabled: !hasOpenAi },
  { label: "Claude Code (Anthropic)", value: "claude", disabled: !hasAnthropic }
];

export function TaskCreatePage() {
  const router = useRouter();
  const { can } = useAuth();
  const { repositories } = useRepositories();
  const { settings } = useSettings();
  const [form] = Form.useForm<TaskCreateSubmitValues>();
  const [submitting, setSubmitting] = useState(false);
  const [githubIssues, setGitHubIssues] = useState<GitHubIssueReference[]>([]);
  const [githubPullRequests, setGitHubPullRequests] = useState<GitHubPullRequestReference[]>([]);
  const [githubBranches, setGitHubBranches] = useState<GitHubBranchReference[]>([]);
  const [githubOptionsLoading, setGitHubOptionsLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canReadRepositoryMetadata = can("repo:read");

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "plan";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const { models: providerModels, loading: providerModelsLoading } = useProviderModels(selectedProvider);
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const selectedIssueNumber = Form.useWatch("issueNumber", form);
  const selectedPullRequestNumber = Form.useWatch("pullRequestNumber", form);
  const isBlankSource = selectedSourceType === "blank";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const effectiveTaskType = isPullRequestSource ? "plan" : selectedTaskType;
  const isPlanTask = effectiveTaskType === "plan";
  const isBuildTask = effectiveTaskType === "build";
  const isImplementationTask = isPlanTask || isBuildTask;
  const baseBranchLabel = isIssueSource ? "Base Branch" : isBlankSource ? "Base Branch" : undefined;
  const queueModeHelp =
    effectiveTaskType === "plan"
      ? "Manual stops after the current stage. Auto continues automatically from plan into build."
      : "Manual waits for a user trigger. Auto lets the scheduler pick up this task as soon as capacity is available.";
  const providerMissingCredentials =
    selectedProvider === "codex" ? !settings?.openaiApiKeyConfigured : !settings?.anthropicApiKeyConfigured;

  const selectedIssue = githubIssues.find((issue) => issue.number === selectedIssueNumber) ?? null;
  const selectedPullRequest = githubPullRequests.find((pullRequest) => pullRequest.number === selectedPullRequestNumber) ?? null;
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
    if (!settings) {
      return;
    }

    if (!form.isFieldTouched("provider") && form.getFieldValue("provider") !== settings.defaultProvider) {
      form.setFieldValue("provider", settings.defaultProvider);
    }

    if (!form.isFieldTouched("model")) {
      const defaultModel = settings.defaultProvider === "claude"
        ? settings.claudeDefaultModel
        : settings.codexDefaultModel;
      form.setFieldValue("model", defaultModel);
    }

    if (!form.isFieldTouched("providerProfile")) {
      const defaultEffort = settings.defaultProvider === "claude"
        ? settings.claudeDefaultEffort
        : settings.codexDefaultEffort;
      form.setFieldValue("providerProfile", defaultEffort);
    }
  }, [form, settings]);

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

  const pageTitle =
    selectedSourceType === "issue"
      ? "New Task From Issue"
      : selectedSourceType === "pull_request"
        ? "New Task From Pull Request"
        : selectedTaskType === "review"
          ? "New Review Task"
          : selectedTaskType === "build"
            ? "New Build Task"
          : selectedTaskType === "ask"
            ? "New Ask Task"
            : "New Plan Task";

  const requirementsTitle = isBlankSource ? (effectiveTaskType === "ask" ? "Question" : "Requirements") : "Imported Context";

  const handleSubmit = async (values: TaskCreateSubmitValues) => {
    setSubmitting(true);
    try {
      const task =
        values.sourceType === "issue"
          ? await api.createTaskFromIssue({
              repoId: values.repoId,
              issueNumber: values.issueNumber,
              includeComments: values.includeComments,
              taskType: values.taskType,
              title: values.title?.trim() || undefined,
              provider: values.provider,
              providerProfile: values.providerProfile,
              modelOverride: values.model || undefined,
              baseBranch: values.baseBranch,
              branchStrategy: values.taskType === "plan" || values.taskType === "build" ? values.branchStrategy : undefined,
              queueMode: values.queueMode
            })
          : values.sourceType === "pull_request"
            ? await api.createTaskFromPullRequest({
                repoId: values.repoId,
                pullRequestNumber: values.pullRequestNumber,
                title: values.title?.trim() || undefined,
                provider: values.provider,
                providerProfile: values.providerProfile,
                modelOverride: values.model || undefined,
                queueMode: values.queueMode
              })
            : await api.createTask({
                title: values.title,
                repoId: values.repoId,
                requirements: values.requirements,
                taskType: values.taskType,
                provider: values.provider,
                providerProfile: values.providerProfile,
                modelOverride: values.model || undefined,
                baseBranch: values.baseBranch,
                branchStrategy: values.branchStrategy,
                queueMode: values.queueMode
              });

      messageApi.success(
        task.taskType === "review"
          ? "Review task created and started"
          : task.taskType === "ask"
            ? "Ask task created and started"
            : task.taskType === "build"
              ? "Build task created and build started"
              : "Plan task created and planning started"
      );
      router.push(`/tasks/${task.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderRequirementsPanel = (selectedRepository: Repository | null) => {
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
            Imported against repository <Typography.Text code>{selectedRepository?.name ?? "unknown"}</Typography.Text>.
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
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          sourceType: "blank",
          taskType: "plan",
          provider: settings?.defaultProvider ?? "codex",
          model: settings
            ? (settings.defaultProvider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel)
            : getDefaultModelForProvider("codex"),
          providerProfile: settings
            ? (settings.defaultProvider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort)
            : "high",
          queueMode: "manual",
          branchStrategy: "feature_branch",
          includeComments: true
        }}
        onFinish={handleSubmit}
      >
        <Flex vertical gap={16}>
          <Flex align="center" justify="space-between" gap={16} wrap="wrap">
            <Flex vertical gap={0}>
              <Typography.Title level={2} style={{ margin: 0 }}>
                {pageTitle}
              </Typography.Title>
              <Typography.Text type="secondary">
                Configure the task on the left and define the work context on the right.
              </Typography.Text>
            </Flex>
            <Space>
              <Button onClick={() => router.push("/tasks")}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting} disabled={repositories.length === 0 || providerMissingCredentials}>
                {isIssueSource ? "Create Task From Issue" : isPullRequestSource ? "Create Task From Pull Request" : "Create Task"}
              </Button>
            </Space>
          </Flex>

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
                      const defaultModel = value === "claude"
                        ? (settings?.claudeDefaultModel ?? getDefaultModelForProvider(value))
                        : (settings?.codexDefaultModel ?? getDefaultModelForProvider(value));
                      const defaultEffort = value === "claude"
                        ? (settings?.claudeDefaultEffort ?? "high")
                        : (settings?.codexDefaultEffort ?? "high");
                      form.setFieldValue("model", defaultModel);
                      form.setFieldValue("providerProfile", defaultEffort);
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

                <Form.Item name="queueMode" label="Queue Mode" rules={[{ required: true }]} extra={queueModeHelp} style={{ marginBottom: 16 }}>
                  <Select
                    options={[
                      { label: "manual", value: "manual" },
                      { label: "auto", value: "auto" }
                    ]}
                  />
                </Form.Item>

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
        </Flex>
      </Form>
    </>
  );
}
