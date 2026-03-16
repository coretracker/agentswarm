"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  getProviderProfileLabel,
  getTaskBranchStrategyLabel,
  getTaskStatusLabel,
  getTaskTypeLabel,
  type Task,
  type TaskAction,
  type TaskMessageAction,
  type TaskMessage,
  type TaskLiveDiff,
  type TaskRun,
  type AgentProvider,
  type TaskBranchStrategy,
  type ProviderProfile
} from "@agentswarm/shared-types";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Divider,
  Dropdown,
  Empty,
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
import { MoreOutlined, PushpinOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Diff, Hunk } from "react-diff-view";
import remarkGfm from "remark-gfm";
import { api } from "../src/api/client";
import { useTask } from "../src/hooks/useTask";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useTaskMessages } from "../src/hooks/useTaskMessages";
import { useTaskRuns } from "../src/hooks/useTaskRuns";
import { normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";
import { estimateCost, formatCost } from "../src/utils/pricing";
import { useAuth } from "./auth-provider";

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
  archived: "default",
  cancelled: "default",
  failed: "red"
};

const runStatusColor: Record<TaskRun["status"], string> = {
  running: "processing",
  succeeded: "green",
  failed: "red",
  cancelled: "default"
};

const taskActionLabel: Record<TaskMessageAction | TaskAction, string> = {
  plan: "Plan",
  build: "Build",
  iterate: "Iterate Plan",
  review: "Review",
  ask: "Ask",
  comment: "Comment"
};

type ComposerAction = TaskMessageAction;

function getAllowedComposerActions(): ComposerAction[] {
  return ["plan", "build", "iterate", "review", "ask", "comment"];
}

function getDefaultComposerAction(task: Task | null): ComposerAction {
  if (!task) {
    return "plan";
  }

  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  if (task.taskType === "build") {
    return "build";
  }

  if (task.branchDiff?.trim() || task.status === "review" || task.lastAction === "build") {
    return "build";
  }

  return "plan";
}

function formatRunDuration(startedAt: string, finishedAt: string | null): string {
  const start = dayjs(startedAt);
  const end = finishedAt ? dayjs(finishedAt) : dayjs();
  const totalSeconds = Math.max(0, end.diff(start, "second"));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatTokenUsage(tokenUsage: TaskRun["tokenUsage"]): string {
  if (!tokenUsage || tokenUsage.status !== "available") {
    return tokenUsage?.note ?? "Unavailable";
  }

  const input = tokenUsage.inputTokens?.toLocaleString() ?? "?";
  const output = tokenUsage.outputTokens?.toLocaleString() ?? "?";
  const total = tokenUsage.totalTokens?.toLocaleString() ?? "?";
  return `${total} total (${input} in / ${output} out)`;
}

function getRunModel(run: TaskRun): string {
  return run.modelOverride ?? getDefaultModelForProvider(run.provider);
}

function getTaskTokenTotals(runs: TaskRun[]) {
  const availableRuns = runs.filter((run) => run.tokenUsage?.status === "available");
  if (availableRuns.length === 0) {
    return null;
  }

  const inputTokens = availableRuns.reduce((sum, run) => sum + (run.tokenUsage?.inputTokens ?? 0), 0);
  const outputTokens = availableRuns.reduce((sum, run) => sum + (run.tokenUsage?.outputTokens ?? 0), 0);

  // Sum costs per run using each run's own model for accuracy
  let totalCost: number | null = 0;
  for (const run of availableRuns) {
    if (!run.tokenUsage?.inputTokens || !run.tokenUsage.outputTokens) continue;
    const runCost = estimateCost(getRunModel(run), run.tokenUsage.inputTokens, run.tokenUsage.outputTokens);
    if (runCost === null) {
      totalCost = null;
      break;
    }
    totalCost += runCost.totalCost;
  }

  return {
    runCount: availableRuns.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: totalCost !== null ? { totalCost, currency: "USD" as const, isEstimate: true as const } : null
  };
}

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: "Codex (OpenAI)", value: "codex" },
  { label: "Claude Code (Anthropic)", value: "claude" }
];

