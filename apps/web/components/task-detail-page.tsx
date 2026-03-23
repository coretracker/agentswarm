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
  isActiveTaskStatus,
  type Task,
  type TaskAction,
  type TaskMessageAction,
  type TaskMessage,
  type TaskLiveDiff,
  type TaskRun,
  type AgentProvider,
  type TaskBranchStrategy,
  type ProviderProfile,
  type Preset,
  type GitHubBranchReference,
  type TaskPushPreview
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
  Segmented,
  Select,
  Space,
  Tag,
  Tabs,
  Tooltip,
  Typography,
  message
} from "antd";
import { ArrowRightOutlined, EditOutlined, LoadingOutlined, MoreOutlined, PushpinOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Diff, Hunk } from "react-diff-view";
import remarkGfm from "remark-gfm";
import { api, type TaskInteractiveTerminalStatus } from "../src/api/client";
import { usePresets } from "../src/hooks/usePresets";
import { useTask } from "../src/hooks/useTask";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useTaskMessages } from "../src/hooks/useTaskMessages";
import { useTaskRuns } from "../src/hooks/useTaskRuns";
import { normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";
import { estimateCost, formatCost } from "../src/utils/pricing";
import { useAuth } from "./auth-provider";
import { TaskDiffOpenAiPanel } from "./task-diff-openai-panel";

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
  return ["build", "ask", "comment"];
}

