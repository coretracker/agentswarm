"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  getAgentProviderLabel,
  getProviderProfileLabel,
  getTaskBranchStrategyLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  type Task,
  type AgentProvider,
  type TaskBranchStrategy,
  type ProviderProfile
} from "@agentswarm/shared-types";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tabs,
  Typography,
  message
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Diff, Hunk } from "react-diff-view";
import remarkGfm from "remark-gfm";
import { api } from "../src/api/client";
import { useTask } from "../src/hooks/useTask";
import { normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";

const statusColor: Record<Task["status"], string> = {
  plan_queued: "gold",
  planning: "processing",
  planned: "purple",
  build_queued: "cyan",
  building: "blue",
  review_queued: "geekblue",
  reviewing: "geekblue",
  ask_queued: "magenta",
  asking: "magenta",
  review: "orange",
  answered: "lime",
  accepted: "green",
  cancelled: "default",
  failed: "red"
};

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" }
];

const providerProfileOptions: Array<{ label: string; value: ProviderProfile }> = [
  { label: "Quick", value: "quick" },
  { label: "Balanced", value: "balanced" },
  { label: "Deep", value: "deep" },
  { label: "Super Deep", value: "super_deep" },
  { label: "Unlimited", value: "unlimited" }
];

function renderParsedDiff(diffText: string, emptyMessage: string): ReactNode {
  if (!diffText.trim()) {
    return (
      <Card size="small">
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "\"SFMono-Regular\", Consolas, monospace" }}
        >
          {emptyMessage}
        </Typography.Paragraph>
      </Card>
    );
  }

  try {
    const files = parseRenderableDiff(diffText);

    if (files.length === 0) {
      throw new Error("No diff files parsed");
    }

    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {files.map((file) => (
          <Card
            key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
            size="small"
            title={file.newPath || file.oldPath || "Changed file"}
          >
            <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </Card>
        ))}
      </Space>
    );
  } catch {
    return (
      <Card size="small">
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "\"SFMono-Regular\", Consolas, monospace" }}
        >
          {normalizeDiffForRendering(diffText) || diffText}
        </Typography.Paragraph>
      </Card>
    );
  }
}

function getGitHubRepositoryBaseUrl(repoUrl: string): string | null {
  const httpsMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}

function getGitHubDiffTarget(task: Task): { href: string; label: string } | null {
  const repoBaseUrl = getGitHubRepositoryBaseUrl(task.repoUrl);
  if (!repoBaseUrl) {
    return null;
  }

  if (task.taskType === "review") {
    if (task.baseBranch === task.repoDefaultBranch) {
      return {
        href: `${repoBaseUrl}/tree/${encodeURIComponent(task.baseBranch)}`,
        label: "Open Branch In GitHub"
      };
    }

    return {
      href: `${repoBaseUrl}/compare/${encodeURIComponent(task.repoDefaultBranch)}...${encodeURIComponent(task.baseBranch)}`,
      label: "Open Compare In GitHub"
    };
  }

  if (task.taskType === "plan") {
    const targetBranch = task.branchName ?? task.baseBranch;
    if (!targetBranch) {
      return null;
    }

    if (targetBranch === task.repoDefaultBranch) {
      return {
        href: `${repoBaseUrl}/tree/${encodeURIComponent(targetBranch)}`,
        label: "Open Branch In GitHub"
      };
    }

    return {
      href: `${repoBaseUrl}/compare/${encodeURIComponent(task.repoDefaultBranch)}...${encodeURIComponent(targetBranch)}`,
      label: "Open Compare In GitHub"
    };
  }

  return null;
}

