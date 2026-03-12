"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AgentProvider,
  ProviderProfile,
  Repository,
  TaskBranchStrategy,
  TaskQueueMode,
  TaskSourceType,
  TaskType
} from "@agentswarm/shared-types";
import { Alert, Button, Card, Checkbox, Col, Collapse, Flex, Form, Input, InputNumber, Row, Select, Space, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useSettings } from "../src/hooks/useSettings";

type BlankTaskValues = {
  sourceType: "blank";
  title: string;
  repoId: string;
  requirements: string;
  taskType: TaskType;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string;
  baseBranch: string;
  skipPlan: boolean;
  branchStrategy: TaskBranchStrategy;
  queueMode: TaskQueueMode;
};

type IssueTaskValues = {
  sourceType: "issue";
  title?: string;
  repoId: string;
  issueNumber: number;
  includeComments: boolean;
  taskType: Extract<TaskType, "plan" | "ask">;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string;
  baseBranch: string;
  skipPlan: boolean;
  branchStrategy: TaskBranchStrategy;
  queueMode: TaskQueueMode;
};

type PullRequestTaskValues = {
  sourceType: "pull_request";
  title?: string;
  repoId: string;
  pullRequestNumber: number;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string;
  skipPlan: boolean;
  queueMode: TaskQueueMode;
};

type TaskCreateSubmitValues = BlankTaskValues | IssueTaskValues | PullRequestTaskValues;

const providerOptions = (hasOpenAi: boolean, hasAnthropic: boolean): Array<{ label: string; value: AgentProvider; disabled?: boolean }> => [
  { label: "Codex", value: "codex", disabled: !hasOpenAi },
  { label: "Claude Code", value: "claude", disabled: !hasAnthropic }
];

const providerProfileOptions: Array<{ label: string; value: ProviderProfile }> = [
  { label: "Quick", value: "quick" },
  { label: "Balanced", value: "balanced" },
  { label: "Deep", value: "deep" },
  { label: "Super Deep", value: "super_deep" },
  { label: "Unlimited", value: "unlimited" }
];