function renderParsedDiff(diffText: string, emptyMessage: string, options?: { collapseFiles?: boolean }): ReactNode {
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

    if (options?.collapseFiles) {
      return (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {files.map((file) => (
            <Collapse
              key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
              size="small"
              defaultActiveKey={[]}
              items={[
                {
                  key: "file",
                  label: file.newPath || file.oldPath || "Changed file",
                  children: (
                    <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                    </Diff>
                  )
                }
              ]}
            />
          ))}
        </Space>
      );
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

  if (task.taskType === "plan" || task.taskType === "build") {
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

function ExpandableMessageContent({ children, fadeColor }: { children: ReactNode; fadeColor: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      setHasOverflow(element.scrollHeight > 320);
    };

    const frame = window.requestAnimationFrame(measure);
    if (typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [children]);

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <div style={{ position: "relative", maxHeight: expanded ? "none" : 320, overflow: "hidden" }}>
        <div ref={containerRef}>{children}</div>
        {!expanded && hasOverflow ? (
          <div
            style={{
              position: "absolute",
              inset: "auto 0 0 0",
              height: 64,
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${fadeColor})`,
              pointerEvents: "none"
            }}
          />
        ) : null}
      </div>
      {hasOverflow ? (
        <Button type="link" size="small" style={{ padding: 0, alignSelf: "flex-start" }} onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show Less" : "Show More"}
        </Button>
      ) : null}
    </Space>
  );
}

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { can, canAll } = useAuth();
  const { task, setTask, loading } = useTask(taskId);
  const { messages: taskMessages, loading: messagesLoading } = useTaskMessages(taskId);
  const { runs: taskRuns, loading: runsLoading } = useTaskRuns(taskId);
  const taskTokenTotals = useMemo(() => {
    return getTaskTokenTotals(taskRuns);
  }, [taskRuns]);
  const [liveDiff, setLiveDiff] = useState<TaskLiveDiff | null>(null);
  const [liveDiffLoading, setLiveDiffLoading] = useState(false);
  const [liveDiffError, setLiveDiffError] = useState<string | null>(null);
  const [liveDiffRefreshKey, setLiveDiffRefreshKey] = useState(0);
  const [followUpForm] = Form.useForm();
  const [iterateInput, setIterateInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [providerInput, setProviderInput] = useState<AgentProvider>("codex");
  const [providerProfileInput, setProviderProfileInput] = useState<ProviderProfile>("high");
  const [modelInput, setModelInput] = useState<string>("gpt-5.4");
  const [branchStrategyInput, setBranchStrategyInput] = useState<TaskBranchStrategy>("feature_branch");
  const { models: providerModels, loading: providerModelsLoading } = useProviderModels(providerInput);
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState("");
  const [planPreview, setPlanPreview] = useState(false);
  const [followUpMode, setFollowUpMode] = useState<FollowUpMode>(null);
  const [activeMainTab, setActiveMainTab] = useState<"chat" | "context" | "diff">("chat");
  const [expandedRunKeys, setExpandedRunKeys] = useState<string[]>([]);
  const [buildingFromRunId, setBuildingFromRunId] = useState<string | null>(null);
  const [selectedChatAction, setSelectedChatAction] = useState<ComposerAction>("plan");
  const [submitting, setSubmitting] = useState<
    null | "plan" | "build" | "iterate" | "review" | "ask" | "cancel" | "config" | "pull" | "push" | "archive" | "delete" | "continue" | "fix" | "savePlan" | "message" | "pin"
  >(null);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedChatActionRef = useRef(false);

  const taskType = task?.taskType ?? "plan";
  const isPlanTask = taskType === "plan";
  const isBuildTask = taskType === "build";
  const isImplementationTask = isPlanTask || isBuildTask;
  const isReviewTask = taskType === "review";
  const isAskTask = taskType === "ask";
  const isArchived = task?.status === "archived";
  const canEditTask = can("task:edit");
  const canDeleteTask = can("task:delete");
  const canCreateFollowUp = canAll(["task:create", "repo:list"]);
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
  const canCancel = canEditTask && (isQueued || isActive);
  const canPull = canEditTask && isImplementationTask && (task?.status === "review" || task?.status === "failed");
  const canPush = canPull;
  const pullCount = task?.pullCount ?? 0;
  const pushCount = task?.pushCount ?? 0;
  const hasCompletedNonImplementationResult = task?.status === "review" || task?.status === "answered";
  const canDelete = canDeleteTask && !!task && !isActive && !isArchived;
  const canArchive = canEditTask && !!task && !isActive && !isArchived;
  const canContinueOnBranch =
    canCreateFollowUp &&
    !isArchived &&
    isImplementationTask &&
    !!task?.branchName &&
    (task.status === "review" || task.status === "accepted");
  const canCreateFixTask =
    canCreateFollowUp &&
    !isArchived &&
    isReviewTask &&
    !!task?.resultMarkdown &&
    (task.status === "review" || task.status === "accepted");
  const canEditPlan = canEditTask && isPlanTask && !!task?.planMarkdown?.trim() && !isActive && !isArchived;
  const currentTaskProvider = task?.provider ?? "codex";
  const currentTaskProviderProfile = task?.providerProfile ?? "high";
  const currentTaskModelOverride = task?.modelOverride ?? "";
  const currentTaskBranchStrategy = task?.branchStrategy ?? "feature_branch";
  const hasExecutionContext = Boolean(task?.executionSummary?.trim());
  const planDraftTrimmed = planDraft.trim();
  const planDraftChanged = planDraft !== (task?.planMarkdown ?? "");
  const configDirty =
    providerInput !== currentTaskProvider ||
    providerProfileInput !== currentTaskProviderProfile ||
    modelInput !== (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider)) ||
    (isImplementationTask && branchStrategyInput !== currentTaskBranchStrategy);

  const resultStatusText = isPlanTask
    ? task?.lastAction === "iterate"
      ? task.status === "plan_queued"
        ? "Plan revision queued"
        : "Revising plan"
      : task?.status === "plan_queued"
        ? "Plan queued"
        : "Planning in progress"
    : isBuildTask
      ? task?.status === "build_queued"
        ? "Build queued"
        : "Build in progress"
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
  const hasStoredDiff = (task?.branchDiff?.trim().length ?? 0) > 0;
  const canRequestLiveDiff = !!task && (isReviewTask || isBuildTask || (isPlanTask && task.lastAction === "build"));
  const hasLiveDiff = liveDiff?.live ?? false;
  const renderedDiff = hasLiveDiff ? liveDiff?.diff ?? "" : task?.branchDiff ?? "";
  const hasDiffTab = hasStoredDiff || canRequestLiveDiff;
  const allowedChatActions = useMemo(() => getAllowedComposerActions(), []);

  useEffect(() => {
    const defaultAction = getDefaultComposerAction(task ?? null);
    selectedChatActionRef.current = false;
    setSelectedChatAction(defaultAction);
  }, [taskId, task?.id]);

  useEffect(() => {
    setLiveDiff(null);
    setLiveDiffError(null);
    setLiveDiffLoading(false);
  }, [taskId]);

  useEffect(() => {
    if (!allowedChatActions.includes(selectedChatAction)) {
      selectedChatActionRef.current = false;
      setSelectedChatAction(getDefaultComposerAction(task ?? null));
      return;
    }

    if (!selectedChatActionRef.current) {
      setSelectedChatAction(getDefaultComposerAction(task ?? null));
    }
  }, [allowedChatActions, selectedChatAction, task]);

  useEffect(() => {
    if (!task) {
      return;
    }

    setProviderInput(task.provider ?? "codex");
    setProviderProfileInput(task.providerProfile ?? "high");
    setModelInput(task.modelOverride ?? getDefaultModelForProvider(task.provider ?? "codex"));
    setBranchStrategyInput(task.branchStrategy ?? "feature_branch");
  }, [task]);

  useEffect(() => {
    if (!task || task.taskType !== "plan" || !task.planMarkdown?.trim()) {
      setIsEditingPlan(false);
      setPlanPreview(false);
      setPlanDraft("");
      return;
    }

    if (!isEditingPlan) {
      setPlanDraft(task.planMarkdown);
      setPlanPreview(false);
    }
  }, [isEditingPlan, task]);

  useEffect(() => {
    if (!isArchived) {
      return;
    }

    setIsEditingPlan(false);
    setPlanPreview(false);
    setFollowUpMode(null);
  }, [isArchived]);

  useEffect(() => {
    if (activeMainTab !== "diff" || !task || !canRequestLiveDiff) {
      return;
    }

    let cancelled = false;
    const loadLiveDiff = async () => {
      setLiveDiffLoading(true);
      try {
        const snapshot = await api.getTaskLiveDiff(task.id);
        if (!cancelled) {
          setLiveDiff(snapshot);
          setLiveDiffError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLiveDiffError(error instanceof Error ? error.message : "Failed to refresh live diff");
        }
      } finally {
        if (!cancelled) {
          setLiveDiffLoading(false);
        }
      }
    };

    void loadLiveDiff();
    const timer = window.setInterval(() => void loadLiveDiff(), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeMainTab, canRequestLiveDiff, liveDiffRefreshKey, task?.id, task?.updatedAt, task?.workspaceBaseRef]);

  useEffect(() => {
    if (!task) {
      return;
    }

    if (activeMainTab === "diff" && !hasDiffTab) {
      setActiveMainTab("chat");
    }
  }, [activeMainTab, hasDiffTab, task]);

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

  const outputTitle = isPlanTask ? "Plan" : isBuildTask ? "Summary" : isReviewTask ? "Review" : "Answer";
  const baseBranchLabel = isReviewTask ? "Branch To Review" : isAskTask ? "Context Branch" : "Base Branch";
  const requirementsLabel = isAskTask ? "Question" : "Requirements";
  const followUpBranch = task ? (isReviewTask ? task.baseBranch : task.branchName ?? task.baseBranch) : "";
  const followUpTitle = followUpMode === "fix" ? "Create Fix Task" : "New Task On Existing Branch";
  const providerLabel = task ? getAgentProviderLabel(task.provider) : "Agent";
  const runtimeBranchLabel = task ? (isImplementationTask ? task.branchName ?? task.baseBranch : task.baseBranch) : "";
  const githubDiffTarget = task ? getGitHubDiffTarget(task) : null;
  const chatActionLabel = taskActionLabel[selectedChatAction];
  const hasReadOnlyTaskAccess = !canEditTask;
  const chatClosed = !task || hasReadOnlyTaskAccess || task.status === "accepted" || task.status === "archived" || task.status === "cancelled";
  const chatDisabled = chatClosed || (selectedChatAction !== "comment" && (isQueued || isActive));
  const chatPlaceholder = chatDisabled
    ? hasReadOnlyTaskAccess
      ? "You have read-only access to this task."
      : chatClosed
      ? task?.status === "archived"
        ? "This task is archived and read-only."
        : "This task is closed. Create a follow-up task to continue."
      : "Wait for the current run to finish before sending another instruction."
    : selectedChatAction === "comment"
      ? "Add a comment to the task history"
    : selectedChatAction === "ask"
      ? "Ask a repository question or refine the last answer"
      : selectedChatAction === "review"
        ? "Add review instructions for the next pass"
        : selectedChatAction === "build"
          ? "Describe the next implementation change for this branch"
          : hasExecutionContext
            ? "Describe how the current plan should change before the next run"
            : "Add instructions for the first planning pass";
  const duplicatedRunSummaries = new Set(
    taskRuns
      .filter((entry) => entry.summary?.trim())
      .map((entry) => `${entry.action}:${entry.summary?.trim()}`)
  );
  const chatTimeline = [
    ...taskMessages
      .filter(
        (entry) =>
          entry.role !== "system" &&
          !(entry.role === "assistant" && entry.action && duplicatedRunSummaries.has(`${entry.action}:${entry.content.trim()}`))
      )
      .map((entry) => ({
        key: `message-${entry.id}`,
        kind: "message" as const,
        timestamp: entry.createdAt,
        message: entry
      })),
    ...taskRuns.map((entry) => ({
      key: `run-${entry.id}`,
      kind: "run" as const,
      timestamp: entry.startedAt,
      run: entry
    }))
  ].sort((left, right) => {
    if (left.timestamp === right.timestamp) {
      return left.key.localeCompare(right.key);
    }

    return left.timestamp.localeCompare(right.timestamp);
  });
  const openFollowUp = (mode: FollowUpMode) => {
    followUpForm.setFieldsValue({ title: "", requirements: "", taskType: "build" });
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
  const handleCancelPlanEdit = () => {
    setPlanDraft(task?.planMarkdown ?? "");
    setPlanPreview(false);
    setIsEditingPlan(false);
  };
  const handleSavePlan = async () => {
    if (!task || !isPlanTask || planDraftTrimmed.length === 0) {
      return;
    }

    setSubmitting("savePlan");
    try {
      const updatedTask = await api.updateTaskPlan(task.id, { planMarkdown: planDraftTrimmed });
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: current.logs
            }
          : updatedTask
      );
      setPlanDraft(updatedTask.planMarkdown ?? planDraftTrimmed);
      setPlanPreview(false);
      setIsEditingPlan(false);
      setActiveMainTab("context");
      messageApi.success("Plan updated");
    } finally {
      setSubmitting(null);
    }
  };
  const handleSaveConfig = async ({ notify = true }: { notify?: boolean } = {}) => {
    if (!task || !canEditTask || isArchived || !configDirty) {
      return;
    }

    setSubmitting("config");
    try {
      const updatedTask = await api.updateTaskConfig(task.id, {
        provider: providerInput,
        providerProfile: providerProfileInput,
        modelOverride: modelInput || null,
        branchStrategy: isImplementationTask ? branchStrategyInput : undefined
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
      if (notify) {
        messageApi.success(isActive ? "Execution config updated. It will apply to the next run." : "Execution config updated");
      }
    } finally {
      setSubmitting(null);
    }
  };
  const handleTogglePin = async () => {
    if (!task) {
      return;
    }

    setSubmitting("pin");
    try {
      const updatedTask = await api.updateTaskPin(task.id, { pinned: !task.pinned });
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      messageApi.success(updatedTask.pinned ? "Task pinned" : "Task unpinned");
    } finally {
      setSubmitting(null);
    }
  };
  const handleArchiveTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("archive");
    try {
      const updatedTask = await api.archiveTask(task.id);
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      setIsEditingPlan(false);
      setPlanPreview(false);
      setFollowUpMode(null);
      messageApi.success("Task archived");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to archive task");
    } finally {
      setSubmitting(null);
    }
  };
  const handlePushTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("push");
    try {
      const updatedTask = await api.pushTask(task.id);
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      messageApi.success("Changes pushed");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to push changes");
    } finally {
      setSubmitting(null);
    }
  };
  const handlePullTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("pull");
    try {
      const updatedTask = await api.pullTask(task.id);
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      messageApi.success("Changes pulled");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to pull changes");
    } finally {
      setSubmitting(null);
    }
  };
  const moreActionItems = task && !isArchived
    ? [
        canEditTask ? { key: "pin", label: task.pinned ? "Unpin Task" : "Pin Task" } : null,
        canContinueOnBranch ? { key: "continue", label: "Continue On Branch" } : null,
        canCreateFixTask ? { key: "fix", label: "Create Fix Task" } : null,
        canDelete ? { key: "delete", label: "Delete Task", danger: true } : null
      ].filter(Boolean)
    : [];
  const hasMoreActions = moreActionItems.length > 0;
  const contextContent = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Repository">{task?.repoName}</Descriptions.Item>
          <Descriptions.Item label="Task Type">{task ? getTaskTypeLabel(task.taskType) : ""}</Descriptions.Item>
          <Descriptions.Item label="Queue Mode">{task?.queueMode}</Descriptions.Item>
          <Descriptions.Item label={baseBranchLabel}>{task?.baseBranch}</Descriptions.Item>
          <Descriptions.Item label="Repository Default Branch">{task?.repoDefaultBranch}</Descriptions.Item>
          {isImplementationTask ? <Descriptions.Item label="Branch Strategy">{task ? getTaskBranchStrategyLabel(task.branchStrategy) : ""}</Descriptions.Item> : null}
          {isImplementationTask ? <Descriptions.Item label="Target Branch">{task?.branchName ?? "(pending)"}</Descriptions.Item> : null}
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
          <Descriptions.Item label="Model">{currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider)}</Descriptions.Item>
          <Descriptions.Item label="Effort">{getProviderProfileLabel(currentTaskProviderProfile)}</Descriptions.Item>
          {isImplementationTask ? <Descriptions.Item label="Complexity">{task?.complexity}</Descriptions.Item> : null}
          {isImplementationTask ? (
            <Descriptions.Item label="Planning Mode">
              {isBuildTask ? "Build Only" : "Plan First"}
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Created">{task ? dayjs(task.createdAt).format("YYYY-MM-DD HH:mm") : ""}</Descriptions.Item>
          <Descriptions.Item label="Status">{task ? getTaskStatusLabel(task.status) : ""}</Descriptions.Item>
          <Descriptions.Item label="Last Action">{task?.lastAction ?? "draft"}</Descriptions.Item>
          {isPlanTask ? <Descriptions.Item label="Plan File">{task?.planPath ?? "(pending)"}</Descriptions.Item> : null}
        </Descriptions>

        <Divider orientation="left">{requirementsLabel}</Divider>
        <Typography.Paragraph style={codeTextStyle}>{task?.requirements}</Typography.Paragraph>
      </Card>

      {!isPlanTask && hasOutputTab ? (
        <Collapse
          size="small"
          defaultActiveKey={["plan-panel"]}
          items={[
            {
              key: "plan-panel",
              label: outputTitle,
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
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

                  {isPlanTask ? (
                    <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                      <Typography.Text type="secondary">
                        {isEditingPlan ? (planPreview ? "Previewing manual plan edit" : "Editing approved plan markdown") : "Approved plan markdown"}
                      </Typography.Text>
                      {canEditPlan ? (
                        isEditingPlan ? (
                          <Space wrap>
                            <Button onClick={() => setPlanPreview((current) => !current)}>
                              {planPreview ? "Edit Draft" : "Preview"}
                            </Button>
                            <Button onClick={handleCancelPlanEdit}>Cancel</Button>
                            <Button
                              type="primary"
                              onClick={handleSavePlan}
                              disabled={!planDraftChanged || planDraftTrimmed.length === 0}
                              loading={submitting === "savePlan"}
                            >
                              Save
                            </Button>
                          </Space>
                        ) : (
                          <Button onClick={() => setIsEditingPlan(true)}>Edit Plan</Button>
                        )
                      ) : null}
                    </Flex>
                  ) : null}

                  {isPlanTask && isEditingPlan && !planPreview ? (
                    <Input.TextArea value={planDraft} onChange={(event) => setPlanDraft(event.target.value)} rows={20} style={{ resize: "vertical" }} />
                  ) : isPlanTask ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {isEditingPlan ? planDraft : (task?.planMarkdown ?? "")}
                    </ReactMarkdown>
                  ) : task?.resultMarkdown ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {task.resultMarkdown}
                    </ReactMarkdown>
                  ) : null}

                  {canEditTask && isPlanTask && !isEditingPlan ? (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Input.TextArea
                        rows={4}
                        placeholder="Iterate the plan with another instruction"
                        value={iterateInput}
                        onChange={(event) => setIterateInput(event.target.value)}
                        disabled={isArchived}
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
                          disabled={!hasExecutionContext || iterateInput.trim().length === 0 || task?.status === "accepted" || task?.status === "archived"}
                          loading={submitting === "iterate"}
                        >
                          Iterate Plan
                        </Button>
                        <Typography.Text type="secondary">Latest plan iteration: {task?.latestIterationInput ?? "none"}</Typography.Text>
                      </Space>
                    </Space>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      ) : null}

    </Space>
  );

  const diffContent = hasDiffTab ? (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <Typography.Text type="secondary">
          {hasLiveDiff
            ? `Live workspace diff · updated ${dayjs(liveDiff?.fetchedAt).format("HH:mm:ss")}`
            : hasStoredDiff
              ? "Showing last captured diff from task state because no live workspace diff is available."
              : liveDiff?.message ?? "Live diff will appear once the task workspace exists."}
        </Typography.Text>
        <Button
          onClick={() => setLiveDiffRefreshKey((current) => current + 1)}
          loading={liveDiffLoading}
          disabled={!canRequestLiveDiff}
        >
          Refresh
        </Button>
      </Flex>
      {liveDiffError ? <Alert type="warning" showIcon message="Live diff refresh failed" description={liveDiffError} /> : null}
      {githubDiffTarget ? (
        <Flex justify="flex-end">
          <Button href={githubDiffTarget.href} target="_blank" rel="noreferrer">
            {githubDiffTarget.label}
          </Button>
        </Flex>
      ) : null}
      {isReviewTask
        ? renderParsedDiff(renderedDiff, `No diff captured for ${task?.baseBranch} against ${task?.repoDefaultBranch}.`, {
            collapseFiles: true
          })
        : renderParsedDiff(
            renderedDiff,
            hasLiveDiff ? "No current workspace changes detected." : "No diff captured yet. Run Build to generate one.",
            { collapseFiles: true }
          )}
    </Space>
  ) : null;

  const chatComposer = (
    <Flex vertical gap={12}>
      <Input.TextArea
        rows={4}
        value={chatInput}
        onChange={(event) => setChatInput(event.target.value)}
        placeholder={chatPlaceholder}
        disabled={chatDisabled}
      />
      <Flex justify="space-between" align="flex-end" gap={12} wrap="wrap">
        <Flex align="flex-end" gap={12} wrap="wrap" style={{ flex: "1 1 0", minWidth: 0 }}>
          <div
            style={{
              minWidth: 160,
              maxWidth: 240,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Typography.Text type="secondary">Provider</Typography.Text>
            <Select
              value={providerInput}
              options={providerOptions}
              onChange={(value) => {
                setProviderInput(value);
                setModelInput(getDefaultModelForProvider(value));
              }}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!canEditTask || isArchived}
            />
          </div>
          <div
            style={{
              minWidth: 160,
              maxWidth: 240,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Typography.Text type="secondary">Model</Typography.Text>
            <Select
              value={modelInput}
              options={providerModels}
              loading={providerModelsLoading}
              showSearch
              optionFilterProp="label"
              onChange={(value) => setModelInput(value)}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!canEditTask || isArchived}
            />
          </div>
          <div
            style={{
              minWidth: 160,
              maxWidth: 220,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Typography.Text type="secondary">Effort</Typography.Text>
            <Select
              value={providerProfileInput}
              options={getEffortOptionsForProvider(providerInput)}
              onChange={(value) => setProviderProfileInput(value)}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!canEditTask || isArchived}
            />
          </div>
        </Flex>
        <Flex align="center" gap={12} wrap="wrap" style={{ flexShrink: 0 }}>
          <Typography.Text type="secondary">Next run: {chatActionLabel}</Typography.Text>
          <Space.Compact size="middle">
            <Select
              value={selectedChatAction}
              options={allowedChatActions.map((action) => ({
                label: taskActionLabel[action],
                value: action
              }))}
              disabled={chatClosed}
              onChange={(value) => {
                selectedChatActionRef.current = true;
                setSelectedChatAction(value);
              }}
              style={{ minWidth: 140 }}
            />
            <Button
              type="primary"
              loading={submitting === "message"}
              disabled={chatDisabled || chatInput.trim().length === 0}
              onClick={async () => {
                if (!task || chatInput.trim().length === 0) {
                  return;
                }

                if (configDirty && canEditTask && !isArchived) {
                  await handleSaveConfig({ notify: false });
                }
                setSubmitting("message");
                try {
                  const updatedTask = await api.createTaskMessage(task.id, {
                    content: chatInput.trim(),
                    action: selectedChatAction
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
                  setChatInput("");
                  messageApi.success(
                    selectedChatAction === "comment"
                      ? "Comment added to history"
                      : `${taskActionLabel[selectedChatAction]} queued from history`
                  );
                } catch (error) {
                  const nextMessage = error instanceof Error ? error.message : "Task execution could not be started";
                  messageApi.error(nextMessage);
                } finally {
                  setSubmitting(null);
                }
              }}
            >
              Send
            </Button>
          </Space.Compact>
        </Flex>
      </Flex>
      {isActive ? <Typography.Text type="secondary">Changes apply to the next run.</Typography.Text> : null}
    </Flex>
  );

  const chatHistory = chatTimeline.length > 0 ? (
    <Flex vertical gap={12} style={{ width: "100%" }}>
      {chatTimeline.map((entry) => {
        if (entry.kind === "message") {
          const entryMessage = entry.message;
          const messageColor =
            entryMessage.role === "user"
              ? "rgba(28,128,87,0.08)"
              : entryMessage.role === "assistant"
                ? "#ffffff"
                : "rgba(107,143,163,0.08)";
          const isCompactMessage = entryMessage.role === "user";

          return (
            <Flex key={entry.key}>
              <Card
                size="small"
                bodyStyle={{
                  background: messageColor,
                  padding: isCompactMessage ? "10px 12px" : undefined
                }}
                style={{ width: "100%" }}
              >
                {isCompactMessage ? (
                  <Flex vertical gap={4}>
                    <Flex align="baseline" gap={8} wrap="wrap">
                      <Tag color="green" style={{ marginInlineEnd: 0 }}>
                        {entryMessage.role}
                      </Tag>
                      {entryMessage.action ? (
                        <Tag style={{ marginInlineEnd: 0 }}>{taskActionLabel[entryMessage.action]}</Tag>
                      ) : null}
                      <Typography.Text type="secondary">{dayjs(entryMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>
                    </Flex>
                    <Typography.Text style={{ whiteSpace: "pre-wrap" }}>{entryMessage.content}</Typography.Text>
                  </Flex>
                ) : (
                  <>
                    <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{ marginBottom: 8 }}>
                      <Space wrap size={8}>
                        <Tag color="blue">assistant</Tag>
                        {entryMessage.action ? <Tag>{taskActionLabel[entryMessage.action]}</Tag> : null}
                      </Space>
                      <Typography.Text type="secondary">{dayjs(entryMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>
                    </Flex>
                    <ExpandableMessageContent fadeColor={messageColor}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {entryMessage.content}
                      </ReactMarkdown>
                    </ExpandableMessageContent>
                  </>
                )}
              </Card>
            </Flex>
          );
        }

        const run = entry.run;
        const collapseItems = [
          {
            key: run.id,
            label: `Logs${run.logs.length > 0 ? ` (${run.logs.length})` : ""}`,
            children: (
              <div
                style={{
                  padding: "14px 16px",
                  background: "#0b0f14",
                  borderRadius: 8
                }}
              >
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
                  {run.logs.join("\n") || "No logs captured for this run."}
                </pre>
              </div>
            )
          }
        ];
        const isCollapsibleSummaryRun = run.action === "plan" || run.action === "iterate" || run.action === "build";
        const normalizedRunSummary =
          run.status === "failed" && run.errorMessage
            ? (() => {
                const summary = run.summary?.trim();
                const errorMessage = run.errorMessage.trim();
                if (!summary) {
                  return null;
                }
                if (summary === errorMessage || summary === `Task failed: ${errorMessage}`) {
                  return null;
                }
                return summary;
              })()
            : run.summary?.trim() || null;
        const summaryCollapseItems = normalizedRunSummary
          ? [
              {
                key: `${run.id}-summary`,
                label: run.action === "build" ? "Implementation Summary" : run.action === "plan" || run.action === "iterate" ? "Plan" : "Summary",
                extra:
                  isPlanTask && (run.action === "plan" || run.action === "iterate") ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (!task || task.builtPlanRunIds.includes(run.id)) {
                          return;
                        }

                        setSubmitting("build");
                        setBuildingFromRunId(run.id);
                        try {
                          const updatedTask = await api.buildTaskFromRun(task.id, run.id);
                          setTask((current) =>
                            current
                              ? {
                                  ...current,
                                  ...updatedTask,
                                  logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
                                }
                              : updatedTask
                          );
                          messageApi.success("Build started from selected plan");
                        } catch (error) {
                          const nextMessage = error instanceof Error ? error.message : "Build could not be started";
                          messageApi.error(nextMessage);
                        } finally {
                          setBuildingFromRunId(null);
                          setSubmitting(null);
                        }
                      }}
                      disabled={
                        !canEditTask ||
                        !task ||
                        task.builtPlanRunIds.includes(run.id) ||
                        isQueued ||
                        isActive ||
                        task.status === "accepted" ||
                        task.status === "archived" ||
                        task.status === "cancelled"
                      }
                      loading={submitting === "build" && buildingFromRunId === run.id}
                    >
                      {task?.builtPlanRunIds.includes(run.id) ? "Built" : "Build"}
                    </Button>
                  ) : null,
                children: (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {normalizedRunSummary}
                  </ReactMarkdown>
                )
              }
            ]
          : [];

        return (
          <Flex key={entry.key}>
            <Card size="small" style={{ width: "100%" }}>
              <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{ marginBottom: 8 }}>
                <Space wrap size={8}>
                  <Tag color={runStatusColor[run.status]}>{run.status}</Tag>
                  <Tag>{taskActionLabel[run.action]}</Tag>
                  <Tag>{getAgentProviderLabel(run.provider)}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  {dayjs(run.startedAt).format("YYYY-MM-DD HH:mm:ss")} · {formatRunDuration(run.startedAt, run.finishedAt)}
                </Typography.Text>
              </Flex>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                Branch: <Typography.Text code>{run.branchName ?? "(pending)"}</Typography.Text>
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {(() => {
                  const tokenStr = formatTokenUsage(run.tokenUsage);
                  if (run.tokenUsage?.status !== "available" || !run.tokenUsage.inputTokens || !run.tokenUsage.outputTokens) {
                    return `Tokens: ${tokenStr}`;
                  }
                  const cost = estimateCost(getRunModel(run), run.tokenUsage.inputTokens, run.tokenUsage.outputTokens);
                  return `Tokens: ${tokenStr}${cost ? ` · est. ${formatCost(cost.totalCost)}` : ""}`;
                })()}
              </Typography.Paragraph>
              {normalizedRunSummary ? (
                isCollapsibleSummaryRun ? (
                  <Collapse size="small" defaultActiveKey={[]} items={summaryCollapseItems} style={{ marginBottom: 12 }} />
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {normalizedRunSummary}
                    </ReactMarkdown>
                  </div>
                )
              ) : null}
              {run.errorMessage ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(201,92,92,0.08)",
                    border: "1px solid rgba(201,92,92,0.18)"
                  }}
                >
                  <Typography.Text strong type="danger">
                    Run failed
                  </Typography.Text>
                  <Typography.Paragraph type="danger" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                    {run.errorMessage}
                  </Typography.Paragraph>
                </div>
              ) : null}
              <Collapse
                size="small"
                activeKey={expandedRunKeys.includes(run.id) ? [run.id] : []}
                onChange={(keys) =>
                  setExpandedRunKeys((current) => {
                    const isOpen = Array.isArray(keys) ? keys.length > 0 : Boolean(keys);
                    return isOpen ? (current.includes(run.id) ? current : [...current, run.id]) : current.filter((key) => key !== run.id);
                  })
                }
                items={collapseItems}
              />
            </Card>
          </Flex>
        );
      })}
    </Flex>
  ) : <Empty description={messagesLoading || runsLoading ? "Loading history..." : "No history yet."} image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const mainTabItems = [
    {
      key: "chat",
      label: "History",
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {chatHistory}
          {chatComposer}
        </Space>
      )
    },
    ...(hasDiffTab
      ? [
          {
            key: "diff",
            label: "Diff",
            children: diffContent
          }
        ]
      : []),
    {
      key: "context",
      label: "Context",
      children: contextContent
    }
  ];

  return (
    <>
      {contextHolder}
      <Flex vertical gap={16} style={{ width: "100%", paddingBottom: 16 }}>
        <Flex vertical gap={12}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {task?.title ?? "Task Detail"}
          </Typography.Title>
          {isArchived ? (
            <Alert
              type="info"
              showIcon
              message="Archived task"
              description="Archived tasks are read-only. You can review history, plans, output, and diffs, but you cannot restart or change the task."
            />
          ) : !canEditTask ? (
            <Alert
              type="info"
              showIcon
              message="Read-only task access"
              description="This account can review task state and history, but it cannot change the task."
            />
          ) : null}
          {task ? (
            <Flex justify="space-between" align="center" gap={12} wrap="wrap">
              <Space wrap size={8}>
                <Tag color={statusColor[task.status]}>{getTaskStatusLabel(task.status)}</Tag>
              </Space>
              <Space wrap size={8} style={{ justifyContent: "flex-end" }}>
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
                ) : null}

                {canPull ? (
                  <Button onClick={handlePullTask} loading={submitting === "pull"}>
                    {`Pull (${pullCount})`}
                  </Button>
                ) : null}

                {canPush ? (
                  <Button onClick={handlePushTask} loading={submitting === "push"}>
                    {`Push (${pushCount})`}
                  </Button>
                ) : null}

                {!canCancel && !hasCompletedNonImplementationResult && canEditTask && isReviewTask && task.status !== "accepted" && task.status !== "archived" ? (
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

                {!canCancel && !hasCompletedNonImplementationResult && canEditTask && isAskTask && task.status !== "accepted" && task.status !== "archived" ? (
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

                {canArchive ? (
                  <Button
                    danger
                    loading={submitting === "archive"}
                    onClick={() =>
                      Modal.confirm({
                        title: "Archive task?",
                        content: "Archived tasks become read-only and cannot be restarted.",
                        okText: "Archive",
                        onOk: handleArchiveTask
                      })
                    }
                  >
                    Archive
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

                        if (key === "pin") {
                          void handleTogglePin();
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
                    <Button icon={<MoreOutlined />}>Manage</Button>
                  </Dropdown>
                ) : null}
              </Space>
            </Flex>
          ) : null}
        </Flex>

        {loading ? (
          <Card loading bordered={false} />
        ) : task ? (
          <Flex vertical gap={16}>
            <Card bordered={false}>
              {taskTokenTotals ? (
                <Alert
                  type="info"
                  showIcon
                  message={[
                    `${taskTokenTotals.totalTokens.toLocaleString()} tokens`,
                    `(${taskTokenTotals.inputTokens.toLocaleString()} in / ${taskTokenTotals.outputTokens.toLocaleString()} out)`,
                    `across ${taskTokenTotals.runCount} run${taskTokenTotals.runCount === 1 ? "" : "s"}`,
                    taskTokenTotals.cost
                      ? `· est. ${formatCost(taskTokenTotals.cost.totalCost)}`
                      : null
                  ].filter(Boolean).join(" ")}
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              <Tabs activeKey={activeMainTab} onChange={(value) => setActiveMainTab(value as "chat" | "context" | "diff")} items={mainTabItems} />
            </Card>
          </Flex>
        ) : null}
      </Flex>

      <Modal
        open={followUpMode !== null && canCreateFollowUp}
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
            initialValues={{ taskType: "build" }}
            onFinish={async (values: { title: string; requirements: string; taskType: "plan" | "build" }) => {
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
                  taskType: values.taskType,
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
                  nextTask.taskType === "build"
                    ? "Follow-up build task created and started on branch"
                    : "Follow-up plan task created and planning started on branch"
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
              <Form.Item name="taskType" label="Task Type" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: "Plan", value: "plan" },
                    { label: "Build", value: "build" }
                  ]}
                />
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