type FollowUpMode = "continue" | "fix" | null;

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { task, setTask, loading } = useTask(taskId);
  const [followUpForm] = Form.useForm();
  const [iterateInput, setIterateInput] = useState("");
  const [providerInput, setProviderInput] = useState<AgentProvider>("codex");
  const [providerProfileInput, setProviderProfileInput] = useState<ProviderProfile>("deep");
  const [modelOverrideInput, setModelOverrideInput] = useState("");
  const [branchStrategyInput, setBranchStrategyInput] = useState<TaskBranchStrategy>("feature_branch");
  const [followUpMode, setFollowUpMode] = useState<FollowUpMode>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"context" | "logs" | "plan" | "diff">("logs");
  const [submitting, setSubmitting] = useState<
    null | "plan" | "build" | "iterate" | "review" | "ask" | "cancel" | "config" | "accept" | "delete" | "continue" | "fix"
  >(null);
  const [messageApi, contextHolder] = message.useMessage();
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const [logsAutoFollow, setLogsAutoFollow] = useState(true);
  const autoTabSignatureRef = useRef<string | null>(null);

  const taskType = task?.taskType ?? "plan";
  const isPlanTask = taskType === "plan";
  const isReviewTask = taskType === "review";
  const isAskTask = taskType === "ask";
  const isQueued =
    task?.status === "plan_queued" ||
    task?.status === "build_queued" ||
    task?.status === "review_queued" ||
    task?.status === "ask_queued";
  const isActive =
    task?.status === "planning" ||
    task?.status === "building" ||
    task?.status === "reviewing" ||
    task?.status === "asking";
  const canCancel = isQueued || isActive;
  const canAccept = task?.status === "review" || task?.status === "answered";
  const canDelete = !!task && !isActive;
  const canContinueOnBranch = isPlanTask && !!task?.branchName && (task.status === "review" || task.status === "accepted");
  const canCreateFixTask = isReviewTask && !!task?.resultMarkdown && (task.status === "review" || task.status === "accepted");
  const currentTaskProvider = task?.provider ?? "codex";
  const currentTaskProviderProfile = task?.providerProfile ?? "deep";
  const currentTaskModelOverride = task?.modelOverride ?? "";
  const currentTaskBranchStrategy = task?.branchStrategy ?? "feature_branch";
  const hasExecutionContext = (task?.executionSummary?.trim().length ?? 0) > 0;
  const isDirectBuildTask = task?.planningMode === "direct-build";
  const configDirty =
    providerInput !== currentTaskProvider ||
    providerProfileInput !== currentTaskProviderProfile ||
    modelOverrideInput.trim() !== currentTaskModelOverride ||
    (isPlanTask && branchStrategyInput !== currentTaskBranchStrategy);

  const resultStatusText = isPlanTask
    ? task?.lastAction === "iterate"
      ? task.status === "plan_queued"
        ? "Plan revision queued"
        : "Revising plan"
      : task?.status === "plan_queued"
        ? "Plan queued"
        : "Planning in progress"
    : isReviewTask
      ? task?.status === "review_queued"
        ? "Review queued"
        : "Review in progress"
      : task?.status === "ask_queued"
        ? "Question queued"
        : "Answer in progress";

  const codeTextStyle: CSSProperties = {
    marginBottom: 0,
    whiteSpace: "pre-wrap",
    fontFamily: "\"SFMono-Regular\", Consolas, monospace"
  };
  const hasOutputTab = isPlanTask
    ? (task?.planMarkdown?.trim().length ?? 0) > 0
    : (task?.resultMarkdown?.trim().length ?? 0) > 0;
  const hasDiffTab = (task?.branchDiff?.trim().length ?? 0) > 0;

  useEffect(() => {
    const element = logsContainerRef.current;

    if (!element || !logsAutoFollow) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [logsAutoFollow, task?.logs]);

  useEffect(() => {
    if (!task) {
      return;
    }

    setProviderInput(task.provider ?? "codex");
    setProviderProfileInput(task.providerProfile ?? "deep");
    setModelOverrideInput(task.modelOverride ?? "");
    setBranchStrategyInput(task.branchStrategy ?? "feature_branch");
  }, [task]);

  useEffect(() => {
    if (!task) {
      return;
    }

    const visibleTabKeys = new Set<"context" | "logs" | "plan" | "diff">(["context", "logs"]);
    if (hasOutputTab) {
      visibleTabKeys.add("plan");
    }
    if (hasDiffTab) {
      visibleTabKeys.add("diff");
    }

    const signature = [
      task.status,
      task.lastAction ?? "none",
      task.taskType,
      hasOutputTab ? "output" : "no-output",
      hasDiffTab ? "diff" : "no-diff"
    ].join(":");

    const preferredTab: "context" | "logs" | "plan" | "diff" = isPlanTask
      ? hasDiffTab && task.lastAction === "build"
        ? "diff"
        : hasOutputTab && task.status === "planned"
          ? "plan"
          : "logs"
      : hasOutputTab && !isActive
        ? "plan"
        : "logs";

    if (!visibleTabKeys.has(activeWorkspaceTab)) {
      setActiveWorkspaceTab(visibleTabKeys.has(preferredTab) ? preferredTab : "logs");
      autoTabSignatureRef.current = signature;
      return;
    }

    if (autoTabSignatureRef.current === signature) {
      return;
    }

    autoTabSignatureRef.current = signature;
    if (visibleTabKeys.has(preferredTab)) {
      setActiveWorkspaceTab(preferredTab);
    }
  }, [activeWorkspaceTab, hasDiffTab, hasOutputTab, isActive, isPlanTask, task]);

  const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={3}>{children}</Typography.Title>,
    h2: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={4}>{children}</Typography.Title>,
    h3: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={5}>{children}</Typography.Title>,
    p: ({ children }: { children?: React.ReactNode }) => <Typography.Paragraph>{children}</Typography.Paragraph>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ marginBlock: 0, paddingInlineStart: 20 }}>{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ marginBlock: 0, paddingInlineStart: 20 }}>{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => (
      <li style={{ marginBottom: 8 }}>
        <Typography.Text>{children}</Typography.Text>
      </li>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote style={{ margin: 0, paddingInlineStart: 16, borderInlineStart: "3px solid #d9d9d9" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {children}
        </Typography.Paragraph>
      </blockquote>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => <thead style={{ background: "rgba(0,0,0,0.03)" }}>{children}</thead>,
    tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
    tr: ({ children }: { children?: React.ReactNode }) => <tr style={{ borderBottom: "1px solid #f0f0f0" }}>{children}</tr>,
    th: ({ children }: { children?: React.ReactNode }) => (
      <th
        style={{
          padding: "10px 12px",
          textAlign: "left",
          fontWeight: 600,
          verticalAlign: "top",
          whiteSpace: "nowrap"
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td style={{ padding: "10px 12px", verticalAlign: "top", whiteSpace: "pre-wrap" }}>{children}</td>
    ),
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
      <Typography.Link href={href} target="_blank">
        {children}
      </Typography.Link>
    ),
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      const language = className?.replace("language-", "").trim().toLowerCase();
      const codeValue = (Array.isArray(children) ? children.join("") : String(children ?? "")).replace(/\n$/, "");

      if (language === "diff" || codeValue.startsWith("diff --git")) {
        return renderParsedDiff(codeValue, "No diff preview available.");
      }

      if (className) {
        return (
          <pre style={{ margin: 0, padding: 12, overflow: "auto", background: "rgba(0,0,0,0.02)", borderRadius: 8 }}>
            <code className={className}>{children}</code>
          </pre>
        );
      }

      return <Typography.Text code>{children}</Typography.Text>;
    }
  };

  if (!loading && !task) {
    return (
      <Alert
        type="error"
        message="Task not found"
        description="The task may have been deleted or the page was opened before task state loaded."
      />
    );
  }

  const outputTitle = isPlanTask ? "Plan" : isReviewTask ? "Review" : "Answer";
  const baseBranchLabel = isReviewTask ? "Branch To Review" : isAskTask ? "Context Branch" : "Base Branch";
  const requirementsLabel = isAskTask ? "Question" : "Requirements";
  const followUpBranch = task ? (isReviewTask ? task.baseBranch : task.branchName ?? task.baseBranch) : "";
  const followUpTitle = followUpMode === "fix" ? "Create Fix Task" : "New Task On Existing Branch";
  const providerLabel = task ? getAgentProviderLabel(task.provider) : "Agent";
  const runtimeBranchLabel = task ? (isPlanTask ? task.branchName ?? task.baseBranch : task.baseBranch) : "";
  const githubDiffTarget = task ? getGitHubDiffTarget(task) : null;
  const subtitle = ["Task Context", "Logs", ...(hasOutputTab ? [outputTitle] : []), ...(hasDiffTab ? ["Diff"] : [])].join(" | ");
  const openFollowUp = (mode: FollowUpMode) => {
    followUpForm.setFieldsValue({ title: "", requirements: "", skipPlan: false });
    setFollowUpMode(mode);
  };
  const handleDeleteTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("delete");
    try {
      await api.deleteTask(task.id);
      messageApi.success("Task deleted");
      router.push("/tasks");
    } finally {
      setSubmitting(null);
    }
  };
  const moreActionItems = task
    ? [
        canContinueOnBranch ? { key: "continue", label: "Continue On Branch" } : null,
        canCreateFixTask ? { key: "fix", label: "Create Fix Task" } : null,
        canDelete ? { key: "delete", label: "Delete Task", danger: true } : null
      ].filter(Boolean)
    : [];
  const hasMoreActions = moreActionItems.length > 0;
  const workspaceItems = [
    {
      key: "context",
      label: "Task Context",
      children: (
        <div style={{ height: "100%", overflow: "auto", paddingRight: 4 }}>
          <Descriptions column={2} size="small">
            <Descriptions.Item label="Repository">{task?.repoName}</Descriptions.Item>
            <Descriptions.Item label="Task Type">{task ? getTaskTypeLabel(task.taskType) : ""}</Descriptions.Item>
            <Descriptions.Item label="Queue Mode">{task?.queueMode}</Descriptions.Item>
            <Descriptions.Item label={baseBranchLabel}>{task?.baseBranch}</Descriptions.Item>
            <Descriptions.Item label="Repository Default Branch">{task?.repoDefaultBranch}</Descriptions.Item>
            {isPlanTask ? <Descriptions.Item label="Branch Strategy">{task ? getTaskBranchStrategyLabel(task.branchStrategy) : ""}</Descriptions.Item> : null}
            {isPlanTask ? <Descriptions.Item label="Target Branch">{task?.branchName ?? "(pending)"}</Descriptions.Item> : null}
            {isReviewTask ? (
              <Descriptions.Item label="Review Verdict">
                {task?.reviewVerdict ? (
                  <Tag color={task.reviewVerdict === "approved" ? "green" : "orange"}>
                    {task.reviewVerdict === "approved" ? "approved" : "changes_requested"}
                  </Tag>
                ) : (
                  "(pending)"
                )}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label="Provider">{getAgentProviderLabel(currentTaskProvider)}</Descriptions.Item>
            <Descriptions.Item label="Profile">{getProviderProfileLabel(currentTaskProviderProfile)}</Descriptions.Item>
            <Descriptions.Item label="Model Override">{currentTaskModelOverride || "(provider default)"}</Descriptions.Item>
            {isPlanTask ? <Descriptions.Item label="Complexity">{task?.complexity}</Descriptions.Item> : null}
            {isPlanTask ? (
              <Descriptions.Item label="Planning Mode">
                {task?.planningMode === "direct-build" ? "Skip Plan" : "Plan First"}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label="Created">{task ? dayjs(task.createdAt).format("YYYY-MM-DD HH:mm") : ""}</Descriptions.Item>
            <Descriptions.Item label="Status">{task ? getTaskStatusLabel(task.status) : ""}</Descriptions.Item>
            <Descriptions.Item label="Last Action">{task?.lastAction ?? "draft"}</Descriptions.Item>
            {isPlanTask ? <Descriptions.Item label="Plan File">{task?.planPath ?? "(pending)"}</Descriptions.Item> : null}
          </Descriptions>

          <Divider orientation="left">{requirementsLabel}</Divider>
          <Typography.Paragraph style={codeTextStyle}>{task?.requirements}</Typography.Paragraph>

          <Divider orientation="left">Execution Config</Divider>
          <Flex wrap gap={12} align="flex-end">
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
              <Typography.Text type="secondary">Provider</Typography.Text>
              <Select value={providerInput} options={providerOptions} onChange={(value) => setProviderInput(value)} style={{ width: "100%", marginTop: 6 }} />
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
              <Typography.Text type="secondary">Profile</Typography.Text>
              <Select
                value={providerProfileInput}
                options={providerProfileOptions}
                onChange={(value) => setProviderProfileInput(value)}
                style={{ width: "100%", marginTop: 6 }}
              />
            </div>
            <div style={{ flex: "1 1 220px", minWidth: 220 }}>
              <Typography.Text type="secondary">Model Override</Typography.Text>
              <Input
                value={modelOverrideInput}
                onChange={(event) => setModelOverrideInput(event.target.value)}
                placeholder={providerInput === "claude" ? "sonnet or opus" : "gpt-5.4"}
                style={{ width: "100%", marginTop: 6 }}
              />
            </div>
            {isPlanTask ? (
              <div style={{ flex: "1 1 220px", minWidth: 220 }}>
                <Typography.Text type="secondary">Branch Strategy</Typography.Text>
                <Select
                  value={branchStrategyInput}
                  options={[
                    { label: "Create feature branch", value: "feature_branch" },
                    { label: "Work on existing branch", value: "work_on_branch" }
                  ]}
                  onChange={(value) => setBranchStrategyInput(value)}
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
            ) : null}
            <Space wrap size={12}>
              <Button
                onClick={async () => {
                  if (!task) {
                    return;
                  }

                  setSubmitting("config");
                  try {
                    const updatedTask = await api.updateTaskConfig(task.id, {
                      provider: providerInput,
                      providerProfile: providerProfileInput,
                      modelOverride: modelOverrideInput.trim() || null,
                      branchStrategy: isPlanTask ? branchStrategyInput : undefined
                    });
                    setTask((current) =>
                      current
                        ? {
                            ...current,
                            ...updatedTask,
                            logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
                          }
                        : updatedTask
                    );
                    messageApi.success(isActive ? "Execution config updated. It will apply to the next run." : "Execution config updated");
                  } finally {
                    setSubmitting(null);
                  }
                }}
                disabled={!configDirty}
                loading={submitting === "config"}
              >
                Save Config
              </Button>
              {isActive ? <Typography.Text type="secondary">Applies on the next run.</Typography.Text> : null}
            </Space>
          </Flex>
        </div>
      )
    },
    {
      key: "logs",
      label: "Logs",
      children: (
        <div
          ref={logsContainerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            setLogsAutoFollow(nearBottom);
          }}
          style={{
            height: "100%",
            overflow: "auto",
            padding: "16px 18px",
            background: "#0b0f14",
            borderRadius: 8
          }}
        >
          <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
            <Typography.Text style={{ color: "rgba(255,255,255,0.75)" }}>
              {providerLabel} · {task?.lastAction ?? "draft"} · {runtimeBranchLabel}
            </Typography.Text>
            <Typography.Text style={{ color: "rgba(255,255,255,0.55)" }}>
              {logsAutoFollow ? "Following" : "Paused"}
            </Typography.Text>
          </Flex>
          <pre
            style={{
              margin: 0,
              color: "#d8e1ee",
              fontFamily: "\"SFMono-Regular\", Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {task?.logs.join("\n") || "No logs yet."}
          </pre>
        </div>
      )
    },
    ...(hasOutputTab
      ? [
          {
            key: "plan",
            label: outputTitle,
            children: (
              <Flex vertical gap={16} style={{ height: "100%", minHeight: 0 }}>
                {isActive ? (
                  <Alert
                    type="info"
                    showIcon
                    message={resultStatusText}
                    description={
                      isPlanTask
                        ? `${providerLabel} is currently updating the markdown plan only. Watch the logs tab; this section will refresh when the new plan is stored.`
                        : isReviewTask
                          ? `${providerLabel} is reviewing the selected branch against the repository default branch and your requirements.`
                          : `${providerLabel} is answering the repository question using the selected branch as context.`
                    }
                  />
                ) : null}

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingRight: 4 }}>
                  {isPlanTask ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {task?.planMarkdown ?? ""}
                    </ReactMarkdown>
                  ) : task?.resultMarkdown ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {task.resultMarkdown}
                    </ReactMarkdown>
                  ) : null}
                </div>

                {isPlanTask ? (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Input.TextArea
                      rows={4}
                      placeholder="Iterate the plan with another instruction"
                      value={iterateInput}
                      onChange={(event) => setIterateInput(event.target.value)}
                    />
                    <Space wrap>
                      <Button
                        onClick={async () => {
                          if (!task) {
                            return;
                          }

                          setSubmitting("iterate");
                          try {
                            await api.triggerTaskAction(task.id, "iterate", iterateInput.trim());
                            setIterateInput("");
                            messageApi.success("Plan iteration started");
                          } finally {
                            setSubmitting(null);
                          }
                        }}
                        disabled={!hasExecutionContext || iterateInput.trim().length === 0 || task?.status === "accepted"}
                        loading={submitting === "iterate"}
                      >
                        Iterate Plan
                      </Button>
                      <Typography.Text type="secondary">
                        Latest plan iteration: {task?.latestIterationInput ?? "none"}
                      </Typography.Text>
                    </Space>
                  </Space>
                ) : null}
              </Flex>
            )
          }
        ]
      : []),
    ...(hasDiffTab
      ? [
          {
            key: "diff",
            label: "Diff",
            children: (
              <div style={{ height: "100%", overflow: "auto", paddingRight: 4 }}>
                {githubDiffTarget ? (
                  <Flex justify="flex-end" style={{ marginBottom: 12 }}>
                    <Button href={githubDiffTarget.href} target="_blank" rel="noreferrer">
                      {githubDiffTarget.label}
                    </Button>
                  </Flex>
                ) : null}
                {isReviewTask
                  ? renderParsedDiff(task?.branchDiff ?? "", `No diff captured for ${task?.baseBranch} against ${task?.repoDefaultBranch}.`)
                  : renderParsedDiff(task?.branchDiff ?? "", "No diff captured yet. Run Build to generate one.")}
              </div>
            )
          }
        ]
      : [])
  ];

  return (
    <>
      {contextHolder}
      <Flex
        vertical
        gap={16}
        style={{ width: "100%", minHeight: "calc(100dvh - 112px)", height: "calc(100dvh - 112px)", overflow: "hidden", paddingBottom: 16 }}
      >
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {task?.title ?? "Task Detail"}
            </Typography.Title>
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          </Flex>
          {task ? (
            <Space wrap>
              <Tag color={statusColor[task.status]}>{getTaskStatusLabel(task.status)}</Tag>
              {canCancel ? (
                <Button
                  danger
                  onClick={async () => {
                    setSubmitting("cancel");
                    try {
                      await api.cancelTask(task.id);
                      messageApi.success(isQueued ? "Task cancelled" : "Cancellation requested");
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                  loading={submitting === "cancel"}
                >
                  Cancel
                </Button>
              ) : canAccept ? (
                <Button
                  type="primary"
                  onClick={async () => {
                    setSubmitting("accept");
                    try {
                      await api.acceptTask(task.id);
                      messageApi.success("Task accepted");
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                  loading={submitting === "accept"}
                >
                  Accept
                </Button>
              ) : isPlanTask && task.status !== "accepted" ? (
                <>
                  {hasExecutionContext ? (
                    <Button
                      onClick={async () => {
                        setSubmitting("plan");
                        try {
                          await api.triggerTaskAction(task.id, "plan");
                          messageApi.success("Planning started");
                        } finally {
                          setSubmitting(null);
                        }
                      }}
                      loading={submitting === "plan"}
                    >
                      Re-Plan
                    </Button>
                  ) : null}
                  <Button
                    onClick={async () => {
                      setSubmitting(hasExecutionContext ? "build" : "plan");
                      try {
                        await api.triggerTaskAction(task.id, hasExecutionContext ? "build" : "plan");
                        messageApi.success(hasExecutionContext ? "Build started" : "Planning started");
                      } finally {
                        setSubmitting(null);
                      }
                    }}
                    type="primary"
                    loading={submitting === (hasExecutionContext ? "build" : "plan")}
                  >
                    {hasExecutionContext ? "Build" : "Plan"}
                  </Button>
                </>
              ) : null}

              {!canCancel && !canAccept && isReviewTask && task.status !== "accepted" ? (
                <Button
                  type="primary"
                  onClick={async () => {
                    setSubmitting("review");
                    try {
                      await api.triggerTaskAction(task.id, "review");
                      messageApi.success("Review started");
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                  loading={submitting === "review"}
                >
                  Run Review
                </Button>
              ) : null}

              {!canCancel && !canAccept && isAskTask && task.status !== "accepted" ? (
                <Button
                  type="primary"
                  onClick={async () => {
                    setSubmitting("ask");
                    try {
                      await api.triggerTaskAction(task.id, "ask");
                      messageApi.success("Question submitted");
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                  loading={submitting === "ask"}
                >
                  Ask Again
                </Button>
              ) : null}

              {hasMoreActions ? (
                <Dropdown
                  menu={{
                    items: moreActionItems,
                    onClick: ({ key }) => {
                      if (key === "continue") {
                        openFollowUp("continue");
                        return;
                      }

                      if (key === "fix") {
                        openFollowUp("fix");
                        return;
                      }

                      if (key === "delete") {
                        Modal.confirm({
                          title: "Delete task?",
                          content: "This removes the task and its stored logs.",
                          okText: "Delete",
                          okButtonProps: { danger: true, loading: submitting === "delete" },
                          onOk: handleDeleteTask
                        });
                      }
                    }
                  }}
                  trigger={["click"]}
                >
                  <Button icon={<MoreOutlined />}>More</Button>
                </Dropdown>
              ) : null}
            </Space>
          ) : null}
        </Flex>

        {loading ? (
          <Card loading bordered={false} />
        ) : task ? (
          <Flex vertical gap={16} style={{ flex: 1, minHeight: 0 }}>
            {task.status === "failed" ? (
              <Alert
                type="error"
                showIcon
                message="Task failed"
                description={task.errorMessage?.trim() || "The task failed without a captured error message. Check the realtime logs for the last runtime output."}
              />
            ) : null}

            <Card bordered={false} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} bodyStyle={{ flex: 1, minHeight: 0, overflow: "hidden", paddingTop: 0 }}>
              <Tabs
                activeKey={activeWorkspaceTab}
                onChange={(value) => setActiveWorkspaceTab(value as "context" | "logs" | "plan" | "diff")}
                className="task-detail-main-tabs"
                style={{ height: "100%" }}
                items={workspaceItems}
              />
            </Card>
          </Flex>
        ) : null}
      </Flex>

      <Modal
        open={followUpMode !== null}
        title={followUpTitle}
        onCancel={() => {
          followUpForm.resetFields();
          setFollowUpMode(null);
        }}
        footer={null}
        destroyOnClose
      >
        {task ? (
          <Form
            form={followUpForm}
            layout="vertical"
            initialValues={{ skipPlan: false }}
            onFinish={async (values: { title: string; requirements: string; skipPlan: boolean }) => {
              const followUpAction = followUpMode === "fix" ? "fix" : "continue";
              setSubmitting(followUpAction);
              try {
                const normalizedRequirements = values.requirements.trim();
                const nextTask = await api.createTask({
                  title: values.title.trim(),
                  requirements:
                    followUpMode === "fix"
                      ? [
                          `Implement the changes requested by the review on branch ${task.baseBranch}.`,
                          "",
                          `Original review requirements:`,
                          task.requirements,
                          "",
                          `Review result:`,
                          task.resultMarkdown ?? "(no review markdown captured)",
                          "",
                          `Additional implementation instructions:`,
                          normalizedRequirements || "- None provided."
                        ].join("\n")
                      : normalizedRequirements,
                  taskType: "plan",
                  skipPlan: values.skipPlan,
                  repoId: task.repoId,
                  baseBranch: followUpBranch,
                  branchStrategy: "work_on_branch",
                  provider: task.provider,
                  providerProfile: task.providerProfile,
                  modelOverride: task.modelOverride ?? undefined,
                  queueMode: task.queueMode
                });
                followUpForm.resetFields();
                setFollowUpMode(null);
                messageApi.success(
                  nextTask.lastAction === "build"
                    ? "Follow-up task created and build started on branch"
                    : "Follow-up task created and planning started on branch"
                );
                router.push(`/tasks/${nextTask.id}`);
              } finally {
                setSubmitting(null);
              }
            }}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message={followUpMode === "fix" ? "This creates a new implementation task from the review" : "This creates a new task on the current branch"}
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text>
                      Branch: <Typography.Text code>{followUpBranch}</Typography.Text>
                    </Typography.Text>
                    <Typography.Text>Repository: {task.repoName}</Typography.Text>
                    <Typography.Text>Provider: {getAgentProviderLabel(currentTaskProvider)}</Typography.Text>
                    <Typography.Text>Profile: {getProviderProfileLabel(currentTaskProviderProfile)}</Typography.Text>
                  </Space>
                }
              />
              <Form.Item name="title" label="Title" rules={[{ required: true }]}>
                <Input placeholder={followUpMode === "fix" ? "Apply review findings on this branch" : "Follow-up task on this branch"} />
              </Form.Item>
              <Form.Item
                name="requirements"
                label={followUpMode === "fix" ? "Additional Instructions" : "Requirements"}
                rules={followUpMode === "fix" ? [] : [{ required: true }]}
              >
                <Input.TextArea
                  rows={8}
                  placeholder={
                    followUpMode === "fix"
                      ? "Optional extra instructions for applying the review findings."
                      : "Describe the new problem to solve on this branch."
                  }
                />
              </Form.Item>
              <Form.Item name="skipPlan" valuePropName="checked">
                <Checkbox>Skip plan and start with build</Checkbox>
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting === "continue" || submitting === "fix"}>
                {followUpMode === "fix" ? "Create Fix Task" : "Create Continued Task"}
              </Button>
            </Space>
          </Form>
        ) : null}
      </Modal>
    </>
  );
}