function getDefaultComposerAction(task: Task | null): ComposerAction {
  if (!task) {
    return "build";
  }

  if (task.taskType === "review") {
    return "review";
  }

  if (task.lastAction === "build" || task.lastAction === "ask") {
    return task.lastAction;
  }

  return "build";
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
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

function formatDiffRefDisplay(ref: string | null | undefined): string {
  if (!ref?.trim()) {
    return "—";
  }
  const trimmed = ref.trim();
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  return trimmed;
}

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
      label: "Create PR"
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
      label: "Create PR"
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
  const { presets, loading: presetsLoading } = usePresets();
  const taskTokenTotals = useMemo(() => {
    return getTaskTokenTotals(taskRuns);
  }, [taskRuns]);
  const [liveDiff, setLiveDiff] = useState<TaskLiveDiff | null>(null);
  const [liveDiffLoading, setLiveDiffLoading] = useState(false);
  const [liveDiffError, setLiveDiffError] = useState<string | null>(null);
  const [liveDiffRefreshKey, setLiveDiffRefreshKey] = useState(0);
  const [diffLiveKind, setDiffLiveKind] = useState<"compare" | "working">("working");
  const [diffCompareBaseRef, setDiffCompareBaseRef] = useState<string | null>(null);
  const [diffBranches, setDiffBranches] = useState<GitHubBranchReference[]>([]);
  const [diffBranchesLoading, setDiffBranchesLoading] = useState(false);
  const [followUpForm] = Form.useForm();
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
  const [selectedChatAction, setSelectedChatAction] = useState<ComposerAction>("build");
  const [submitting, setSubmitting] = useState<
    | null
    | "plan"
    | "build"
    | "review"
    | "ask"
    | "cancel"
    | "config"
    | "pull"
    | "push"
    | "merge"
    | "archive"
    | "delete"
    | "continue"
    | "fix"
    | "savePlan"
    | "message"
    | "pin"
    | "renameTitle"
  >(null);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedChatActionRef = useRef(false);
  const diffCompareBaseSyncedTaskIdRef = useRef<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [pushPreview, setPushPreview] = useState<TaskPushPreview | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushPreviewError, setPushPreviewError] = useState<string | null>(null);
  const [pushCommitMessage, setPushCommitMessage] = useState("");
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTitleDraft, setRenameTitleDraft] = useState("");
  const [spawnPresetFromTask, setSpawnPresetFromTask] = useState<Preset | null>(null);
  const [spawnBranches, setSpawnBranches] = useState<GitHubBranchReference[]>([]);
  const [spawnBranchesLoading, setSpawnBranchesLoading] = useState(false);
  const [spawnBaseBranch, setSpawnBaseBranch] = useState<string | undefined>();
  const [spawnModalOpen, setSpawnModalOpen] = useState(false);
  const [spawningId, setSpawningId] = useState<string | null>(null);
  const [interactiveTerminalStatus, setInteractiveTerminalStatus] = useState<TaskInteractiveTerminalStatus | null>(null);

  const taskType = task?.taskType ?? "build";
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
  const isActive = task ? isActiveTaskStatus(task.status) : false;
  const isPreparingWorkspace = task?.status === "preparing_workspace";
  const canCancel = canEditTask && (isQueued || isActive);
  const hasBranchForSync = isPlanTask || isBuildTask || isAskTask;
  const canPull = canEditTask && hasBranchForSync && !!task?.branchName && !isArchived && !isActive;
  const canPush = canPull;
  const canMerge =
    canEditTask &&
    hasBranchForSync &&
    !isArchived &&
    task?.branchStrategy === "feature_branch" &&
    !!task?.branchName &&
    task.branchName !== task.repoDefaultBranch;
  const canSpawnPresetFromTask = canAll(["preset:read", "task:create"]) && !!task;
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

  const resultStatusText =
    task?.status === "preparing_workspace"
      ? "Preparing workspace"
      : isPlanTask
        ? task?.status === "plan_queued"
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
  const hasOutputTab =
    (task?.planMarkdown?.trim().length ?? 0) > 0 || (task?.resultMarkdown?.trim().length ?? 0) > 0;
  const hasStoredDiff = (task?.branchDiff?.trim().length ?? 0) > 0;
  const canRequestLiveDiff = !!task;
  const hasLiveDiff = liveDiff?.live ?? false;
  const compareRefError =
    diffLiveKind === "compare" &&
    Boolean(liveDiff && !liveDiff.live && liveDiff.message?.includes("Compare ref not found"));
  const renderedDiff = hasLiveDiff ? liveDiff?.diff ?? "" : compareRefError ? "" : task?.branchDiff ?? "";
  const hasDiffTab = hasStoredDiff || canRequestLiveDiff;
  const diffBaseBranchOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const repoDefault = task?.repoDefaultBranch;
    if (repoDefault?.trim()) {
      seen.add(repoDefault);
      options.push({ value: repoDefault, label: `${repoDefault} (repo default)` });
    }
    for (const branch of diffBranches) {
      if (seen.has(branch.name)) {
        continue;
      }
      seen.add(branch.name);
      options.push({
        value: branch.name,
        label: branch.isDefault ? `${branch.name} (repo default)` : branch.name
      });
    }
    return options;
  }, [task?.repoDefaultBranch, diffBranches]);
  const allowedChatActions = useMemo(() => getAllowedComposerActions(), []);
  const taskPresets = useMemo(() => presets, [presets]);

  useEffect(() => {
    const defaultAction = getDefaultComposerAction(task ?? null);
    selectedChatActionRef.current = false;
    setSelectedChatAction(defaultAction);
  }, [taskId, task?.id]);

  useEffect(() => {
    setLiveDiff(null);
    setLiveDiffError(null);
    setLiveDiffLoading(false);
    diffCompareBaseSyncedTaskIdRef.current = null;
  }, [taskId]);

  useEffect(() => {
    if (!task?.id) {
      return;
    }
    if (diffCompareBaseSyncedTaskIdRef.current !== task.id) {
      diffCompareBaseSyncedTaskIdRef.current = task.id;
      setDiffCompareBaseRef(task.repoDefaultBranch?.trim() ? task.repoDefaultBranch : null);
    }
  }, [task?.id, task?.repoDefaultBranch]);

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
    if (!task?.id || !canEditTask || isArchived) {
      setInteractiveTerminalStatus(null);
      return;
    }

    let cancelled = false;
    void api
      .getTaskInteractiveTerminalStatus(task.id)
      .then((status) => {
        if (!cancelled) {
          setInteractiveTerminalStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInteractiveTerminalStatus({
            available: false,
            reason: "Could not load interactive terminal status."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [task?.id, canEditTask, isArchived]);

  useEffect(() => {
    if (activeMainTab !== "diff" || !task?.repoId) {
      return;
    }

    let cancelled = false;
    setDiffBranchesLoading(true);
    void api
      .listGitHubBranches(task.repoId)
      .then((branches) => {
        if (!cancelled) {
          setDiffBranches(branches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffBranches([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDiffBranchesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeMainTab, task?.repoId]);

  useEffect(() => {
    setLiveDiff(null);
  }, [diffLiveKind]);

  useEffect(() => {
    if (activeMainTab !== "diff" || !task || !canRequestLiveDiff) {
      return;
    }

    let cancelled = false;
    const loadLiveDiff = async () => {
      setLiveDiffLoading(true);
      try {
        const snapshot = await api.getTaskLiveDiff(task.id, {
          baseRef: diffCompareBaseRef ?? task.repoDefaultBranch ?? undefined,
          diffKind: diffLiveKind
        });
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
  }, [
    activeMainTab,
    canRequestLiveDiff,
    diffCompareBaseRef,
    diffLiveKind,
    liveDiffRefreshKey,
    task?.id,
    task?.updatedAt,
    task?.workspaceBaseRef
  ]);

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

  const outputTitle =
    (task?.planMarkdown?.trim().length ?? 0) > 0
      ? "Plan"
      : task?.lastAction === "ask"
        ? "Answer"
        : task?.lastAction === "build"
          ? "Summary"
          : task?.lastAction === "review"
            ? "Review"
            : "Output";
  const baseBranchLabel = isReviewTask ? "Branch To Review" : "Base Branch";
  const promptLabel = "Prompt";
  const followUpBranch = task ? (isReviewTask ? task.baseBranch : task.branchName ?? task.baseBranch) : "";
  const followUpTitle = followUpMode === "fix" ? "Create Fix Task" : "New Task On Existing Branch";
  const providerLabel = task ? getAgentProviderLabel(task.provider) : "Agent";
  const hasBranch = isPlanTask || isBuildTask || isAskTask;
  const runtimeBranchLabel = task ? (hasBranch ? task.branchName ?? task.baseBranch : task.baseBranch) : "";
  const githubDiffTarget = task ? getGitHubDiffTarget(task) : null;
  const chatActionLabel = taskActionLabel[selectedChatAction];
  const hasReadOnlyTaskAccess = !canEditTask;
  const chatClosed = !task || hasReadOnlyTaskAccess || task.status === "accepted" || task.status === "archived";
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
    followUpForm.setFieldsValue({ title: "", prompt: "", taskType: "build" });
    setFollowUpMode(mode);
  };
  const handlePresetSelection = (presetId: string | null) => {
    if (!presetId) {
      setSelectedPresetId(null);
      setChatInput("");

      if (task) {
        const nextProvider = currentTaskProvider;
        setProviderInput(nextProvider);
        setModelInput(currentTaskModelOverride || getDefaultModelForProvider(nextProvider));
        setProviderProfileInput(currentTaskProviderProfile);
      }

      return;
    }

    setSelectedPresetId(presetId);

    const preset = taskPresets.find((item) => item.id === presetId);
    if (!preset) {
      messageApi.error("Selected preset is no longer available.");
      return;
    }

    const definition = preset.definition;

    setProviderInput(definition.provider);
    setModelInput(definition.model);
    setProviderProfileInput(definition.providerProfile);

    if ("taskType" in definition) {
      const nextAction: ComposerAction =
        definition.taskType === "plan"
          ? "build"
          : definition.taskType === "build"
            ? "build"
            : definition.taskType === "review"
              ? "review"
              : "ask";
      selectedChatActionRef.current = true;
      setSelectedChatAction(nextAction);
    }

    if (definition.sourceType === "blank") {
      setChatInput(definition.prompt ?? "");
    } else {
      setChatInput("");
    }

    if (!task || !canSpawnPresetFromTask) {
      return;
    }
  };
  const handleClearComposer = () => {
    const hasChangesToClear =
      !!selectedPresetId ||
      !!chatInput.trim() ||
      providerInput !== currentTaskProvider ||
      providerProfileInput !== currentTaskProviderProfile ||
      modelInput !== (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider));

    if (!hasChangesToClear) {
      return;
    }

    Modal.confirm({
      title: "Clear preset and composer?",
      content:
        "This will deselect the preset, clear the message input, and reset provider and model settings to this task's defaults.",
      okText: "Clear",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: () => {
        handlePresetSelection(null);
      }
    });
  };
  const handleStartPresetFromTask = () => {
    if (!selectedPresetId || !task || !canSpawnPresetFromTask) {
      return;
    }

    const preset = taskPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.error("Selected preset is no longer available.");
      return;
    }

    setSpawnPresetFromTask(preset);
    setSpawnModalOpen(true);
    setSpawnBranches([]);
    setSpawnBaseBranch(undefined);

    if (preset.sourceType === "pull_request") {
      return;
    }

    setSpawnBranchesLoading(true);
    void api
      .listGitHubBranches(preset.repoId)
      .then((branches) => {
        setSpawnBranches(branches);
        const defaultBranch = branches.find((branch) => branch.isDefault)?.name ?? branches[0]?.name;
        const currentTaskBranch = task.branchName ?? task.baseBranch;
        const definitionBaseBranch = "baseBranch" in preset.definition ? preset.definition.baseBranch : undefined;
        const candidateBranches = [currentTaskBranch, definitionBaseBranch, defaultBranch].filter(
          (value): value is string => Boolean(value)
        );
        const branchNames = new Set(branches.map((branch) => branch.name));
        const initialBranch = candidateBranches.find((value) => branchNames.has(value)) ?? branches[0]?.name;
        setSpawnBaseBranch(initialBranch);
      })
      .catch((error) => {
        messageApi.error(error instanceof Error ? error.message : "Failed to load branches");
      })
      .finally(() => {
        setSpawnBranchesLoading(false);
      });
  };
  const handleCloseSpawnModalFromTask = () => {
    setSpawnModalOpen(false);
    setSpawnPresetFromTask(null);
    setSpawnBranches([]);
    setSpawnBaseBranch(undefined);
  };
  const handleConfirmSpawnFromTask = async () => {
    if (!spawnPresetFromTask) {
      return;
    }

    if (spawnPresetFromTask.sourceType !== "pull_request" && !spawnBaseBranch) {
      messageApi.error("Select a target branch before starting this preset.");
      return;
    }

    setSpawningId(spawnPresetFromTask.id);
    try {
      const spawnedTask =
        spawnPresetFromTask.sourceType === "pull_request"
          ? await api.spawnPreset(spawnPresetFromTask.id)
          : await api.spawnPreset(spawnPresetFromTask.id, { baseBranch: spawnBaseBranch });
      messageApi.success("Task created from preset");
      handleCloseSpawnModalFromTask();
      router.push(`/tasks/${spawnedTask.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to spawn preset");
    } finally {
      setSpawningId(null);
    }
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
  const loadPushPreview = async () => {
    if (!task) {
      return;
    }
    setPushPreviewError(null);
    setPushPreviewLoading(true);
    try {
      const preview = await api.getTaskPushPreview(task.id);
      setPushPreview(preview);
      setPushCommitMessage((current) => (current.trim().length > 0 ? current : preview.suggestedCommitMessage));
    } catch (error) {
      setPushPreviewError(error instanceof Error ? error.message : "Could not load push preview");
    } finally {
      setPushPreviewLoading(false);
    }
  };

  const confirmRenameTask = async () => {
    if (!task) {
      return;
    }
    const next = renameTitleDraft.trim();
    if (!next) {
      messageApi.warning("Title cannot be empty");
      return;
    }
    if (next === task.title) {
      setRenameModalOpen(false);
      return;
    }
    setSubmitting("renameTitle");
    try {
      const updatedTask = await api.updateTaskTitle(task.id, { title: next });
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      messageApi.success("Task renamed");
      setRenameModalOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to rename task");
    } finally {
      setSubmitting(null);
    }
  };

  const confirmPushTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("push");
    try {
      const updatedTask = await api.pushTask(task.id, {
        commitMessage: pushCommitMessage.trim() || undefined
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
      messageApi.success("Changes pushed");
      await loadPushPreview();
      setLiveDiffRefreshKey((k) => k + 1);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to push changes");
    } finally {
      setSubmitting(null);
    }
  };
  const handleMergeTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("merge");
    try {
      const updatedTask = await api.mergeTask(task.id);
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      messageApi.success("Merged into default branch");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to merge task branch");
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
  useEffect(() => {
    if (activeMainTab !== "diff" || !task || !canPush) {
      return;
    }
    void loadPushPreview();
  }, [activeMainTab, canPush, task?.id, task?.updatedAt]);

  const moreActionItems = task && !isArchived
    ? [
        canMerge ? { key: "merge", label: `Merge to ${task?.repoDefaultBranch ?? "default branch"}` } : null,
        canRequestLiveDiff ? { key: "refreshDiff", label: "Refresh Diff" } : null,
        canEditTask ? { key: "pin", label: task.pinned ? "Unpin Task" : "Pin Task" } : null,
        canContinueOnBranch ? { key: "continue", label: "Continue On Branch" } : null,
        canCreateFixTask ? { key: "fix", label: "Create Fix Task" } : null,
        canDelete ? { key: "delete", label: "Delete Task", danger: true } : null
      ].filter(Boolean)
    : [];
  const hasMoreActions = moreActionItems.length > 0;
  const canOpenInteractive = canEditTask && !isArchived && !!task;
  const canRunReviewAction =
    !canCancel && !hasCompletedNonImplementationResult && canEditTask && isReviewTask && task?.status !== "accepted" && task?.status !== "archived";
  const hasSyncButtons = canOpenInteractive;
  const hasExecutionButtons = canCancel || canRunReviewAction;
  const hasManagementButtons = Boolean(githubDiffTarget) || canArchive || hasMoreActions;
const contextContent = (
  <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {taskTokenTotals ? (
        <Alert
          type="info"
          showIcon
          message={[
            `${taskTokenTotals.totalTokens.toLocaleString()} tokens`,
            `(${taskTokenTotals.inputTokens.toLocaleString()} in / ${taskTokenTotals.outputTokens.toLocaleString()} out)`,
            `across ${taskTokenTotals.runCount} run${taskTokenTotals.runCount === 1 ? "" : "s"}`,
            taskTokenTotals.cost ? `· est. ${formatCost(taskTokenTotals.cost.totalCost)}` : null
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ) : null}
      <Card size="small">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Repository">{task?.repoName}</Descriptions.Item>
          <Descriptions.Item label="Task Type">{task ? getTaskTypeLabel(task.taskType) : ""}</Descriptions.Item>
          <Descriptions.Item label={baseBranchLabel}>{task?.baseBranch}</Descriptions.Item>
          <Descriptions.Item label="Repository Default Branch">{task?.repoDefaultBranch}</Descriptions.Item>
          {hasBranch ? <Descriptions.Item label="Branch Strategy">{task ? getTaskBranchStrategyLabel(task.branchStrategy) : ""}</Descriptions.Item> : null}
          {hasBranch ? <Descriptions.Item label="Target Branch">{task?.branchName ?? "(pending)"}</Descriptions.Item> : null}
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

        {task?.prompt?.trim() ? (
          <>
            <Divider orientation="left">{promptLabel}</Divider>
            <Typography.Paragraph style={codeTextStyle}>{task.prompt}</Typography.Paragraph>
          </>
        ) : null}
      </Card>

      {hasOutputTab ? (
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
                            ? `${providerLabel} is reviewing the selected branch against the repository default branch and your prompt.`
                            : `${providerLabel} is running. Watch the logs tab; this section will refresh when the run completes.`
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

                  {canEditTask && isPlanTask && !isEditingPlan && task?.latestIterationInput ? (
                    <Typography.Text type="secondary">Latest plan iteration: {task.latestIterationInput}</Typography.Text>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      ) : null}

    </Space>
  );

  const diffHeadLabel = liveDiffLoading && !liveDiff
    ? "Loading…"
    : liveDiff?.headBranch
      ? `${liveDiff.headBranch}${liveDiff.headShaShort ? ` @ ${liveDiff.headShaShort}` : ""}`
      : task?.branchName ?? "—";

  const diffContent = hasDiffTab ? (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {task ? (
        <Card size="small" styles={{ body: { paddingBottom: 12 } }}>
          <Segmented
            value={diffLiveKind}
            onChange={(value) => setDiffLiveKind(value as "compare" | "working")}
            options={[
              { label: "Local changes", value: "working" },
              { label: "Compare to branch", value: "compare" }
            ]}
            style={{ marginBottom: 14 }}
          />
          <Flex align="flex-end" wrap="wrap" gap={16}>
            <div style={{ minWidth: 200, flex: "1 1 220px" }}>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                Base branch
              </Typography.Text>
              <Select
                placeholder={task.repoDefaultBranch ?? "Branch"}
                value={diffCompareBaseRef ?? task.repoDefaultBranch}
                options={diffBaseBranchOptions}
                loading={diffBranchesLoading}
                disabled={!canRequestLiveDiff || diffLiveKind === "working"}
                style={{ width: "100%" }}
                onChange={(value) => {
                  setDiffCompareBaseRef(typeof value === "string" && value.length > 0 ? value : task.repoDefaultBranch ?? null);
                }}
              />
              {diffLiveKind === "working" ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                  Local changes shows uncommitted edits vs HEAD plus untracked files. The base branch is only used in
                  Compare to branch mode.
                </Typography.Paragraph>
              ) : null}
            </div>
            <ArrowRightOutlined style={{ color: "rgba(0,0,0,0.45)", marginBottom: 10 }} />
            <div style={{ minWidth: 200, flex: "1 1 220px" }}>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                {diffLiveKind === "working" ? "Workspace (HEAD)" : "Compare (HEAD)"}
              </Typography.Text>
              <Typography.Text code style={{ fontSize: 14 }}>
                {diffHeadLabel}
              </Typography.Text>
            </div>
          </Flex>
          {compareRefError ? null : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              {hasLiveDiff
                ? `${diffLiveKind === "working" ? "Local changes" : "Compare"} · updated ${dayjs(liveDiff?.fetchedAt).format("HH:mm:ss")}`
                : hasStoredDiff
                  ? "Showing last captured diff from task state because no live workspace diff is available."
                  : liveDiff?.message ?? "Live diff will appear once the task workspace exists."}
            </Typography.Paragraph>
          )}
        </Card>
      ) : null}
      {diffLiveKind === "working" && (canPull || canPush) && task ? (
        <Card size="small" title="Git operations">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Pull updates from origin and push your local branch. Pushing stages all local changes, creates a commit when needed,
              and publishes the branch.
            </Typography.Paragraph>
            <Flex gap={8} wrap="wrap">
              {canPull ? (
                <Button onClick={handlePullTask} loading={submitting === "pull"}>
                  {`Pull (${pullCount})`}
                </Button>
              ) : null}
              {canPush ? (
                <Button type="primary" onClick={() => void confirmPushTask()} loading={submitting === "push"} disabled={pushPreviewLoading}>
                  {`Push (${pushCount})`}
                </Button>
              ) : null}
              {canPush ? (
                <Button onClick={() => void loadPushPreview()} loading={pushPreviewLoading} disabled={submitting === "push"}>
                  Refresh preview
                </Button>
              ) : null}
            </Flex>
            {pushPreviewError ? <Alert type="error" showIcon message="Push preview unavailable" description={pushPreviewError} /> : null}
            {canPush && pushPreview ? (
              <>
                <Typography.Text type="secondary">
                  Branch <Typography.Text code>{pushPreview.branchName}</Typography.Text>
                  {pushPreview.hasUncommittedChanges
                    ? " — uncommitted changes will be committed before push."
                    : pushPreview.unpushedCommitSubjects.length > 0
                      ? " — pushing existing local commits."
                      : " — nothing to push."}
                </Typography.Text>
                <Input.TextArea
                  rows={2}
                  value={pushCommitMessage}
                  onChange={(e) => setPushCommitMessage(e.target.value)}
                  placeholder="Commit message (used when creating a new commit)"
                  disabled={submitting === "push"}
                />
                {pushPreview.unpushedCommitSubjects.length > 0 ? (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Existing local commits: {pushPreview.unpushedCommitSubjects.slice(0, 3).join(" · ")}
                    {pushPreview.unpushedCommitSubjects.length > 3 ? ` (+${pushPreview.unpushedCommitSubjects.length - 3} more)` : ""}
                  </Typography.Paragraph>
                ) : null}
              </>
            ) : null}
          </Space>
        </Card>
      ) : null}
      {liveDiffError ? <Alert type="warning" showIcon message="Live diff refresh failed" description={liveDiffError} /> : null}
      {compareRefError && liveDiff ? (
        <Alert
          type="warning"
          showIcon
          message={liveDiff.message ?? "Invalid compare base."}
          description={
            liveDiff.defaultBaseRef
              ? `Try ${formatDiffRefDisplay(liveDiff.defaultBaseRef)} (repo default) or another branch that exists in this workspace.`
              : undefined
          }
        />
      ) : null}
      {task ? (
        <TaskDiffOpenAiPanel
          diffText={renderedDiff}
          emptyMessage={
            compareRefError
              ? "Choose another base branch or the repository default."
              : isReviewTask
                ? `No diff captured for ${task.baseBranch} against ${task.repoDefaultBranch}.`
                : hasLiveDiff
                  ? diffLiveKind === "working"
                    ? "No uncommitted changes vs HEAD (no staged/unstaged diff and no untracked files shown)."
                    : "No diff between the selected base and HEAD."
                  : "No diff captured yet. Run Build to generate one."
          }
          collapseFiles
          taskId={task.id}
          taskStatus={task.status}
          liveDiff={liveDiff}
          isArchived={isArchived}
          canEditTask={canEditTask}
          selectionResetToken={`${task.id}-${diffLiveKind}`}
          onLiveDiffRefresh={() => setLiveDiffRefreshKey((k) => k + 1)}
        />
      ) : null}
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
          <div
            style={{
              minWidth: 180,
              maxWidth: 260,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Typography.Text type="secondary">Preset</Typography.Text>
            <Select
              showSearch
              style={{ width: "100%", marginTop: 6 }}
              placeholder={presetsLoading ? "Loading presets..." : "Select preset"}
              value={selectedPresetId}
              onChange={(value) => handlePresetSelection(value)}
              optionFilterProp="label"
              loading={presetsLoading}
              disabled={presetsLoading || taskPresets.length === 0 || !canSpawnPresetFromTask || !canEditTask || isArchived}
              options={taskPresets.map((preset) => ({
                label: `${preset.name} · ${preset.repoName}`,
                value: preset.id
              }))}
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
            <Button
              onClick={handleClearComposer}
              disabled={
                !selectedPresetId &&
                !chatInput.trim() &&
                providerInput === currentTaskProvider &&
                providerProfileInput === currentTaskProviderProfile &&
                modelInput === (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider))
              }
            >
              Clear
            </Button>
          </Space.Compact>
        </Flex>
      </Flex>
      {isActive ? <Typography.Text type="secondary">Changes apply to the next run.</Typography.Text> : null}
    </Flex>
  );

  const chatPreparingNotice = isPreparingWorkspace ? (
    <Alert
      type="info"
      showIcon
      icon={<LoadingOutlined spin />}
      message="Preparing workspace"
      description="Cloning the repository and checking out your branch. Chat history and the composer will appear when the workspace is ready."
    />
  ) : null;

  const chatTimelineBlock = chatTimeline.length > 0 ? (
    <Flex vertical gap={12} style={{ width: "100%" }}>
      {chatTimeline.map((entry) => {
        if (entry.kind === "message") {
          const entryMessage = entry.message;
          if (entryMessage.role === "system") {
            return (
              <Flex key={entry.key}>
                <Card
                  size="small"
                  bodyStyle={{
                    background: "rgba(107,143,163,0.12)",
                    padding: "10px 12px"
                  }}
                  style={{ width: "100%" }}
                >
                  <Flex vertical gap={4}>
                    <Flex align="baseline" gap={8} wrap="wrap">
                      <Tag color="default" style={{ marginInlineEnd: 0 }}>
                        system
                      </Tag>
                      <Typography.Text type="secondary">{dayjs(entryMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>
                    </Flex>
                    <Typography.Text style={{ whiteSpace: "pre-wrap" }}>{entryMessage.content}</Typography.Text>
                  </Flex>
                </Card>
              </Flex>
            );
          }
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
                        task.status === "archived"
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
  ) : null;

  const chatHistoryEmptyState =
    !isPreparingWorkspace && chatTimeline.length === 0 ? (
      <Empty description={messagesLoading || runsLoading ? "Loading history..." : "No history yet."} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    ) : null;

  const mainTabItems = [
    {
      key: "chat",
      label: "History",
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {chatPreparingNotice}
          {chatTimelineBlock}
          {chatHistoryEmptyState}
          {!isPreparingWorkspace ? chatComposer : null}
        </Space>
      )
    },
    ...(hasDiffTab
      ? [
          {
            key: "diff",
            label: "Git",
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
      <Modal
        title="Rename task"
        open={renameModalOpen}
        onCancel={() => {
          if (submitting === "renameTitle") {
            return;
          }
          setRenameModalOpen(false);
        }}
        destroyOnClose
        onOk={() => void confirmRenameTask()}
        okText="Save"
        confirmLoading={submitting === "renameTitle"}
        okButtonProps={{ disabled: !renameTitleDraft.trim() }}
      >
        <Input
          value={renameTitleDraft}
          onChange={(e) => setRenameTitleDraft(e.target.value)}
          onPressEnter={() => void confirmRenameTask()}
          placeholder="Task title"
          maxLength={500}
          showCount
          disabled={submitting === "renameTitle"}
        />
      </Modal>
      <Flex vertical gap={16} style={{ width: "100%", paddingBottom: 16 }}>
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Space align="center" size={8} wrap>
              <Typography.Title level={2} style={{ margin: 0 }}>
                {task?.title ?? "Task Detail"}
              </Typography.Title>
              {canEditTask && !isArchived && task ? (
                <Tooltip title="Rename task">
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    aria-label="Rename task"
                    onClick={() => {
                      setRenameTitleDraft(task.title);
                      setRenameModalOpen(true);
                    }}
                  />
                </Tooltip>
              ) : null}
            </Space>
            {task ? (
              <Space wrap size={8} style={{ justifyContent: "flex-end" }}>
                {hasSyncButtons ? (
                  <Space wrap size={8}>
                    {canOpenInteractive ? (
                      <Tooltip
                        title={
                          interactiveTerminalStatus && !interactiveTerminalStatus.available
                            ? interactiveTerminalStatus.reason ?? "Unavailable"
                            : "Opens a new browser window with Codex in a shell; workspace is mounted at /workspace. Click again for another session."
                        }
                      >
                        <Button
                          type="default"
                          onClick={() => {
                            const path = `/tasks/${task.id}/interactive`;
                            const url = `${window.location.origin}${path}`;
                            const w = Math.min(1280, window.screen.availWidth - 48);
                            const h = Math.min(840, window.screen.availHeight - 48);
                            const features = [
                              "popup=yes",
                              `width=${w}`,
                              `height=${h}`,
                              "menubar=no",
                              "toolbar=no",
                              "location=yes",
                              "status=no",
                              "resizable=yes",
                              "scrollbars=yes"
                            ].join(",");
                            window.open(url, "_blank", `${features},noopener,noreferrer`);
                          }}
                          disabled={!interactiveTerminalStatus?.available}
                        >
                          Open terminal
                        </Button>
                      </Tooltip>
                    ) : null}

                  </Space>
                ) : null}

                {hasSyncButtons && (hasExecutionButtons || hasManagementButtons) ? (
                  <Divider type="vertical" style={{ marginInline: 2 }} />
                ) : null}

                {hasExecutionButtons ? (
                  <Space wrap size={8}>
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

                    {canRunReviewAction ? (
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
                  </Space>
                ) : null}

                {hasExecutionButtons && hasManagementButtons ? <Divider type="vertical" style={{ marginInline: 2 }} /> : null}

                {hasManagementButtons ? (
                  <Space wrap size={8}>
                    {githubDiffTarget ? (
                      <Button href={githubDiffTarget.href} target="_blank" rel="noreferrer">
                        {githubDiffTarget.label}
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
                            if (key === "merge") {
                              void handleMergeTask();
                              return;
                            }

                            if (key === "refreshDiff") {
                              setLiveDiffRefreshKey((k) => k + 1);
                              return;
                            }

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
                        <Button icon={<MoreOutlined />}>More</Button>
                      </Dropdown>
                    ) : null}
                  </Space>
                ) : null}
              </Space>
            ) : null}
          </Flex>
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
        </Flex>

        {loading ? (
          <Card loading bordered={false} />
        ) : task ? (
          <Flex vertical gap={16}>
            <Card bordered={false}>
              <Tabs activeKey={activeMainTab} onChange={(value) => setActiveMainTab(value as "chat" | "context" | "diff")} items={mainTabItems} />
            </Card>
          </Flex>
        ) : null}
      </Flex>

      <Modal
        open={spawnModalOpen && !!spawnPresetFromTask}
        title="Confirm Target Branch"
        onCancel={handleCloseSpawnModalFromTask}
        destroyOnClose
        footer={
          <Flex justify="flex-end" gap={12}>
            <Button onClick={handleCloseSpawnModalFromTask}>Cancel</Button>
            <Button
              type="primary"
              onClick={handleConfirmSpawnFromTask}
              loading={spawningId === spawnPresetFromTask?.id}
              disabled={spawnPresetFromTask?.sourceType !== "pull_request" && !spawnBaseBranch}
            >
              Create Task
            </Button>
          </Flex>
        }
      >
        {spawnPresetFromTask ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Paragraph>
              {spawnPresetFromTask.sourceType === "pull_request"
                ? "This preset will run on the pull request's branch. Confirm before starting."
                : "Select the branch this preset should work on. This will be used as the base branch for the new task."}
            </Typography.Paragraph>
            {spawnPresetFromTask.sourceType !== "pull_request" ? (
              <Form layout="vertical">
                <Form.Item label="Target Branch" required>
                  <Select
                    showSearch
                    allowClear
                    placeholder="Select target branch"
                    loading={spawnBranchesLoading}
                    value={spawnBaseBranch}
                    onChange={(value) => setSpawnBaseBranch(value ?? undefined)}
                    optionFilterProp="label"
                    options={spawnBranches.map((branch) => ({
                      label: branch.isDefault ? `${branch.name} (default)` : branch.name,
                      value: branch.name
                    }))}
                  />
                </Form.Item>
              </Form>
            ) : null}
          </Space>
        ) : null}
      </Modal>

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
            onFinish={async (values: { title: string; prompt: string; taskType: "build" }) => {
              const followUpAction = followUpMode === "fix" ? "fix" : "continue";
              setSubmitting(followUpAction);
              try {
                const normalizedPrompt = values.prompt.trim();
                const nextTask = await api.createTask({
                  title: values.title.trim(),
                  prompt:
                    followUpMode === "fix"
                      ? [
                          `Implement the changes requested by the review on branch ${task.baseBranch}.`,
                          "",
                          `Original review prompt:`,
                          task.prompt,
                          "",
                          `Review result:`,
                          task.resultMarkdown ?? "(no review markdown captured)",
                          "",
                          `Additional implementation instructions:`,
                          normalizedPrompt || "- None provided."
                        ].join("\n")
                      : normalizedPrompt,
                  taskType: "build",
                  repoId: task.repoId,
                  baseBranch: followUpBranch,
                  branchStrategy: "work_on_branch",
                  provider: task.provider,
                  providerProfile: task.providerProfile,
                  modelOverride: task.modelOverride ?? undefined
                });
                followUpForm.resetFields();
                setFollowUpMode(null);
                messageApi.success("Follow-up build task created and started on branch");
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
                name="prompt"
                label={followUpMode === "fix" ? "Additional Instructions" : "Prompt"}
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