export function TaskCreatePage() {
  const router = useRouter();
  const { repositories } = useRepositories();
  const { settings } = useSettings();
  const [form] = Form.useForm<TaskCreateSubmitValues>();
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const selectedRepoId = Form.useWatch("repoId", form);
  const selectedSourceType = (Form.useWatch("sourceType", form) as TaskSourceType | undefined) ?? "blank";
  const selectedTaskType = (Form.useWatch("taskType", form) as TaskType | undefined) ?? "plan";
  const selectedProvider = (Form.useWatch("provider", form) as AgentProvider | undefined) ?? settings?.defaultProvider ?? "codex";
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepoId) ?? null;
  const isBlankSource = selectedSourceType === "blank";
  const isIssueSource = selectedSourceType === "issue";
  const isPullRequestSource = selectedSourceType === "pull_request";
  const effectiveTaskType =
    isPullRequestSource || (isIssueSource && selectedTaskType === "review") ? "plan" : selectedTaskType;
  const isPlanTask = effectiveTaskType === "plan";
  const baseBranchLabel = isIssueSource ? "Base Branch" : isBlankSource ? "Base Branch" : undefined;
  const queueModeHelp =
    effectiveTaskType === "plan"
      ? "Manual stops after the current stage. Auto continues automatically from plan into build."
      : "Manual waits for a user trigger. Auto lets the scheduler pick up this task as soon as capacity is available.";
  const providerMissingCredentials =
    selectedProvider === "codex" ? !settings?.openaiApiKeyConfigured : !settings?.anthropicApiKeyConfigured;

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (!form.isFieldTouched("provider") && form.getFieldValue("provider") !== settings.defaultProvider) {
      form.setFieldValue("provider", settings.defaultProvider);
    }
  }, [form, settings]);

  const pageTitle =
    selectedSourceType === "issue"
      ? "New Task From Issue"
      : selectedSourceType === "pull_request"
        ? "New Task From Pull Request"
        : selectedTaskType === "review"
          ? "New Review Task"
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
              modelOverride: values.modelOverride?.trim() || undefined,
              baseBranch: values.baseBranch,
              skipPlan: values.taskType === "plan" ? values.skipPlan : false,
              branchStrategy: values.taskType === "plan" ? values.branchStrategy : undefined,
              queueMode: values.queueMode
            })
          : values.sourceType === "pull_request"
            ? await api.createTaskFromPullRequest({
                repoId: values.repoId,
                pullRequestNumber: values.pullRequestNumber,
                title: values.title?.trim() || undefined,
                provider: values.provider,
                providerProfile: values.providerProfile,
                modelOverride: values.modelOverride?.trim() || undefined,
                skipPlan: values.skipPlan,
                queueMode: values.queueMode
              })
            : await api.createTask({
                title: values.title,
                repoId: values.repoId,
                requirements: values.requirements,
                taskType: values.taskType,
                provider: values.provider,
                providerProfile: values.providerProfile,
                modelOverride: values.modelOverride?.trim() || undefined,
                baseBranch: values.baseBranch,
                skipPlan: values.skipPlan,
                branchStrategy: values.branchStrategy,
                queueMode: values.queueMode
              });

      messageApi.success(
        task.taskType === "review"
          ? "Review task created and started"
          : task.taskType === "ask"
            ? "Ask task created and started"
            : task.lastAction === "build"
              ? "Plan task created and direct build started"
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
          providerProfile: "deep",
          queueMode: "manual",
          branchStrategy: "feature_branch",
          skipPlan: false,
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
                    options={[
                      { label: "Blank", value: "blank" },
                      { label: "From Issue", value: "issue" },
                      { label: "From Pull Request", value: "pull_request" }
                    ]}
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
                        { label: "Review", value: "review" },
                        { label: "Ask", value: "ask" }
                      ]}
                    />
                  </Form.Item>
                ) : null}

                <Form.Item name="provider" label="Provider" rules={[{ required: true }]}> 
                  <Select options={providerOptions(Boolean(settings?.openaiApiKeyConfigured), Boolean(settings?.anthropicApiKeyConfigured))} />
                </Form.Item>

                <Form.Item name="providerProfile" label="Provider Profile" rules={[{ required: true }]}> 
                  <Select options={providerProfileOptions} />
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
                    <Form.Item name="issueNumber" label="Issue Number" rules={[{ required: true }]}> 
                      <InputNumber min={1} style={{ width: "100%" }} placeholder="123" />
                    </Form.Item>
                    <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}> 
                      <Select
                        options={[
                          { label: "Plan", value: "plan" },
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
                  <Form.Item name="pullRequestNumber" label="Pull Request Number" rules={[{ required: true }]}> 
                    <InputNumber min={1} style={{ width: "100%" }} placeholder="456" />
                  </Form.Item>
                ) : null}

                {(isBlankSource || isIssueSource) && baseBranchLabel ? (
                  <Form.Item name="baseBranch" label={baseBranchLabel} rules={[{ required: true }]}> 
                    <Input placeholder={selectedRepository?.defaultBranch ?? "develop"} />
                  </Form.Item>
                ) : null}

                {(isBlankSource && isPlanTask) || (isIssueSource && selectedTaskType === "plan") || isPullRequestSource ? (
                  <Form.Item name="skipPlan" valuePropName="checked">
                    <Checkbox>Skip plan and start with build</Checkbox>
                  </Form.Item>
                ) : null}

                {(isBlankSource && isPlanTask) || (isIssueSource && selectedTaskType === "plan") ? (
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

                <Collapse
                  items={[
                    {
                      key: "advanced",
                      label: "Advanced Provider Overrides",
                      children: (
                        <Form.Item name="modelOverride" label="Model Override" style={{ marginBottom: 0 }}>
                          <Input placeholder={selectedProvider === "claude" ? "sonnet or opus" : "gpt-5.4"} />
                        </Form.Item>
                      )
                    }
                  ]}
                />
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
