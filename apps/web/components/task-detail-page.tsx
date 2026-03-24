"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  getAgentProviderLabel,
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  getProviderProfileLabel,
  getCheckpointMutationBlockedReason,
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
  type TaskPushPreview,
  type TaskChangeProposal,
  type TaskWorkspaceCommit
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
  List,
  Modal,
  Segmented,
  Spin,
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
import { useTaskChangeProposals } from "../src/hooks/useTaskChangeProposals";
import { normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";
import { estimateCost, formatCost } from "../src/utils/pricing";
import { buildTaskHistoryEntries } from "../src/utils/task-history";
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

function checkpointStatusLabel(status: TaskChangeProposal["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "applied":
      return "Applied";
    case "rejected":
      return "Rejected";
    case "reverted":
      return "Reverted";
    default:
      return status;
  }
}

function checkpointStatusColor(status: TaskChangeProposal["status"]): string {
  switch (status) {
    case "pending":
      return "orange";
    case "applied":
      return "green";
    case "reverted":
      return "blue";
    case "rejected":
      return "red";
    default:
      return "default";
  }
}

function changeProposalSourceLabel(sourceType: TaskChangeProposal["sourceType"]): string {
  return sourceType === "build_run" ? "Build run" : "Terminal session";
}

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
  const hadLoadedTaskRef = useRef(false);
  const { messages: taskMessages, loading: messagesLoading } = useTaskMessages(taskId);
  const { runs: taskRuns, loading: runsLoading } = useTaskRuns(taskId);
  const { proposals: changeProposals, refetch: refetchChangeProposals } = useTaskChangeProposals(taskId);
  const { presets, loading: presetsLoading } = usePresets();
  const taskTokenTotals = useMemo(() => {
    return getTaskTokenTotals(taskRuns);
  }, [taskRuns]);
  const [liveDiff, setLiveDiff] = useState<TaskLiveDiff | null>(null);
  const [liveDiffLoading, setLiveDiffLoading] = useState(false);
  const [liveDiffError, setLiveDiffError] = useState<string | null>(null);
  const [liveDiffRefreshKey, setLiveDiffRefreshKey] = useState(0);
  const [diffLiveKind, setDiffLiveKind] = useState<"compare" | "commits">("commits");
  const [diffCompareBaseRef, setDiffCompareBaseRef] = useState<string | null>(null);
  const [commitLog, setCommitLog] = useState<TaskWorkspaceCommit[]>([]);
  const [commitLogLoading, setCommitLogLoading] = useState(false);
  const [commitLogError, setCommitLogError] = useState<string | null>(null);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
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
  const [proposalBusy, setProposalBusy] = useState<{ id: string; kind: "apply" | "reject" | "revert" } | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedChatActionRef = useRef(false);
  const diffCompareBaseSyncedTaskIdRef = useRef<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [pushPreview, setPushPreview] = useState<TaskPushPreview | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
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
  const [redirectingToTaskList, setRedirectingToTaskList] = useState(false);

  useEffect(() => {
    if (task) {
      hadLoadedTaskRef.current = true;
      if (redirectingToTaskList) {
        setRedirectingToTaskList(false);
      }
    }
  }, [task, redirectingToTaskList]);

  useEffect(() => {
    if (!loading && !task && hadLoadedTaskRef.current) {
      setRedirectingToTaskList(true);
      router.replace("/tasks");
    }
  }, [loading, task, router]);

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
  const checkpointDiffActionsBlockedReason = task ? getCheckpointMutationBlockedReason(task.status) : null;
  const checkpointDiffActionsBlocked = checkpointDiffActionsBlockedReason !== null;
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
  const renderedDiff =
    diffLiveKind === "compare" && compareRefError
      ? ""
      : diffLiveKind === "commits"
        ? liveDiff?.diff ?? ""
        : hasLiveDiff
          ? liveDiff?.diff ?? ""
          : task?.branchDiff ?? "";
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
    const loadInteractiveTerminalStatus = () => {
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
    };

    loadInteractiveTerminalStatus();
    const intervalId = window.setInterval(loadInteractiveTerminalStatus, 4000);
    const onFocus = () => {
      loadInteractiveTerminalStatus();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
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
    setSelectedCommitSha(null);
    setCommitLog([]);
    setCommitLogError(null);
  }, [task?.id]);

  useEffect(() => {
    setLiveDiff(null);
  }, [diffLiveKind]);

  useEffect(() => {
    if (activeMainTab !== "diff" || !task || !canRequestLiveDiff || diffLiveKind !== "commits") {
      return;
    }

    let cancelled = false;
    const loadCommitLog = async () => {
      setCommitLogLoading(true);
      setCommitLogError(null);
      try {
        const res = await api.getTaskWorkspaceCommitLog(task.id);
        if (!cancelled) {
          setCommitLog(res.commits);
          setCommitLogError(res.message);
        }
      } catch (error) {
        if (!cancelled) {
          setCommitLog([]);
          setCommitLogError(error instanceof Error ? error.message : "Failed to load commits");
        }
      } finally {
        if (!cancelled) {
          setCommitLogLoading(false);
        }
      }
    };

    void loadCommitLog();
    return () => {
      cancelled = true;
    };
  }, [activeMainTab, canRequestLiveDiff, diffLiveKind, liveDiffRefreshKey, task?.id, task?.updatedAt]);

  useEffect(() => {
    if (diffLiveKind !== "commits" || commitLog.length === 0) {
      return;
    }
    if (!selectedCommitSha || !commitLog.some((c) => c.sha === selectedCommitSha)) {
      setSelectedCommitSha(commitLog[0].sha);
    }
  }, [commitLog, diffLiveKind, selectedCommitSha]);

  useEffect(() => {
    if (activeMainTab !== "diff" || !task || !canRequestLiveDiff) {
      return;
    }

    if (diffLiveKind === "commits") {
      if (!selectedCommitSha) {
        setLiveDiff(null);
        setLiveDiffLoading(false);
        setLiveDiffError(null);
        return;
      }

      let cancelled = false;
      const loadCommitDiff = async () => {
        setLiveDiffLoading(true);
        setLiveDiffError(null);
        try {
          const snapshot = await api.getTaskLiveDiff(task.id, {
            diffKind: "commits",
            commitSha: selectedCommitSha
          });
          if (!cancelled) {
            setLiveDiff(snapshot);
            if (!snapshot.live && snapshot.message) {
              setLiveDiffError(snapshot.message);
            } else {
              setLiveDiffError(null);
            }
          }
        } catch (error) {
          if (!cancelled) {
            setLiveDiffError(error instanceof Error ? error.message : "Failed to load commit diff");
            setLiveDiff(null);
          }
        } finally {
          if (!cancelled) {
            setLiveDiffLoading(false);
          }
        }
      };

      void loadCommitDiff();
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    const loadLiveDiff = async () => {
      setLiveDiffLoading(true);
      try {
        const snapshot = await api.getTaskLiveDiff(task.id, {
          baseRef: diffCompareBaseRef ?? task.repoDefaultBranch ?? undefined,
          diffKind: "compare"
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
    selectedCommitSha,
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

  if (redirectingToTaskList) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 240 }}>
        <Spin size="large" tip="Returning to tasks..." />
      </Flex>
    );
  }

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
  const pendingChangeProposal = useMemo(
    () => changeProposals.find((p) => p.status === "pending") ?? null,
    [changeProposals]
  );
  const latestAppliedChangeProposalId = useMemo(() => {
    const applied = changeProposals.filter((p) => p.status === "applied");
    if (applied.length === 0) {
      return null;
    }
    const rank = (p: (typeof applied)[number]) => `${p.resolvedAt ?? p.createdAt}\0${p.id}`;
    let best = applied[0]!;
    for (let i = 1; i < applied.length; i++) {
      const p = applied[i]!;
      if (rank(p) > rank(best)) {
        best = p;
      }
    }
    return best.id;
  }, [changeProposals]);
  const interactiveTerminalRunning = interactiveTerminalStatus?.activeInteractiveSession === true;
  const chatClosed = !task || hasReadOnlyTaskAccess || task.status === "accepted" || task.status === "archived";
  const chatDisabled =
    chatClosed ||
    interactiveTerminalRunning ||
    (selectedChatAction !== "comment" && (isQueued || isActive || !!pendingChangeProposal));
  const chatPlaceholder = (() => {
    if (interactiveTerminalRunning) {
      return "An interactive terminal session is already running for this task. Close or end it before sending from here.";
    }
    if (!chatDisabled) {
      if (selectedChatAction === "comment") {
        return "Add a comment to the task history";
      }
      if (selectedChatAction === "ask") {
        return "Ask a repository question or refine the last answer";
      }
      if (selectedChatAction === "review") {
        return "Add review instructions for the next pass";
      }
      if (selectedChatAction === "build") {
        return "Describe the next implementation change for this branch";
      }
      return hasExecutionContext
        ? "Describe how the current plan should change before the next run"
        : "Add instructions for the first planning pass";
    }
    if (hasReadOnlyTaskAccess) {
      return "You have read-only access to this task.";
    }
    if (chatClosed) {
      return task?.status === "archived"
        ? "This task is archived and read-only."
        : "This task is closed. Create a follow-up task to continue.";
    }
    if (pendingChangeProposal && selectedChatAction !== "comment") {
      return "Apply or reject the pending checkpoint before sending build or ask instructions.";
    }
    return "Wait for the current run to finish before sending another instruction.";
  })();
  const chatTimeline = useMemo(
    () =>
      buildTaskHistoryEntries({
        messages: taskMessages,
        runs: taskRuns,
        proposals: changeProposals,
        interactiveTerminalRunning
      }),
    [changeProposals, interactiveTerminalRunning, taskMessages, taskRuns]
  );
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
      setRedirectingToTaskList(true);
      messageApi.success("Task deleted");
      router.replace("/tasks");
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
    setPushPreviewLoading(true);
    try {
      const preview = await api.getTaskPushPreview(task.id);
      setPushPreview(preview);
      setPushCommitMessage((current) => (current.trim().length > 0 ? current : preview.suggestedCommitMessage));
    } catch (error) {
      setPushPreview(null);
      messageApi.error(error instanceof Error ? error.message : "Could not load push preview");
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
      setLiveDiffRefreshKey((k) => k + 1);
      void loadPushPreview();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to pull changes");
    } finally {
      setSubmitting(null);
    }
  };
  useEffect(() => {
    if (!task || !canPush) {
      return;
    }
    void loadPushPreview();
  }, [canPush, task?.id, task?.updatedAt]);

  const moreActionItems = task && !isArchived
    ? [
        canMerge ? { key: "merge", label: `Merge to ${task?.repoDefaultBranch ?? "default branch"}` } : null,
        canRequestLiveDiff ? { key: "refreshDiff", label: "Refresh Diff" } : null,
        canEditTask ? { key: "pin", label: task.pinned ? "Unpin Task" : "Pin Task" } : null,
        canContinueOnBranch ? { key: "continue", label: "Continue On Branch" } : null,
        canCreateFixTask ? { key: "fix", label: "Create Fix Task" } : null,
        canArchive ? { key: "archive", label: "Archive Task", danger: true } : null,
        canDelete ? { key: "delete", label: "Delete Task", danger: true } : null
      ].filter(Boolean)
    : [];
  const hasMoreActions = moreActionItems.length > 0;
  const canOpenInteractive = canEditTask && !isArchived && !!task;
  const canRunReviewActionEligible =
    !canCancel && !hasCompletedNonImplementationResult && canEditTask && isReviewTask && task?.status !== "accepted" && task?.status !== "archived";
  const hasSyncButtons = canOpenInteractive;
  const hasExecutionButtons = canCancel || canRunReviewActionEligible;
  const hasManagementButtons = Boolean(githubDiffTarget) || hasMoreActions || canPull || canPush;
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

  const pushNothingToPush =
    Boolean(
      pushPreview &&
        !pushPreview.hasUncommittedChanges &&
        pushPreview.unpushedCommitSubjects.length === 0
    );
  const pushPrimaryDisabled = submitting === "push" || pushPreviewLoading || pushNothingToPush;

  const diffContent = hasDiffTab ? (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {task ? (
        <Card size="small" styles={{ body: { paddingBottom: 12 } }}>
          <Segmented
            value={diffLiveKind}
            onChange={(value) => setDiffLiveKind(value as "compare" | "commits")}
            options={[
              { label: "Branch commits", value: "commits" },
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
                disabled={!canRequestLiveDiff || diffLiveKind === "commits"}
                style={{ width: "100%" }}
                onChange={(value) => {
                  setDiffCompareBaseRef(typeof value === "string" && value.length > 0 ? value : task.repoDefaultBranch ?? null);
                }}
              />
              {diffLiveKind === "commits" ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                  Recent commits on the current workspace branch. Choose one to view its patch. The base branch is only used in
                  Compare to branch mode.
                </Typography.Paragraph>
              ) : null}
            </div>
            <ArrowRightOutlined style={{ color: "rgba(0,0,0,0.45)", marginBottom: 10 }} />
            <div style={{ minWidth: 200, flex: "1 1 220px" }}>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                {diffLiveKind === "commits" ? "Workspace (HEAD)" : "Compare (HEAD)"}
              </Typography.Text>
              <Typography.Text code style={{ fontSize: 14 }}>
                {diffHeadLabel}
              </Typography.Text>
            </div>
          </Flex>
          {compareRefError ? null : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              {diffLiveKind === "commits" ? (
                commitLogLoading ? (
                  "Loading commit list…"
                ) : commitLogError ? (
                  commitLogError
                ) : hasLiveDiff && liveDiff ? (
                  `Selected commit · diff updated ${dayjs(liveDiff.fetchedAt).format("HH:mm:ss")}`
                ) : selectedCommitSha && liveDiffLoading ? (
                  "Loading commit diff…"
                ) : !commitLog.length && !commitLogLoading ? (
                  "No commits on this branch in the workspace yet."
                ) : (
                  liveDiff?.message ?? "Select a commit to view its changes."
                )
              ) : hasLiveDiff ? (
                `Compare · updated ${dayjs(liveDiff?.fetchedAt).format("HH:mm:ss")}`
              ) : hasStoredDiff ? (
                "Showing last captured diff from task state because no live workspace diff is available."
              ) : (
                liveDiff?.message ?? "Live diff will appear once the task workspace exists."
              )}
            </Typography.Paragraph>
          )}
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
        <Flex gap={16} align="flex-start" style={{ width: "100%" }} wrap="wrap">
          {diffLiveKind === "commits" ? (
            <Card
              size="small"
              title="Commits"
              extra={
                <Button type="link" size="small" onClick={() => setLiveDiffRefreshKey((k) => k + 1)} style={{ padding: 0 }}>
                  Refresh
                </Button>
              }
              style={{ width: "100%", maxWidth: 360, flex: "0 1 320px" }}
              styles={{ body: { padding: 0, maxHeight: 480, overflow: "auto" } }}
            >
              {commitLogLoading ? (
                <div style={{ padding: 24, textAlign: "center" }}>
                  <Spin size="small" />
                </div>
              ) : (
                <List
                  size="small"
                  dataSource={commitLog}
                  locale={{ emptyText: "No commits yet." }}
                  renderItem={(c) => (
                    <List.Item
                      style={{
                        cursor: "pointer",
                        background: selectedCommitSha === c.sha ? "rgba(0,0,0,0.06)" : undefined,
                        padding: "10px 12px"
                      }}
                      onClick={() => setSelectedCommitSha(c.sha)}
                    >
                      <List.Item.Meta
                        title={
                          <Typography.Text code style={{ fontSize: 12 }}>
                            {c.shortSha}
                          </Typography.Text>
                        }
                        description={
                          <div>
                            <Typography.Paragraph style={{ marginBottom: 4, fontSize: 13 }} ellipsis={{ rows: 2 }}>
                              {c.subject}
                            </Typography.Paragraph>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              {dayjs(c.committedAt).format("MMM D, YYYY HH:mm")} · {c.authorName}
                            </Typography.Text>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          ) : null}
          <div style={{ flex: "1 1 400px", minWidth: 0 }}>
            <TaskDiffOpenAiPanel
              diffAssistBlocked={!!pendingChangeProposal}
              diffText={renderedDiff}
              emptyMessage={
                compareRefError
                  ? "Choose another base branch or the repository default."
                  : diffLiveKind === "commits"
                    ? commitLogLoading
                      ? "Loading commits…"
                      : !commitLog.length
                        ? "No commits on this branch yet."
                        : liveDiffLoading && selectedCommitSha
                          ? "Loading commit diff…"
                          : hasLiveDiff
                            ? "This commit has no file changes in its patch."
                            : liveDiff?.message ?? "Could not load this commit’s diff."
                    : isReviewTask
                      ? `No diff captured for ${task.baseBranch} against ${task.repoDefaultBranch}.`
                      : hasLiveDiff
                        ? "No diff between the selected base and HEAD."
                        : "No diff captured yet. Run Build to generate one."
              }
              collapseFiles
              taskId={task.id}
              taskStatus={task.status}
              liveDiff={liveDiff}
              isArchived={isArchived}
              canEditTask={canEditTask}
              selectionResetToken={`${task.id}-${diffLiveKind}-${selectedCommitSha ?? ""}`}
              onLiveDiffRefresh={() => setLiveDiffRefreshKey((k) => k + 1)}
            />
          </div>
        </Flex>
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
              disabled={!canEditTask || isArchived || interactiveTerminalRunning}
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
              disabled={!canEditTask || isArchived || interactiveTerminalRunning}
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
              disabled={!canEditTask || isArchived || interactiveTerminalRunning}
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
              disabled={
                presetsLoading ||
                taskPresets.length === 0 ||
                !canSpawnPresetFromTask ||
                !canEditTask ||
                isArchived ||
                interactiveTerminalRunning
              }
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
              disabled={chatClosed || interactiveTerminalRunning}
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
                interactiveTerminalRunning ||
                (!selectedPresetId &&
                  !chatInput.trim() &&
                  providerInput === currentTaskProvider &&
                  providerProfileInput === currentTaskProviderProfile &&
                  modelInput === (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider)))
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

  const syncTaskAfterCheckpointMutation = (updatedTask: Task) => {
    setTask((current) =>
      current
        ? {
            ...updatedTask,
            logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
          }
        : updatedTask
    );
  };

  const handleApplyCheckpoint = async (proposal: TaskChangeProposal, canReapplyReverted: boolean) => {
    if (!task) {
      return;
    }

    setProposalBusy({ id: proposal.id, kind: "apply" });
    try {
      const updated = await api.applyTaskChangeProposal(task.id, proposal.id);
      syncTaskAfterCheckpointMutation(updated);
      messageApi.success(canReapplyReverted ? "Checkpoint re-applied" : "Checkpoint applied");
      setLiveDiffRefreshKey((k) => k + 1);
      refetchChangeProposals();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Could not apply checkpoint");
    } finally {
      setProposalBusy(null);
    }
  };

  const handleRejectCheckpoint = (proposal: TaskChangeProposal) => {
    if (!task) {
      return;
    }

    Modal.confirm({
      title: "Reject this checkpoint?",
      content:
        "Tracked files are reset to the checkpoint commit (git reset --hard). New untracked files added since that checkpoint are removed; untracked files you already had are kept.",
      okText: "Reject and reset",
      okButtonProps: { danger: true },
      onOk: async () => {
        setProposalBusy({ id: proposal.id, kind: "reject" });
        try {
          const updated = await api.rejectTaskChangeProposal(task.id, proposal.id);
          syncTaskAfterCheckpointMutation(updated);
          messageApi.success("Checkpoint rejected; workspace reset.");
          setLiveDiffRefreshKey((k) => k + 1);
          refetchChangeProposals();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "Could not reject checkpoint");
        } finally {
          setProposalBusy(null);
        }
      }
    });
  };

  const handleRevertCheckpoint = (proposal: TaskChangeProposal) => {
    if (!task) {
      return;
    }

    Modal.confirm({
      title: "Revert this applied checkpoint?",
      content:
        "Undoes the checkpoint (patch reverse or restore from base), then stages and creates a local commit so the branch stays clean with no unstaged revert changes. If that no longer applies because you committed or edited files, paths are restored from the checkpoint base instead. Revert newer checkpoints first.",
      okText: "Revert",
      okButtonProps: { danger: true },
      onOk: async () => {
        setProposalBusy({ id: proposal.id, kind: "revert" });
        try {
          const updated = await api.revertTaskChangeProposal(task.id, proposal.id);
          syncTaskAfterCheckpointMutation(updated);
          messageApi.success("Checkpoint reverted");
          setLiveDiffRefreshKey((k) => k + 1);
          refetchChangeProposals();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "Could not revert checkpoint");
        } finally {
          setProposalBusy(null);
        }
      }
    });
  };

  const getNormalizedRunSummary = (run: TaskRun): string | null =>
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

  const renderRunLogsPanel = (run: TaskRun) => (
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
  );

  const renderRunLogsCollapse = (run: TaskRun) => (
    <Collapse
      size="small"
      activeKey={expandedRunKeys.includes(run.id) ? [run.id] : []}
      onChange={(keys) =>
        setExpandedRunKeys((current) => {
          const isOpen = Array.isArray(keys) ? keys.length > 0 : Boolean(keys);
          return isOpen ? (current.includes(run.id) ? current : [...current, run.id]) : current.filter((key) => key !== run.id);
        })
      }
      items={[
        {
          key: run.id,
          label: `Logs${run.logs.length > 0 ? ` (${run.logs.length})` : ""}`,
          children: renderRunLogsPanel(run)
        }
      ]}
    />
  );

  const renderRunErrorNotice = (run: TaskRun) =>
    run.errorMessage ? (
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
    ) : null;

  const renderCheckpointDiffSection = (proposal: TaskChangeProposal, keyPrefix: string) => {
    const canRevertApplied = proposal.status === "applied" && !proposal.diffTruncated;
    const canRevertThisCheckpointNow = canRevertApplied && proposal.id === latestAppliedChangeProposalId;
    const diffTrimmed = proposal.diff.trim();
    const canReapplyReverted =
      proposal.status === "reverted" &&
      !proposal.diffTruncated &&
      diffTrimmed.length > 0 &&
      diffTrimmed !== "(no changes)";
    const showCheckpointApply = (proposal.status === "pending" || canReapplyReverted) && canEditTask && task && !isArchived;
    const blockOlderCheckpointWhilePending = !!pendingChangeProposal && proposal.id !== pendingChangeProposal.id;
    const olderCheckpointPendingTooltip = "Apply or reject the current pending checkpoint first.";

    return (
      <Collapse
        size="small"
        defaultActiveKey={[]}
        items={[
          {
            key: `${keyPrefix}-diff`,
            label: `Diff${proposal.changedFiles.length > 0 ? ` (${proposal.changedFiles.length})` : ""}`,
            collapsible: blockOlderCheckpointWhilePending ? "disabled" : undefined,
            extra:
              canEditTask && task && !isArchived && (showCheckpointApply || canRevertApplied) ? (
                <span onClick={(event) => event.stopPropagation()}>
                  <Space size={4} wrap>
                    {showCheckpointApply ? (
                      <>
                        <Tooltip
                          title={
                            blockOlderCheckpointWhilePending
                              ? olderCheckpointPendingTooltip
                              : checkpointDiffActionsBlocked
                                ? checkpointDiffActionsBlockedReason
                                : undefined
                          }
                        >
                          <span>
                            <Button
                              type="primary"
                              size="small"
                              disabled={checkpointDiffActionsBlocked || blockOlderCheckpointWhilePending}
                              loading={proposalBusy?.id === proposal.id && proposalBusy.kind === "apply"}
                              onClick={() => void handleApplyCheckpoint(proposal, canReapplyReverted)}
                            >
                              {canReapplyReverted ? "Apply again" : "Apply"}
                            </Button>
                          </span>
                        </Tooltip>
                        {proposal.status === "pending" ? (
                          <Tooltip
                            title={
                              blockOlderCheckpointWhilePending
                                ? olderCheckpointPendingTooltip
                                : checkpointDiffActionsBlocked
                                  ? checkpointDiffActionsBlockedReason
                                  : undefined
                            }
                          >
                            <span>
                              <Button
                                danger
                                size="small"
                                disabled={checkpointDiffActionsBlocked || blockOlderCheckpointWhilePending}
                                loading={proposalBusy?.id === proposal.id && proposalBusy.kind === "reject"}
                                onClick={() => handleRejectCheckpoint(proposal)}
                              >
                                Reject
                              </Button>
                            </span>
                          </Tooltip>
                        ) : null}
                      </>
                    ) : null}
                    {canRevertApplied ? (
                      <Tooltip
                        title={
                          blockOlderCheckpointWhilePending
                            ? olderCheckpointPendingTooltip
                            : checkpointDiffActionsBlocked
                              ? checkpointDiffActionsBlockedReason ?? undefined
                              : canRevertThisCheckpointNow
                                ? undefined
                                : "A newer applied checkpoint must be reverted first. Undo in reverse apply order."
                        }
                      >
                        <span>
                          <Button
                            size="small"
                            disabled={checkpointDiffActionsBlocked || !canRevertThisCheckpointNow || blockOlderCheckpointWhilePending}
                            loading={proposalBusy?.id === proposal.id && proposalBusy.kind === "revert"}
                            onClick={() => {
                              if (checkpointDiffActionsBlocked || !canRevertThisCheckpointNow || blockOlderCheckpointWhilePending) {
                                return;
                              }
                              handleRevertCheckpoint(proposal);
                            }}
                          >
                            Revert
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}
                  </Space>
                </span>
              ) : null,
            children: renderParsedDiff(proposal.diff, "No diff text.", { collapseFiles: true })
          }
        ]}
      />
    );
  };

  const renderRawMessageEntry = (entryKey: string, entryMessage: TaskMessage) => {
    if (entryMessage.role === "system") {
      return (
        <Flex key={entryKey}>
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
      <Flex key={entryKey}>
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
                {entryMessage.action ? <Tag style={{ marginInlineEnd: 0 }}>{taskActionLabel[entryMessage.action]}</Tag> : null}
                <Typography.Text type="secondary">{dayjs(entryMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>
              </Flex>
              <div>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {entryMessage.content}
                </ReactMarkdown>
              </div>
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
  };

  const renderRawProposalEntry = (entryKey: string, proposal: TaskChangeProposal) => {
    return (
      <Flex key={entryKey}>
        <Card size="small" style={{ width: "100%", borderColor: proposal.status === "pending" ? "rgba(250,173,20,0.45)" : undefined }}>
          <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap" style={{ marginBottom: 8 }}>
            <Space wrap size={8}>
              <Typography.Text strong>Checkpoint</Typography.Text>
              <Tag>{changeProposalSourceLabel(proposal.sourceType)}</Tag>
              <Tag color={checkpointStatusColor(proposal.status)}>{checkpointStatusLabel(proposal.status)}</Tag>
              {proposal.diffTruncated ? <Tag>Truncated preview</Tag> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(proposal.createdAt).format("YYYY-MM-DD HH:mm:ss")}
            </Typography.Text>
          </Flex>
          {renderCheckpointDiffSection(proposal, entryKey)}
        </Card>
      </Flex>
    );
  };

  const renderRawRunEntry = (entryKey: string, run: TaskRun) => {
    const normalizedRunSummary = getNormalizedRunSummary(run);
    const isCollapsibleSummaryRun = run.action === "plan" || run.action === "iterate" || run.action === "build";
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
                    !!pendingChangeProposal ||
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
      <Flex key={entryKey}>
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
          {renderRunErrorNotice(run)}
          {renderRunLogsCollapse(run)}
        </Card>
      </Flex>
    );
  };

  const renderGroupedAutoRunEntry = (entryKey: string, entry: Extract<(typeof chatTimeline)[number], { kind: "grouped_auto_run" }>) => {
    const normalizedRunSummary = getNormalizedRunSummary(entry.run);
    const summaryTitle = entry.run.action === "build" ? "Implementation Summary" : "Summary";
    const promptText = entry.promptMessage?.content ?? "No matched user prompt was found for this run.";
    const tokenLine = (() => {
      const tokenStr = formatTokenUsage(entry.run.tokenUsage);
      if (entry.run.tokenUsage?.status !== "available" || !entry.run.tokenUsage.inputTokens || !entry.run.tokenUsage.outputTokens) {
        return `Tokens: ${tokenStr}`;
      }
      const cost = estimateCost(getRunModel(entry.run), entry.run.tokenUsage.inputTokens, entry.run.tokenUsage.outputTokens);
      return `Tokens: ${tokenStr}${cost ? ` · est. ${formatCost(cost.totalCost)}` : ""}`;
    })();

    return (
      <Card
        key={entryKey}
        size="small"
        title={
          <Space wrap>
            <Tag color={runStatusColor[entry.run.status]}>{entry.run.status}</Tag>
            <Tag>{taskActionLabel[entry.run.action]}</Tag>
            <Tag>{getAgentProviderLabel(entry.run.provider)}</Tag>
            {entry.proposal ? <Tag color={checkpointStatusColor(entry.proposal.status)}>{checkpointStatusLabel(entry.proposal.status)}</Tag> : null}
            {entry.proposal?.diffTruncated ? <Tag>Truncated preview</Tag> : null}
          </Space>
        }
        extra={
          <Typography.Text type="secondary">
            {dayjs(entry.run.startedAt).format("YYYY-MM-DD HH:mm:ss")} · {formatRunDuration(entry.run.startedAt, entry.run.finishedAt)}
          </Typography.Text>
        }
      >
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">{tokenLine}</Typography.Text>
          <div>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {promptText}
            </ReactMarkdown>
          </div>
          <Collapse
            size="small"
            items={[
              {
                key: `${entryKey}-summary`,
                label: summaryTitle,
                children: normalizedRunSummary ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {normalizedRunSummary}
                  </ReactMarkdown>
                ) : (
                  <Typography.Text type="secondary">
                    {entry.run.status === "running"
                      ? "Summary will appear when the run finishes."
                      : "No summary was captured for this run."}
                  </Typography.Text>
                )
              }
            ]}
          />
          {renderRunErrorNotice(entry.run)}
          {renderRunLogsCollapse(entry.run)}
          {entry.proposal ? renderCheckpointDiffSection(entry.proposal, entryKey) : null}
        </Flex>
      </Card>
    );
  };

  const renderGroupedTerminalEntry = (
    entryKey: string,
    entry: Extract<(typeof chatTimeline)[number], { kind: "grouped_terminal_session" }>
  ) => {
    const terminalStatusTag = entry.active
      ? { color: "processing", label: "Active" }
      : entry.proposal
        ? { color: checkpointStatusColor(entry.proposal.status), label: checkpointStatusLabel(entry.proposal.status) }
        : null;
    return (
      <Card
        key={entryKey}
        size="small"
        title={
          <Space wrap>
            <Tag color="green">Terminal</Tag>
            {terminalStatusTag ? <Tag color={terminalStatusTag.color}>{terminalStatusTag.label}</Tag> : null}
            {entry.proposal?.diffTruncated ? <Tag>Truncated preview</Tag> : null}
          </Space>
        }
        extra={<Typography.Text type="secondary">{dayjs(entry.startMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>}
      >
        <Flex vertical gap="small">
          <Typography.Text type="secondary">
            {`${dayjs(entry.startMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")} - ${entry.startMessage.content}`}
          </Typography.Text>
          <Typography.Text type="secondary">
            {entry.endMessage
              ? `${dayjs(entry.endMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")} - ${entry.endMessage.content}`
              : "Running - Interactive terminal session is still running."}
          </Typography.Text>
          {entry.proposal ? renderCheckpointDiffSection(entry.proposal, entryKey) : null}
        </Flex>
      </Card>
    );
  };

  const chatTimelineBlock = chatTimeline.length > 0 ? (
    <Flex vertical gap={12} style={{ width: "100%" }}>
      {chatTimeline.map((entry) => {
        if (entry.kind === "message") {
          return renderRawMessageEntry(entry.key, entry.message);
        }

        if (entry.kind === "proposal") {
          return renderRawProposalEntry(entry.key, entry.proposal);
        }

        if (entry.kind === "grouped_auto_run") {
          return renderGroupedAutoRunEntry(entry.key, entry);
        }

        if (entry.kind === "grouped_terminal_session") {
          return renderGroupedTerminalEntry(entry.key, entry);
        }

        return renderRawRunEntry(entry.key, entry.run);
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
          {interactiveTerminalRunning && canEditTask && task && !isArchived ? (
            <Alert
              type="info"
              showIcon
              message="Interactive terminal is running"
              description="This task already has an active terminal session (another window or tab). Close or end that session before sending instructions here or opening another terminal."
            />
          ) : null}
          {pendingChangeProposal && canEditTask && task && !isArchived ? (
            <Alert
              type="warning"
              showIcon
              message="Pending checkpoint"
              description="Apply or reject the workspace changes from this run before starting a new build, opening a terminal, or using Git push/pull. Use the Git tab to commit and push after you apply."
            />
          ) : null}
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
                          pendingChangeProposal
                            ? "Apply or reject the pending checkpoint before opening a terminal."
                            : interactiveTerminalStatus && !interactiveTerminalStatus.available
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
                          disabled={!interactiveTerminalStatus?.available || !!pendingChangeProposal}
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

                    {canRunReviewActionEligible ? (
                      <Tooltip
                        title={
                          pendingChangeProposal
                            ? "Apply or reject the pending checkpoint before running review."
                            : undefined
                        }
                      >
                        <span style={{ display: "inline-block" }}>
                          <Button
                            type="primary"
                            disabled={!!pendingChangeProposal}
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
                        </span>
                      </Tooltip>
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
                    {canPull ? (
                      <Tooltip
                        title={
                          pendingChangeProposal
                            ? "Apply or reject the pending checkpoint before pulling."
                            : undefined
                        }
                      >
                        <span style={{ display: "inline-block" }}>
                          <Button
                            onClick={handlePullTask}
                            loading={submitting === "pull"}
                            disabled={!!pendingChangeProposal || submitting === "push"}
                          >
                            {`Pull (${pullCount})`}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}
                    {canPush ? (
                      <Tooltip
                        title={
                          pendingChangeProposal
                            ? "Apply or reject the pending checkpoint before pushing."
                            : pushNothingToPush
                              ? "Nothing to push — commit local changes or wait for the status refresh."
                              : undefined
                        }
                      >
                        <span style={{ display: "inline-block" }}>
                          <Button
                            type="primary"
                            onClick={() => void confirmPushTask()}
                            loading={submitting === "push"}
                            disabled={!!pendingChangeProposal || pushPrimaryDisabled}
                          >
                            {`Push (${pushCount})`}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}

                    {hasMoreActions && (Boolean(githubDiffTarget) || canPull || canPush) ? (
                      <Divider type="vertical" style={{ marginInline: 2 }} />
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

                            if (key === "archive") {
                              Modal.confirm({
                                title: "Archive task?",
                                content: "Archived tasks become read-only and cannot be restarted.",
                                okText: "Archive",
                                onOk: handleArchiveTask
                              });
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
                        <Button icon={<MoreOutlined />} loading={submitting === "archive"}>
                          More
                        </Button>
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
