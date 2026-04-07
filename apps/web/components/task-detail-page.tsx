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
  getModelsForProvider,
  isActiveTaskStatus,
  isTaskWorking,
  type Task,
  type TaskAction,
  type TaskMessageAction,
  type TaskMessage,
  type TaskLiveDiff,
  type TaskRun,
  type AgentProvider,
  type TaskBranchStrategy,
  type ProviderProfile,
  type SystemSettings,
  type GitHubBranchReference,
  type TaskMergePreview,
  type TaskPushPreview,
  type TaskChangeProposal,
  type TaskInteractiveTerminalTranscript,
  type TaskWorkspaceCommit,
  type TaskWorkspaceFilePreview
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
  Popconfirm,
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
import { ArrowRightOutlined, CopyOutlined, EditOutlined, LoadingOutlined, MoreOutlined, PushpinOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Diff, Hunk, type FileData } from "react-diff-view";
import remarkGfm from "remark-gfm";
import { api, ApiError, type TaskInteractiveTerminalStatus } from "../src/api/client";
import { useSnippets } from "../src/hooks/useSnippets";
import { useTask } from "../src/hooks/useTask";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useTaskMessages } from "../src/hooks/useTaskMessages";
import { useTaskRuns } from "../src/hooks/useTaskRuns";
import { useTaskChangeProposals } from "../src/hooks/useTaskChangeProposals";
import { useSettings } from "../src/hooks/useSettings";
import { isImageDiffPath, normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";
import { insertSnippetContent } from "../src/utils/snippets";
import { buildTaskHistoryEntries } from "../src/utils/task-history";
import { useAuth } from "./auth-provider";
import { TaskBinaryDiffCard, type TaskDiffPreviewRefs } from "./task-binary-diff-card";
import { TaskDiffOpenAiPanel } from "./task-diff-openai-panel";
import { TaskTerminalTranscriptView } from "./task-terminal-transcript-view";
import { parseWorkspaceFileLink, WorkspaceFilePreviewModal } from "./workspace-file-preview-modal";

const runStatusColor: Record<TaskRun["status"], string> = {
  running: "processing",
  succeeded: "green",
  failed: "red",
  cancelled: "default"
};

type ComposerAction = TaskMessageAction | "interactive";

const taskActionLabel: Record<ComposerAction | TaskAction, string> = {
  build: "Build",
  ask: "Ask",
  comment: "Comment",
  interactive: "Interactive"
};

function getAllowedComposerActions(
  canBuildTasks: boolean,
  canAskTasks: boolean,
  canUseInteractiveTerminal: boolean
): ComposerAction[] {
  const actions: ComposerAction[] = [];
  if (canBuildTasks) {
    actions.push("build");
  }
  if (canAskTasks) {
    actions.push("ask");
  }
  if (canUseInteractiveTerminal) {
    actions.push("interactive");
  }
  actions.push("comment");
  return actions;
}

function getDefaultComposerAction(task: Task | null, allowedActions: ComposerAction[]): ComposerAction {
  const defaultAction = allowedActions.find((action) => action !== "comment" && action !== "interactive") ?? "comment";

  if (!task) {
    return defaultAction;
  }

  if ((task.lastAction === "build" || task.lastAction === "ask") && allowedActions.includes(task.lastAction)) {
    return task.lastAction;
  }

  return defaultAction;
}

function getProviderDefaultModel(provider: AgentProvider, settings?: SystemSettings | null): string {
  return provider === "claude"
    ? settings?.claudeDefaultModel ?? getDefaultModelForProvider(provider)
    : settings?.codexDefaultModel ?? getDefaultModelForProvider(provider);
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

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: "Codex (OpenAI)", value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

interface WorkspaceFilePreviewState {
  open: boolean;
  loading: boolean;
  taskId: string;
  filePath: string;
  kind: TaskWorkspaceFilePreview["kind"];
  mimeType: string | null;
  encoding: TaskWorkspaceFilePreview["encoding"];
  content: string;
  sizeBytes: number;
  line: number | null;
  error: string | null;
}

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

function getTaskWorkingLabel(task: Pick<Task, "status" | "activeInteractiveSession">): string {
  if (task.activeInteractiveSession) {
    return "Interactive Terminal Running";
  }

  return getTaskStatusLabel(task.status);
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

function renderNonTextDiffCard(file: FileData, collapseFiles: boolean): ReactNode {
  const fileLabel = file.newPath || file.oldPath || "Changed file";
  const description = isImageDiffPath(fileLabel)
    ? "No line-based diff is available for this image in this view."
    : "No line-based diff is available for this file.";

  if (collapseFiles) {
    return (
      <Collapse
        key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
        size="small"
        defaultActiveKey={[]}
        items={[
          {
            key: "file",
            label: fileLabel,
            children: <Typography.Text type="secondary">{description}</Typography.Text>
          }
        ]}
      />
    );
  }

  return (
    <Card
      key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
      size="small"
      title={fileLabel}
    >
      <Typography.Text type="secondary">{description}</Typography.Text>
    </Card>
  );
}

interface ParsedDiffRenderOptions {
  collapseFiles?: boolean;
  taskId?: string;
  previewRefs?: TaskDiffPreviewRefs | null;
  previewUnavailableMessage?: string;
}

function renderParsedDiff(diffText: string, emptyMessage: string, options?: ParsedDiffRenderOptions): ReactNode {
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
                  children: file.hunks.length > 0 ? (
                    <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                    </Diff>
                  ) : (
                    options?.taskId ? (
                      <TaskBinaryDiffCard
                        file={file}
                        collapseFiles={false}
                        taskId={options.taskId}
                        previewRefs={options.previewRefs ?? null}
                        previewUnavailableMessage={options.previewUnavailableMessage}
                        framed={false}
                      />
                    ) : (
                      <Typography.Text type="secondary">
                        {isImageDiffPath(file.newPath || file.oldPath || "")
                          ? "No line-based diff is available for this image in this view."
                          : "No line-based diff is available for this file."}
                      </Typography.Text>
                    )
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
          file.hunks.length > 0 ? (
            <Card
              key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
              size="small"
              title={file.newPath || file.oldPath || "Changed file"}
            >
              <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
              </Diff>
            </Card>
          ) : (
            options?.taskId ? (
              <TaskBinaryDiffCard
                key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
                file={file}
                collapseFiles={false}
                taskId={options.taskId}
                previewRefs={options.previewRefs ?? null}
                previewUnavailableMessage={options.previewUnavailableMessage}
              />
            ) : (
              renderNonTextDiffCard(file, false)
            )
          )
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

  if (task.taskType === "build" || task.taskType === "ask") {
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

type FollowUpMode = "continue" | null;

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
  const { can, canAll, session } = useAuth();
  const { settings } = useSettings();
  const { task, setTask, loading } = useTask(taskId);
  const hadLoadedTaskRef = useRef(false);
  const { messages: taskMessages, setMessages: setTaskMessages, loading: messagesLoading } = useTaskMessages(taskId);
  const { runs: taskRuns, loading: runsLoading } = useTaskRuns(taskId);
  const { proposals: changeProposals, refetch: refetchChangeProposals } = useTaskChangeProposals(taskId);
  const canUseSnippets = can("snippet:list");
  const { snippets, loading: snippetsLoading } = useSnippets(canUseSnippets);
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
  const [followUpMode, setFollowUpMode] = useState<FollowUpMode>(null);
  const [activeMainTab, setActiveMainTab] = useState<"chat" | "context" | "diff">("chat");
  const [expandedRunKeys, setExpandedRunKeys] = useState<string[]>([]);
  const [selectedChatAction, setSelectedChatAction] = useState<ComposerAction>("build");
  const [submitting, setSubmitting] = useState<
    | null
    | "build"
    | "ask"
    | "cancel"
    | "config"
    | "pull"
    | "push"
    | "merge"
    | "archive"
    | "killTerminal"
    | "delete"
    | "continue"
    | "message"
    | "pin"
    | "renameTitle"
    | "editComment"
  >(null);
  const [proposalBusy, setProposalBusy] = useState<{ id: string; kind: "apply" | "reject" | "revert" } | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const selectedChatActionRef = useRef(false);
  const diffCompareBaseSyncedTaskIdRef = useRef<string | null>(null);
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(null);
  const [pushPreview, setPushPreview] = useState<TaskPushPreview | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushCommitMessage, setPushCommitMessage] = useState("");
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeBranches, setMergeBranches] = useState<GitHubBranchReference[]>([]);
  const [mergeBranchesLoading, setMergeBranchesLoading] = useState(false);
  const [mergeTargetBranch, setMergeTargetBranch] = useState<string | undefined>();
  const [mergePreview, setMergePreview] = useState<TaskMergePreview | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergePreviewError, setMergePreviewError] = useState<string | null>(null);
  const [mergeCommitMessage, setMergeCommitMessage] = useState("");
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTitleDraft, setRenameTitleDraft] = useState("");
  const [killTerminalConfirmOpen, setKillTerminalConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [commentEditModalOpen, setCommentEditModalOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<TaskMessage | null>(null);
  const [commentEditDraft, setCommentEditDraft] = useState("");
  const [interactiveTerminalStatus, setInteractiveTerminalStatus] = useState<TaskInteractiveTerminalStatus | null>(null);
  const [interactiveTerminalLaunchPending, setInteractiveTerminalLaunchPending] = useState(false);
  const [interactiveTerminalTranscripts, setInteractiveTerminalTranscripts] = useState<
    Record<
      string,
      {
        loading: boolean;
        loaded: boolean;
        transcript: TaskInteractiveTerminalTranscript | null;
        error: string | null;
      }
    >
  >({});
  const [redirectingToTaskList, setRedirectingToTaskList] = useState(false);
  const [workspaceFilePreview, setWorkspaceFilePreview] = useState<WorkspaceFilePreviewState>({
    open: false,
    loading: false,
    taskId: "",
    filePath: "",
    kind: "text",
    mimeType: null,
    encoding: "utf8",
    content: "",
    sizeBytes: 0,
    line: null,
    error: null
  });
  const workspaceFilePreviewRequestIdRef = useRef(0);
  const executionConfigAutosaveTimeoutRef = useRef<number | null>(null);
  const executionConfigSaveRequestIdRef = useRef(0);
  const bottomScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const initialBottomScrollStateRef = useRef<{ taskId: string; scrolledWithTerminal: boolean } | null>(null);

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
    }
  }, [loading, task]);

  useEffect(() => {
    if (!redirectingToTaskList) {
      return;
    }

    window.location.replace("/tasks");
  }, [redirectingToTaskList]);

  useEffect(() => {
    setInteractiveTerminalTranscripts({});
    setInteractiveTerminalLaunchPending(false);
    initialBottomScrollStateRef.current = null;
  }, [taskId]);

  const taskType = task?.taskType ?? "build";
  const isBuildTask = taskType === "build";
  const isAskTask = taskType === "ask";
  const isImplementationTask = isBuildTask;
  const isArchived = task?.status === "archived";
  const canEditTask = can("task:edit");
  const canBuildTasks = can("task:build");
  const canAskTasks = can("task:ask");
  const canUseInteractiveTerminal = can("task:interactive");
  const canDeleteTask = can("task:delete");
  const canCreateFollowUp = canAll(["task:create", "repo:list"]) && canBuildTasks;
  const isQueued = task?.status === "build_queued" || task?.status === "ask_queued";
  const isActive = task ? isActiveTaskStatus(task.status) : false;
  const hasTaskWorkingState = task ? isTaskWorking(task) : false;
  const checkpointDiffActionsBlockedReason = task ? getCheckpointMutationBlockedReason(task.status) : null;
  const checkpointDiffActionsBlocked = checkpointDiffActionsBlockedReason !== null;
  const isPreparingWorkspace = task?.status === "preparing_workspace";
  const canCancel = canEditTask && (isQueued || isActive);
  const hasBranchForSync = isBuildTask || isAskTask;
  const canPull = canEditTask && hasBranchForSync && !!task?.branchName && !isArchived && !isActive;
  const canPush = canPull;
  const canMerge =
    canEditTask &&
    hasBranchForSync &&
    !isArchived &&
    task?.branchStrategy === "feature_branch" &&
    !!task?.branchName &&
    task.branchName !== task.repoDefaultBranch;
  const pullCount = task?.pullCount ?? 0;
  const pushCount = task?.pushCount ?? 0;
  const canDelete = canDeleteTask && !!task && !isActive;
  const canArchive = canEditTask && !!task && !isActive && !isArchived;
  const roleAllowedProviders = session?.user.allowedProviders ?? [];
  const roleAllowedModels = session?.user.allowedModels ?? [];
  const roleAllowedEfforts = session?.user.allowedEfforts ?? [];
  const providerInputOptions = providerOptions.filter(
    (option) => roleAllowedProviders.length === 0 || roleAllowedProviders.includes(option.value)
  );
  const allowedProviderModels = providerModels.filter(
    (option) => roleAllowedModels.length === 0 || roleAllowedModels.includes(option.value)
  );
  const allowedEffortOptions = getEffortOptionsForProvider(providerInput).filter(
    (option) => roleAllowedEfforts.length === 0 || roleAllowedEfforts.includes(option.value)
  );
  const canContinueOnBranch =
    canCreateFollowUp &&
    !isArchived &&
    isImplementationTask &&
    !!task?.branchName &&
    (task.status === "awaiting_review" || task.status === "open");
  const currentTaskProvider = task?.provider ?? "codex";
  const currentTaskProviderProfile = task?.providerProfile ?? "high";
  const currentTaskModelOverride = task?.modelOverride ?? "";
  const interactiveTerminalTargetProviderLabel = providerInput === "claude" ? "Claude Code" : "Codex";
  const interactiveTerminalConfigDirty =
    providerInput !== currentTaskProvider ||
    providerProfileInput !== currentTaskProviderProfile ||
    modelInput !== (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider));
  const currentTaskBranchStrategy = task?.branchStrategy ?? "feature_branch";
  const hasExecutionContext = Boolean(task?.executionSummary?.trim());
  const configDirty =
    providerInput !== currentTaskProvider ||
    providerProfileInput !== currentTaskProviderProfile ||
    modelInput !== (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider)) ||
    (isImplementationTask && branchStrategyInput !== currentTaskBranchStrategy);

  const resultStatusText =
    task?.status === "preparing_workspace"
      ? "Preparing workspace"
      : isBuildTask
        ? task?.status === "build_queued"
          ? "Build queued"
          : "Build in progress"
        : task?.status === "ask_queued"
          ? "Question queued"
          : "Answer in progress";

  const codeTextStyle: CSSProperties = {
    marginBottom: 0,
    whiteSpace: "pre-wrap",
    fontFamily: "\"SFMono-Regular\", Consolas, monospace"
  };
  const syncExecutionConfigInputs = (nextTask: Task): void => {
    setProviderInput(nextTask.provider ?? "codex");
    setProviderProfileInput(nextTask.providerProfile ?? "high");
    setModelInput(nextTask.modelOverride ?? getDefaultModelForProvider(nextTask.provider ?? "codex"));
    setBranchStrategyInput(nextTask.branchStrategy ?? "feature_branch");
  };
  const applyUpdatedTask = (updatedTask: Task): void => {
    setTask((current) =>
      current
        ? {
            ...current,
            ...updatedTask,
            logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
          }
        : updatedTask
    );
  };
  const showTaskActionError = (error: unknown, fallback: string): void => {
    const nextMessage = error instanceof Error ? error.message : fallback;
    if (nextMessage === "Close the interactive terminal session before continuing.") {
      return;
    }
    messageApi.error(nextMessage);
  };
  const persistTaskConfig = async ({
    provider,
    providerProfile,
    modelOverride,
    branchStrategy,
    notify = true,
    refreshTaskOnFailure = false
  }: {
    provider: AgentProvider;
    providerProfile: ProviderProfile;
    modelOverride: string;
    branchStrategy?: TaskBranchStrategy;
    notify?: boolean;
    refreshTaskOnFailure?: boolean;
  }): Promise<void> => {
    if (!task || !canEditTask || isArchived) {
      return;
    }

    const requestId = executionConfigSaveRequestIdRef.current + 1;
    executionConfigSaveRequestIdRef.current = requestId;
    setSubmitting("config");

    try {
      const updatedTask = await api.updateTaskConfig(task.id, {
        provider,
        providerProfile,
        modelOverride: modelOverride || null,
        branchStrategy
      });

      if (requestId !== executionConfigSaveRequestIdRef.current) {
        return;
      }

      applyUpdatedTask(updatedTask);
      if (notify) {
        messageApi.success(isActive ? "Execution config updated. It will apply to the next run." : "Execution config updated");
      }
    } catch (error) {
      if (requestId !== executionConfigSaveRequestIdRef.current) {
        return;
      }

      if (refreshTaskOnFailure) {
        try {
          const refreshedTask = await api.getTask(task.id);
          applyUpdatedTask(refreshedTask);
          syncExecutionConfigInputs(refreshedTask);
        } catch {
          syncExecutionConfigInputs(task);
        }
      }

      throw error;
    } finally {
      if (requestId === executionConfigSaveRequestIdRef.current) {
        setSubmitting((current) => (current === "config" ? null : current));
      }
    }
  };
  const hasOutputTab = (task?.resultMarkdown?.trim().length ?? 0) > 0;
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
  const diffPreviewRefs =
    !task || !hasLiveDiff
      ? null
      : diffLiveKind === "compare"
        ? {
            before: liveDiff?.baseRef ?? liveDiff?.defaultBaseRef ?? null,
            after: "HEAD"
          }
        : selectedCommitSha
          ? {
              before: `${selectedCommitSha}^`,
              after: selectedCommitSha
            }
          : null;
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
  const allowedChatActions = useMemo(
    () => getAllowedComposerActions(canBuildTasks, canAskTasks, canUseInteractiveTerminal),
    [canAskTasks, canBuildTasks, canUseInteractiveTerminal]
  );

  useEffect(() => {
    const defaultAction = getDefaultComposerAction(task ?? null, allowedChatActions);
    selectedChatActionRef.current = false;
    setSelectedChatAction(defaultAction);
  }, [allowedChatActions, taskId, task?.id]);

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
    if (providerInputOptions.some((option) => option.value === providerInput)) {
      return;
    }
    const fallback = providerInputOptions[0]?.value;
    if (!fallback) {
      return;
    }
    setProviderInput(fallback);
  }, [providerInput, providerInputOptions]);

  useEffect(() => {
    if (providerModelsLoading) {
      return;
    }
    if (allowedProviderModels.some((option) => option.value === modelInput)) {
      return;
    }
    const fallback = allowedProviderModels[0]?.value;
    if (fallback) {
      setModelInput(fallback);
    }
  }, [allowedProviderModels, modelInput, providerModelsLoading]);

  useEffect(() => {
    if (allowedEffortOptions.some((option) => option.value === providerProfileInput)) {
      return;
    }
    const fallback = allowedEffortOptions[0]?.value;
    if (fallback) {
      setProviderProfileInput(fallback);
    }
  }, [allowedEffortOptions, providerProfileInput]);

  useEffect(() => {
    if (!allowedChatActions.includes(selectedChatAction)) {
      selectedChatActionRef.current = false;
      setSelectedChatAction(getDefaultComposerAction(task ?? null, allowedChatActions));
      return;
    }

    if (!selectedChatActionRef.current) {
      setSelectedChatAction(getDefaultComposerAction(task ?? null, allowedChatActions));
    }
  }, [allowedChatActions, selectedChatAction, task]);

  useEffect(() => {
    if (!task) {
      return;
    }

    syncExecutionConfigInputs(task);
  }, [task]);

  useEffect(() => {
    if (!isArchived) {
      return;
    }

    setFollowUpMode(null);
  }, [isArchived]);

  useEffect(() => {
    if (!task || !canEditTask || isArchived) {
      if (executionConfigAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(executionConfigAutosaveTimeoutRef.current);
        executionConfigAutosaveTimeoutRef.current = null;
      }
      return;
    }

    if (!interactiveTerminalConfigDirty) {
      if (executionConfigAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(executionConfigAutosaveTimeoutRef.current);
        executionConfigAutosaveTimeoutRef.current = null;
      }
      return;
    }

    executionConfigAutosaveTimeoutRef.current = window.setTimeout(() => {
      executionConfigAutosaveTimeoutRef.current = null;
      void persistTaskConfig({
        provider: providerInput,
        providerProfile: providerProfileInput,
        modelOverride: modelInput,
        branchStrategy: isImplementationTask ? branchStrategyInput : undefined,
        notify: false,
        refreshTaskOnFailure: true
      }).catch((error) => {
        showTaskActionError(error, "Execution config could not be updated");
      });
    }, 300);

    return () => {
      if (executionConfigAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(executionConfigAutosaveTimeoutRef.current);
        executionConfigAutosaveTimeoutRef.current = null;
      }
    };
  }, [
    task,
    canEditTask,
    isArchived,
    interactiveTerminalConfigDirty,
    providerInput,
    providerProfileInput,
    modelInput,
    isImplementationTask,
    branchStrategyInput,
    messageApi
  ]);

  useEffect(() => {
    if (!task?.id || !canEditTask || !canUseInteractiveTerminal || isArchived) {
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
  }, [
    task?.id,
    task?.provider,
    task?.providerProfile,
    task?.modelOverride,
    canEditTask,
    canUseInteractiveTerminal,
    isArchived
  ]);

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
    if (!mergeModalOpen || !task?.repoId || !task.branchName) {
      return;
    }

    let cancelled = false;
    setMergeBranchesLoading(true);
    setMergePreview(null);
    setMergePreviewError(null);
    setMergeCommitMessage("");

    void api
      .listGitHubBranches(task.repoId)
      .then((branches) => {
        if (cancelled) {
          return;
        }

        const availableBranches = branches.filter((branch) => branch.name !== task.branchName);
        setMergeBranches(availableBranches);
        setMergeTargetBranch((current) => {
          if (current && availableBranches.some((branch) => branch.name === current)) {
            return current;
          }

          return (
            availableBranches.find((branch) => branch.name === task.repoDefaultBranch)?.name ??
            availableBranches[0]?.name
          );
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setMergeBranches([]);
        setMergeTargetBranch(undefined);
        setMergePreviewError(error instanceof Error ? error.message : "Failed to load merge branches");
      })
      .finally(() => {
        if (!cancelled) {
          setMergeBranchesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mergeModalOpen, task?.repoId, task?.branchName, task?.repoDefaultBranch]);

  useEffect(() => {
    if (!mergeModalOpen || !task?.id || !mergeTargetBranch) {
      return;
    }

    let cancelled = false;
    setMergePreviewLoading(true);
    setMergePreview(null);
    setMergePreviewError(null);

    void api
      .getTaskMergePreview(task.id, mergeTargetBranch)
      .then((preview) => {
        if (!cancelled) {
          setMergePreview(preview);
          setMergeCommitMessage(preview.suggestedCommitMessage);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMergePreview(null);
          setMergePreviewError(error instanceof Error ? error.message : "Failed to check mergeability");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMergePreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mergeModalOpen, mergeTargetBranch, task?.id]);

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
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => {
      const workspaceLink = parseWorkspaceFileLink(href);
      if (workspaceLink) {
        return (
          <Typography.Link
            href={href}
            onClick={(event) => {
              event.preventDefault();
              openWorkspaceFilePreview(workspaceLink);
            }}
          >
            {children}
          </Typography.Link>
        );
      }

      return (
        <Typography.Link href={href} target="_blank">
          {children}
        </Typography.Link>
      );
    },
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

  const outputTitle =
    task?.lastAction === "ask"
      ? "Answer"
      : task?.lastAction === "build"
        ? "Summary"
        : "Output";
  const baseBranchLabel = "Base Branch";
  const promptLabel = "Prompt";
  const followUpBranch = task ? task.branchName ?? task.baseBranch : "";
  const followUpTitle = "New Task On Existing Branch";
  const providerLabel = task ? getAgentProviderLabel(task.provider) : "Agent";
  const hasBranch = isBuildTask || isAskTask;
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
  const interactiveTerminalResumeAvailable = interactiveTerminalStatus?.resumableInteractiveSession === true;
  const interactiveTerminalRunning = interactiveTerminalStatus?.activeInteractiveSession === true;
  const showWorkingIndicator = hasTaskWorkingState || interactiveTerminalRunning;
  const workingIndicatorLabel = task
    ? getTaskWorkingLabel({
        ...task,
        activeInteractiveSession: task.activeInteractiveSession || interactiveTerminalRunning
      })
    : "Working";
  const canKillInteractiveTerminal = canEditTask && canUseInteractiveTerminal && !!task && !isArchived && interactiveTerminalRunning;
  const interactiveComposerSelected = selectedChatAction === "interactive";
  const selectedChatActionRequiresPrompt = selectedChatAction !== "interactive";
  const chatClosed = !task || hasReadOnlyTaskAccess || task.status === "archived";
  const chatDisabled =
    chatClosed ||
    interactiveTerminalRunning ||
    (selectedChatAction !== "comment" && (isQueued || isActive || !!pendingChangeProposal));
  const chatInputDisabled = chatDisabled || interactiveComposerSelected;
  const chatPlaceholder = (() => {
    if (interactiveTerminalRunning) {
      return "An interactive terminal session is already running for this task. Close or end it before sending from here.";
    }
    if (!chatDisabled) {
      if (selectedChatAction === "interactive") {
        return "Interactive terminal does not need a prompt. Press Start to open the live session in a new window.";
      }
      if (selectedChatAction === "comment") {
        return "Add a comment to the task history";
      }
      if (selectedChatAction === "ask") {
        return "Ask a repository question or refine the last answer";
      }
      if (selectedChatAction === "build") {
        return "Describe the next implementation change for this branch";
      }
      return hasExecutionContext ? "Add instructions for the next build run" : "Add instructions for the first build run";
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
        interactiveTerminalRunning: interactiveTerminalRunning || interactiveTerminalResumeAvailable || interactiveTerminalLaunchPending
      }),
    [changeProposals, interactiveTerminalLaunchPending, interactiveTerminalResumeAvailable, interactiveTerminalRunning, taskMessages, taskRuns]
  );
  const activeTerminalHistoryEntry = useMemo(
    () =>
      [...chatTimeline]
        .reverse()
        .find(
          (entry): entry is Extract<(typeof chatTimeline)[number], { kind: "grouped_terminal_session" }> =>
            entry.kind === "grouped_terminal_session" && entry.active
        ) ?? null,
    [chatTimeline]
  );
  const historicalChatTimeline = useMemo(
    () => chatTimeline,
    [chatTimeline]
  );
  const hasActiveTerminalHistoryEntry = activeTerminalHistoryEntry !== null;

  useEffect(() => {
    if (interactiveTerminalRunning || interactiveTerminalResumeAvailable) {
      setInteractiveTerminalLaunchPending(false);
    }
  }, [interactiveTerminalResumeAvailable, interactiveTerminalRunning]);

  useEffect(() => {
    if (!task?.id || loading || messagesLoading || runsLoading) {
      return;
    }

    const current = initialBottomScrollStateRef.current;
    const needsInitialScroll = !current || current.taskId !== task.id;
    const needsTerminalFollowupScroll =
      hasActiveTerminalHistoryEntry && (!current || current.taskId !== task.id || !current.scrolledWithTerminal);

    if (!needsInitialScroll && !needsTerminalFollowupScroll) {
      return;
    }

    initialBottomScrollStateRef.current = {
      taskId: task.id,
      scrolledWithTerminal: hasActiveTerminalHistoryEntry
    };

    const scrollToBottomAnchor = () => {
      bottomScrollAnchorRef.current?.scrollIntoView({
        block: "end",
        inline: "nearest",
        behavior: "auto"
      });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottomAnchor);
    });

    const timeoutId = window.setTimeout(scrollToBottomAnchor, 180);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasActiveTerminalHistoryEntry, loading, messagesLoading, runsLoading, task?.id]);

  const openFollowUp = (mode: FollowUpMode) => {
    followUpForm.setFieldsValue({ title: "", prompt: "" });
    setFollowUpMode(mode);
  };
  const handleInsertSelectedSnippet = () => {
    if (!selectedSnippetId) {
      return;
    }

    const snippet = snippets.find((item) => item.id === selectedSnippetId);
    if (!snippet) {
      messageApi.error("Selected snippet is no longer available.");
      return;
    }

    setChatInput((current) => insertSnippetContent(current, snippet.content));
    setSelectedSnippetId(null);
  };
  const composerHasChangesToClear =
    !!selectedSnippetId ||
    !!chatInput.trim() ||
    providerInput !== currentTaskProvider ||
    providerProfileInput !== currentTaskProviderProfile ||
    modelInput !== (currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider));
  const composerClearDisabled = interactiveTerminalRunning || !composerHasChangesToClear;
  const chatSubmitDisabled = chatDisabled || (selectedChatActionRequiresPrompt && chatInput.trim().length === 0);
  const chatSubmitLabel = selectedChatAction === "comment" ? "Add Comment" : "Start";
  const handleConfirmClearComposer = () => {
    setSelectedSnippetId(null);
    setChatInput("");
    if (task) {
      const nextProvider = currentTaskProvider;
      setProviderInput(nextProvider);
      setModelInput(currentTaskModelOverride || getDefaultModelForProvider(nextProvider));
      setProviderProfileInput(currentTaskProviderProfile);
    }
  };
  const handleDeleteTask = async () => {
    if (!task) {
      return;
    }

    setSubmitting("delete");
    try {
      await api.deleteTask(task.id);
      setDeleteConfirmOpen(false);
      setRedirectingToTaskList(true);
      messageApi.success("Task deleted");
    } catch (error) {
      showTaskActionError(error, "Failed to delete task");
    } finally {
      setSubmitting(null);
    }
  };
  const openWorkspaceFilePreview = (target: { taskId: string; filePath: string; line: number | null }) => {
    const requestId = workspaceFilePreviewRequestIdRef.current + 1;
    workspaceFilePreviewRequestIdRef.current = requestId;

    setWorkspaceFilePreview({
      open: true,
      loading: true,
      taskId: target.taskId,
      filePath: target.filePath,
      kind: "text",
      mimeType: null,
      encoding: "utf8",
      content: "",
      sizeBytes: 0,
      line: target.line,
      error: null
    });

    void api
      .getTaskWorkspaceFile(target.taskId, target.filePath)
      .then((result: TaskWorkspaceFilePreview) => {
        if (workspaceFilePreviewRequestIdRef.current !== requestId) {
          return;
        }

        setWorkspaceFilePreview((current) => ({
          ...current,
          open: true,
          loading: false,
          filePath: result.path,
          kind: result.kind,
          mimeType: result.mimeType,
          encoding: result.encoding,
          content: result.content,
          sizeBytes: result.sizeBytes,
          error: null
        }));
      })
      .catch((error) => {
        if (workspaceFilePreviewRequestIdRef.current !== requestId) {
          return;
        }

        setWorkspaceFilePreview((current) => ({
          ...current,
          open: true,
          loading: false,
          error: error instanceof Error ? error.message : "Could not open workspace file."
        }));
      });
  };
  const handleSaveConfig = async ({ notify = true }: { notify?: boolean } = {}) => {
    if (!task || !canEditTask || isArchived || !configDirty) {
      return;
    }

    if (executionConfigAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(executionConfigAutosaveTimeoutRef.current);
      executionConfigAutosaveTimeoutRef.current = null;
    }

    await persistTaskConfig({
      provider: providerInput,
      providerProfile: providerProfileInput,
      modelOverride: modelInput,
      branchStrategy: isImplementationTask ? branchStrategyInput : undefined,
      notify,
      refreshTaskOnFailure: true
    });
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
      setFollowUpMode(null);
      messageApi.success("Task archived");
    } catch (error) {
      showTaskActionError(error, "Failed to archive task");
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
      showTaskActionError(error, "Could not load push preview");
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
      showTaskActionError(error, "Failed to rename task");
    } finally {
      setSubmitting(null);
    }
  };

  const openCommentEditModal = (comment: TaskMessage) => {
    setEditingComment(comment);
    setCommentEditDraft(comment.content);
    setCommentEditModalOpen(true);
  };

  const resetCommentEditModal = () => {
    setCommentEditModalOpen(false);
    setEditingComment(null);
    setCommentEditDraft("");
  };

  const closeCommentEditModal = () => {
    if (submitting === "editComment") {
      return;
    }

    resetCommentEditModal();
  };

  const confirmEditComment = async () => {
    if (!task || !editingComment) {
      return;
    }

    const nextContent = commentEditDraft.trim();
    if (!nextContent) {
      messageApi.warning("Comment cannot be empty");
      return;
    }

    if (nextContent === editingComment.content.trim()) {
      closeCommentEditModal();
      return;
    }

    setSubmitting("editComment");
    try {
      const updatedMessage = await api.updateTaskMessage(task.id, editingComment.id, { content: nextContent });
      setTaskMessages((current) => current.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)));
      messageApi.success("Comment updated");
      resetCommentEditModal();
    } catch (error) {
      showTaskActionError(error, "Failed to update comment");
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
      void loadPushPreview();
      setLiveDiffRefreshKey((k) => k + 1);
    } catch (error) {
      showTaskActionError(error, "Failed to push changes");
    } finally {
      setSubmitting(null);
    }
  };
  const handleMergeTask = async () => {
    if (!task || !mergeTargetBranch || !mergePreview?.mergeable) {
      return;
    }

    Modal.confirm({
      title: `Squash merge into ${mergeTargetBranch}?`,
      content: `This will squash merge ${task.branchName} into ${mergeTargetBranch}, create one commit with your chosen message, and archive the task.`,
      okText: "Squash Merge and Archive",
      onOk: async () => {
        setSubmitting("merge");
        try {
          const updatedTask = await api.mergeTask(task.id, {
            targetBranch: mergeTargetBranch,
            commitMessage: mergeCommitMessage.trim() || undefined
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
          setMergeModalOpen(false);
          setMergeBranches([]);
          setMergeTargetBranch(undefined);
          setMergePreview(null);
          setMergePreviewError(null);
          setMergeCommitMessage("");
          messageApi.success(`Squash merged into ${mergeTargetBranch}`);
        } catch (error) {
          showTaskActionError(error, "Failed to merge task branch");
        } finally {
          setSubmitting(null);
        }
      }
    });
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
      showTaskActionError(error, "Failed to pull changes");
    } finally {
      setSubmitting(null);
    }
  };
  const handleKillInteractiveTerminal = async () => {
    if (!task) {
      return;
    }

    setSubmitting("killTerminal");
    try {
      const updatedTask = await api.killTaskInteractiveTerminal(task.id);
      setTask((current) =>
        current
          ? {
              ...current,
              ...updatedTask,
              logs: updatedTask.logs.length > 0 ? updatedTask.logs : current.logs
            }
          : updatedTask
      );
      setKillTerminalConfirmOpen(false);
      setInteractiveTerminalLaunchPending(false);
      messageApi.success("Interactive terminal stopped");
      setLiveDiffRefreshKey((k) => k + 1);
      refetchChangeProposals();
      void api
        .getTaskInteractiveTerminalStatus(task.id)
        .then((status) => {
          setInteractiveTerminalStatus(status);
        })
        .catch(() => {
          setInteractiveTerminalStatus({
            available: false,
            reason: "Could not load interactive terminal status."
          });
        });
    } catch (error) {
      showTaskActionError(error, "Failed to stop interactive terminal");
    } finally {
      setSubmitting(null);
    }
  };
  const openInteractiveTerminalWindow = (): void => {
    if (!task) {
      return;
    }

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
  };
  const handleStartInteractiveTerminalWindow = async (): Promise<void> => {
    if (!task) {
      return;
    }

    if (configDirty && canEditTask && !isArchived) {
      try {
        await handleSaveConfig({ notify: false });
      } catch (error) {
        showTaskActionError(error, "Execution config could not be updated");
        return;
      }
    }

    setInteractiveTerminalLaunchPending(true);
    openInteractiveTerminalWindow();
  };
  const loadInteractiveTerminalTranscript = async (sessionId: string): Promise<void> => {
    if (!task) {
      return;
    }

    let shouldFetch = false;
    setInteractiveTerminalTranscripts((current) => {
      const existing = current[sessionId];
      if (existing?.loading || (existing?.loaded && !existing.error)) {
        return current;
      }
      shouldFetch = true;
      return {
        ...current,
        [sessionId]: {
          loading: true,
          loaded: false,
          transcript: null,
          error: null
        }
      };
    });

    if (!shouldFetch) {
      return;
    }

    try {
      const transcript = await api.getTaskInteractiveTerminalTranscript(task.id, sessionId);
      setInteractiveTerminalTranscripts((current) => ({
        ...current,
        [sessionId]: {
          loading: false,
          loaded: true,
          transcript,
          error: null
        }
      }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setInteractiveTerminalTranscripts((current) => ({
          ...current,
          [sessionId]: {
            loading: false,
            loaded: true,
            transcript: null,
            error: null
          }
        }));
        return;
      }

      const message = error instanceof Error && error.message.trim() ? error.message : "Could not load terminal logs.";
      setInteractiveTerminalTranscripts((current) => ({
        ...current,
        [sessionId]: {
          loading: false,
          loaded: true,
          transcript: null,
          error: message
        }
      }));
    }
  };
  useEffect(() => {
    if (!task || !canPush) {
      return;
    }
    void loadPushPreview();
  }, [canPush, task?.id, task?.updatedAt]);

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

  const moreActionItems = task
    ? [
        canRequestLiveDiff ? { key: "refreshDiff", label: "Refresh Diff" } : null,
        canKillInteractiveTerminal ? { key: "killInteractiveTerminal", label: "Stop Session", danger: true } : null,
        canEditTask && !isArchived ? { key: "pin", label: task.pinned ? "Unpin Task" : "Pin Task" } : null,
        canContinueOnBranch ? { key: "continue", label: "Continue On Branch" } : null,
        canArchive ? { key: "archive", label: "Archive Task", danger: true } : null,
        canDelete ? { key: "delete", label: "Delete Task", danger: true } : null
      ].filter(Boolean)
    : [];
  const hasMoreActions = moreActionItems.length > 0;
  const hasExecutionButtons = canCancel;
  const hasManagementButtons = Boolean(githubDiffTarget) || hasMoreActions;
  const contextContent = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Repository">{task?.repoName}</Descriptions.Item>
          <Descriptions.Item label="Task Type">{task ? getTaskTypeLabel(task.taskType) : ""}</Descriptions.Item>
          <Descriptions.Item label={baseBranchLabel}>{task?.baseBranch}</Descriptions.Item>
          <Descriptions.Item label="Repository Default Branch">{task?.repoDefaultBranch}</Descriptions.Item>
          {hasBranch ? <Descriptions.Item label="Branch Strategy">{task ? getTaskBranchStrategyLabel(task.branchStrategy) : ""}</Descriptions.Item> : null}
          {hasBranch ? <Descriptions.Item label="Target Branch">{task?.branchName ?? "(pending)"}</Descriptions.Item> : null}
          <Descriptions.Item label="Provider">{getAgentProviderLabel(currentTaskProvider)}</Descriptions.Item>
          <Descriptions.Item label="Model">{currentTaskModelOverride || getDefaultModelForProvider(currentTaskProvider)}</Descriptions.Item>
          <Descriptions.Item label="Effort">{getProviderProfileLabel(currentTaskProviderProfile)}</Descriptions.Item>
          {isImplementationTask ? <Descriptions.Item label="Complexity">{task?.complexity}</Descriptions.Item> : null}
          <Descriptions.Item label="Created">{task ? dayjs(task.createdAt).format("YYYY-MM-DD HH:mm") : ""}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {task ? (
              showWorkingIndicator ? (
                <Space size={8}>
                  <Spin size="small" />
                  <span>{workingIndicatorLabel}</span>
                </Space>
              ) : (
                getTaskStatusLabel(task.status)
              )
            ) : (
              ""
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Last Action">{task?.lastAction ?? "draft"}</Descriptions.Item>
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
          defaultActiveKey={["output-panel"]}
          items={[
            {
              key: "output-panel",
              label: outputTitle,
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {isActive ? (
                    <Alert
                      type="info"
                      showIcon
                      message={resultStatusText}
                      description={`${providerLabel} is running. Watch the logs tab; this section will refresh when the run completes.`}
                    />
                  ) : null}

                  {task?.resultMarkdown ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {task.resultMarkdown}
                    </ReactMarkdown>
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

  const pushPreviewHasPushableChanges = Boolean(
    pushPreview &&
      (pushPreview.hasUncommittedChanges || pushPreview.unpushedCommitSubjects.length > 0)
  );
  const pushNothingToPush = Boolean(pushPreview) && pushCount === 0 && !pushPreviewHasPushableChanges;
  const pushPrimaryDisabled = submitting === "push" || pushPreviewLoading || pushNothingToPush;
  const mergeBlockedReason =
    pendingChangeProposal
      ? "Apply or reject the pending checkpoint before merging."
      : pushCount > 0
        ? "Push all branch changes before merging."
        : undefined;
  const renderPullTaskButton = () =>
    canPull ? (
      <Tooltip
        title={
          pendingChangeProposal
            ? "Apply or reject the pending checkpoint before pulling."
            : undefined
        }
      >
        <span style={{ display: "inline-block" }}>
          <Button onClick={handlePullTask} loading={submitting === "pull"} disabled={!!pendingChangeProposal || submitting === "push"}>
            {`Pull (${pullCount})`}
          </Button>
        </span>
      </Tooltip>
    ) : null;
  const renderPushTaskButton = () =>
    canPush ? (
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
          <Button type="primary" onClick={() => void confirmPushTask()} loading={submitting === "push"} disabled={!!pendingChangeProposal || pushPrimaryDisabled}>
            {`Push (${pushCount})`}
          </Button>
        </span>
      </Tooltip>
    ) : null;
  const renderMergeTaskButton = () =>
    canMerge ? (
      <Tooltip title={mergeBlockedReason}>
        <span style={{ display: "inline-block" }}>
          <Button onClick={() => setMergeModalOpen(true)} loading={submitting === "merge"} disabled={!!mergeBlockedReason}>
            Merge
          </Button>
        </span>
      </Tooltip>
    ) : null;

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
          <Flex align="flex-start" wrap="wrap" gap={16}>
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
            <ArrowRightOutlined style={{ color: "rgba(0,0,0,0.45)", marginTop: 34 }} />
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
                    : hasLiveDiff
                        ? "No diff between the selected base and HEAD."
                        : "No diff captured yet. Run Build to generate one."
              }
              collapseFiles
              taskId={task.id}
              liveDiff={liveDiff}
              previewRefs={diffPreviewRefs}
              selectionResetToken={`${task.id}-${diffLiveKind}-${selectedCommitSha ?? ""}`}
            />
          </div>
        </Flex>
      ) : null}
    </Space>
  ) : null;

  const chatComposer = (
    <Flex vertical gap={12}>
      <Input.TextArea
        autoSize={{ minRows: 4, maxRows: 14 }}
        value={chatInput}
        onChange={(event) => setChatInput(event.target.value)}
        placeholder={chatPlaceholder}
        disabled={chatInputDisabled}
        style={{ resize: "none" }}
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
              options={providerInputOptions}
              onChange={(value) => {
                setProviderInput(value);
                const nextModels = getModelsForProvider(value).filter(
                  (option) => roleAllowedModels.length === 0 || roleAllowedModels.includes(option.value)
                );
                const nextEfforts = getEffortOptionsForProvider(value).filter(
                  (option) => roleAllowedEfforts.length === 0 || roleAllowedEfforts.includes(option.value)
                );
                const nextDefaultModel = getProviderDefaultModel(value, settings);
                const nextModelAllowedByRole = roleAllowedModels.length === 0 || roleAllowedModels.includes(nextDefaultModel);
                setModelInput(nextModelAllowedByRole ? nextDefaultModel : (nextModels[0]?.value ?? nextDefaultModel));
                if (!nextEfforts.some((option) => option.value === providerProfileInput)) {
                  setProviderProfileInput(nextEfforts[0]?.value ?? "high");
                }
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
              options={allowedProviderModels}
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
              options={allowedEffortOptions}
              onChange={(value) => setProviderProfileInput(value)}
              style={{ width: "100%", marginTop: 6 }}
              disabled={!canEditTask || isArchived || interactiveTerminalRunning}
            />
          </div>
          {!interactiveComposerSelected ? (
            <div
              style={{
                minWidth: 260,
                maxWidth: 420,
                display: "flex",
                flexDirection: "column"
              }}
            >
              <Typography.Text type="secondary">Snippet</Typography.Text>
              <Flex gap={8} style={{ marginTop: 6 }}>
                <Select
                  showSearch
                  style={{ minWidth: 180, flex: 1 }}
                  placeholder={snippetsLoading ? "Loading snippets..." : "Select snippet"}
                  value={selectedSnippetId}
                  onChange={(value) => setSelectedSnippetId(value)}
                  optionFilterProp="label"
                  allowClear
                  loading={snippetsLoading}
                  disabled={snippetsLoading || snippets.length === 0 || !canEditTask || isArchived || interactiveTerminalRunning}
                  options={snippets.map((snippet) => ({
                    label: snippet.name,
                    value: snippet.id
                  }))}
                />
                <Button
                  onClick={handleInsertSelectedSnippet}
                  disabled={!selectedSnippetId || !canEditTask || isArchived || interactiveTerminalRunning}
                >
                  Insert
                </Button>
              </Flex>
            </div>
          ) : null}
        </Flex>
        <Flex align="center" gap={12} wrap="wrap" style={{ flexShrink: 0 }}>
          <Typography.Text type="secondary">Next run: {chatActionLabel}</Typography.Text>
          <Flex align="center" gap={12} wrap="wrap">
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
                disabled={chatSubmitDisabled}
                onClick={async () => {
                  if (!task) {
                    return;
                  }

                  if (selectedChatAction === "interactive") {
                    setSubmitting("message");
                    try {
                      await handleStartInteractiveTerminalWindow();
                    } finally {
                      setSubmitting(null);
                    }
                    return;
                  }

                  if (chatInput.trim().length === 0) {
                    return;
                  }

                  if (configDirty && canEditTask && !isArchived) {
                    try {
                      await handleSaveConfig({ notify: false });
                    } catch (error) {
                      showTaskActionError(error, "Execution config could not be updated");
                      return;
                    }
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
                    showTaskActionError(error, "Task execution could not be started");
                  } finally {
                    setSubmitting(null);
                  }
                }}
              >
                {chatSubmitLabel}
              </Button>
              <Popconfirm
                title="Clear composer?"
                description="This will clear the message input and reset provider and model settings to this task's defaults."
                okText="Clear"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
                placement="top"
                disabled={composerClearDisabled}
                onConfirm={handleConfirmClearComposer}
              >
                <Button disabled={composerClearDisabled}>Clear</Button>
              </Popconfirm>
            </Space.Compact>
            {canPull || canPush || canMerge ? (
              <Space
                size={8}
                wrap
                style={{
                  paddingInlineStart: 12,
                  marginInlineStart: 4,
                  borderInlineStart: "1px solid var(--ant-colorSplit, rgba(5, 5, 5, 0.12))"
                }}
              >
                {renderPullTaskButton()}
                {renderPushTaskButton()}
                {renderMergeTaskButton()}
              </Space>
            ) : null}
          </Flex>
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
      showTaskActionError(error, "Could not apply checkpoint");
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
          showTaskActionError(error, "Could not reject checkpoint");
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
          showTaskActionError(error, "Could not revert checkpoint");
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
            children: renderParsedDiff(proposal.diff, "No diff text.", {
              collapseFiles: true,
              taskId: proposal.taskId,
              previewRefs: {
                before: proposal.fromRef,
                after: proposal.toRef,
                useWorkspaceAfter: proposal.sourceType === "interactive_session" && proposal.status !== "reverted"
              }
            })
          }
        ]}
      />
    );
  };

  const copyMarkdownToClipboard = async (markdown: string, label: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      messageApi.error("Clipboard access is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
      messageApi.success(`${label} copied`);
    } catch (error) {
      showTaskActionError(error, `Could not copy ${label.toLowerCase()}`);
    }
  };

  const renderSummaryCopyButton = (markdown: string, label = "Summary markdown") => (
    <span onClick={(event) => event.stopPropagation()}>
      <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyMarkdownToClipboard(markdown, label)}>
        Copy
      </Button>
    </span>
  );

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
    const canEditCommentMessage = canEditTask && !isArchived && entryMessage.role === "user" && entryMessage.action === "comment";

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
              <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap">
                <Space wrap size={8}>
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    {entryMessage.role}
                  </Tag>
                  {entryMessage.action ? <Tag style={{ marginInlineEnd: 0 }}>{taskActionLabel[entryMessage.action]}</Tag> : null}
                  <Typography.Text type="secondary">{dayjs(entryMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text>
                </Space>
                {canEditCommentMessage ? (
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openCommentEditModal(entryMessage)}>
                    Edit
                  </Button>
                ) : null}
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
    const isCollapsibleSummaryRun = run.action === "build" || run.action === "ask";
    const summaryCollapseItems = normalizedRunSummary
      ? [
          {
            key: `${run.id}-summary`,
            label: run.action === "build" ? "Implementation Summary" : "Answer",
            extra: <Space size={4} wrap>{renderSummaryCopyButton(normalizedRunSummary)}</Space>,
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
                extra: normalizedRunSummary ? renderSummaryCopyButton(normalizedRunSummary) : null,
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
    const showTerminalSessionControls = entry.active && canEditTask && task && !isArchived;
    const transcriptKey = `${entryKey}-terminal-logs`;
    const transcriptState = entry.sessionId ? interactiveTerminalTranscripts[entry.sessionId] : null;
    const showTranscriptSection = !entry.active && !!entry.sessionId;
    const transcriptLabel = `Logs${transcriptState?.transcript?.truncated ? " (truncated)" : ""}`;

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
          {entry.active ? (
            <Alert
              type="info"
              showIcon
              message={interactiveTerminalResumeAvailable ? "Terminal session can be resumed" : "Terminal session is active"}
              description={
                interactiveTerminalResumeAvailable
                  ? "This live terminal session is still running. Reconnect to continue in the existing workspace session, or stop it to end the session and create a checkpoint."
                  : "This terminal session is currently attached to another window or tab. Stop it there or use Stop here to end the session and create a checkpoint."
              }
              action={
                showTerminalSessionControls ? (
                  <Space wrap>
                    {interactiveTerminalResumeAvailable ? (
                      <Button type="primary" size="small" onClick={openInteractiveTerminalWindow}>
                        Reconnect
                      </Button>
                    ) : null}
                    <Button size="small" danger onClick={() => setKillTerminalConfirmOpen(true)}>
                      Stop Session
                    </Button>
                  </Space>
                ) : null
              }
            />
          ) : null}
          <Typography.Text type="secondary">
            {`${dayjs(entry.startMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")} - ${entry.startMessage.content}`}
          </Typography.Text>
          <Typography.Text type="secondary">
            {entry.endMessage
              ? `${dayjs(entry.endMessage.createdAt).format("YYYY-MM-DD HH:mm:ss")} - ${entry.endMessage.content}`
              : "Running - Interactive terminal session is still running."}
          </Typography.Text>
          {showTranscriptSection ? (
            <Collapse
              size="small"
              onChange={(keys) => {
                const activeKeys = Array.isArray(keys) ? keys : keys ? [keys] : [];
                if (activeKeys.includes(transcriptKey) && entry.sessionId) {
                  void loadInteractiveTerminalTranscript(entry.sessionId);
                }
              }}
              items={[
                {
                  key: transcriptKey,
                  label: transcriptLabel,
                  children: transcriptState?.loading ? (
                    <Flex justify="center" style={{ padding: "12px 0" }}>
                      <Spin size="small" />
                    </Flex>
                  ) : transcriptState?.error ? (
                    <Alert type="error" showIcon message="Could not load terminal logs" description={transcriptState.error} />
                  ) : transcriptState?.transcript ? (
                    <Flex vertical gap={8}>
                      <TaskTerminalTranscriptView content={transcriptState.transcript.content} />
                      {transcriptState.transcript.truncated ? (
                        <Typography.Text type="secondary">
                          The stored terminal transcript was truncated because it exceeded the size limit.
                        </Typography.Text>
                      ) : null}
                    </Flex>
                  ) : transcriptState?.loaded ? (
                    <Typography.Text type="secondary">No terminal output was captured for this session.</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">Open this panel to load the terminal logs for this session.</Typography.Text>
                  )
                }
              ]}
            />
          ) : null}
          {entry.proposal ? renderCheckpointDiffSection(entry.proposal, entryKey) : null}
        </Flex>
      </Card>
    );
  };
  const chatTimelineBlock = historicalChatTimeline.length > 0 ? (
    <Flex vertical gap={12} style={{ width: "100%" }}>
      {historicalChatTimeline.map((entry) => {
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
    !isPreparingWorkspace && historicalChatTimeline.length === 0 ? (
      <Empty description={messagesLoading || runsLoading ? "Loading history..." : "No history yet."} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    ) : null;

  const mainTabItems = [
    {
      key: "chat",
      label: "History",
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {chatPreparingNotice}
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
      <Modal
        title="Edit comment"
        open={commentEditModalOpen}
        onCancel={closeCommentEditModal}
        destroyOnClose
        onOk={() => void confirmEditComment()}
        okText="Save"
        confirmLoading={submitting === "editComment"}
        okButtonProps={{ disabled: !commentEditDraft.trim() }}
      >
        <Input.TextArea
          value={commentEditDraft}
          onChange={(event) => setCommentEditDraft(event.target.value)}
          rows={8}
          placeholder="Comment"
          disabled={submitting === "editComment"}
          style={{ resize: "vertical" }}
        />
      </Modal>
      <Modal
        title="Squash Merge Branch"
        open={mergeModalOpen}
        onCancel={() => {
          if (submitting === "merge") {
            return;
          }

          setMergeModalOpen(false);
          setMergeBranches([]);
          setMergeTargetBranch(undefined);
          setMergePreview(null);
          setMergePreviewError(null);
          setMergeCommitMessage("");
        }}
        destroyOnClose
        footer={
          <Flex justify="flex-end" gap={12}>
            <Button
              onClick={() => {
                if (submitting === "merge") {
                  return;
                }

                setMergeModalOpen(false);
                setMergeBranches([]);
                setMergeTargetBranch(undefined);
                setMergePreview(null);
                setMergePreviewError(null);
                setMergeCommitMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={() => void handleMergeTask()}
              loading={submitting === "merge"}
              disabled={!mergePreview?.mergeable || mergePreviewLoading || !mergeTargetBranch || !mergeCommitMessage.trim()}
            >
              Squash Merge
            </Button>
          </Flex>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            Choose the branch that should receive <Typography.Text code>{task?.branchName ?? "(task branch)"}</Typography.Text>.
          </Typography.Paragraph>
          <Form layout="vertical">
            <Form.Item label="Target Branch" required>
              <Select
                showSearch
                placeholder={mergeBranchesLoading ? "Loading branches..." : "Select target branch"}
                loading={mergeBranchesLoading}
                value={mergeTargetBranch}
                onChange={(value) => setMergeTargetBranch(value ?? undefined)}
                optionFilterProp="label"
                options={mergeBranches.map((branch) => ({
                  label: branch.isDefault ? `${branch.name} (repo default)` : branch.name,
                  value: branch.name
                }))}
              />
            </Form.Item>
            <Form.Item label="Commit Message" required>
              <Input
                value={mergeCommitMessage}
                onChange={(event) => setMergeCommitMessage(event.target.value)}
                placeholder="feat(agentswarm): update files"
                maxLength={72}
              />
            </Form.Item>
          </Form>
          {!mergeBranchesLoading && mergeBranches.length === 0 ? (
            <Alert type="info" showIcon message="No target branches available for merging." />
          ) : null}
          {mergePreviewLoading ? (
            <Flex align="center" gap={8}>
              <Spin size="small" />
              <Typography.Text type="secondary">Checking whether the branch can merge cleanly…</Typography.Text>
            </Flex>
          ) : mergePreviewError ? (
            <Alert type="error" showIcon message="Cannot merge" description={mergePreviewError} />
          ) : mergePreview ? (
            <Alert
              type={mergePreview.mergeable ? "success" : "error"}
              showIcon
              message={mergePreview.mergeable ? "Squash merge is possible" : "Merge is blocked"}
              description={mergePreview.message}
            />
          ) : null}
        </Space>
      </Modal>
      <WorkspaceFilePreviewModal
        open={workspaceFilePreview.open}
        loading={workspaceFilePreview.loading}
        filePath={workspaceFilePreview.filePath}
        kind={workspaceFilePreview.kind}
        mimeType={workspaceFilePreview.mimeType}
        encoding={workspaceFilePreview.encoding}
        content={workspaceFilePreview.content}
        sizeBytes={workspaceFilePreview.sizeBytes}
        line={workspaceFilePreview.line}
        error={workspaceFilePreview.error}
        onCancel={() => {
          workspaceFilePreviewRequestIdRef.current += 1;
          setWorkspaceFilePreview((current) => ({ ...current, open: false }));
        }}
      />
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
                {showWorkingIndicator ? (
                  <Space size={6} align="center" style={{ color: "rgba(0,0,0,0.65)" }}>
                    <Spin size="small" />
                    <Typography.Text type="secondary">{workingIndicatorLabel}</Typography.Text>
                  </Space>
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
                    {hasMoreActions && Boolean(githubDiffTarget) ? (
                      <Divider type="vertical" style={{ marginInline: 2 }} />
                    ) : null}

                    {hasMoreActions ? (
                      <Dropdown
                        menu={{
                          items: moreActionItems,
                          onClick: ({ key }) => {
                            if (key === "refreshDiff") {
                              setLiveDiffRefreshKey((k) => k + 1);
                              return;
                            }

                            if (key === "killInteractiveTerminal") {
                              setKillTerminalConfirmOpen(true);
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
                              setDeleteConfirmOpen(true);
                            }
                          }
                        }}
                        trigger={["click"]}
                      >
                        <Button icon={<MoreOutlined />} loading={submitting === "archive" || submitting === "killTerminal"}>
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
              description="Archived tasks are read-only for task changes. You can still inspect history, output, diffs, and delete the task."
            />
          ) : !canEditTask ? (
            <Alert
              type="info"
              showIcon
              message="Read-only task access"
              description="This account can inspect task state and history, but it cannot change the task."
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
            <div ref={bottomScrollAnchorRef} style={{ height: 40, width: "100%", flexShrink: 0 }} />
          </Flex>
        ) : null}
      </Flex>

      <Modal
        open={killTerminalConfirmOpen}
        title="Stop interactive session?"
        onCancel={() => {
          if (submitting !== "killTerminal") {
            setKillTerminalConfirmOpen(false);
          }
        }}
        okText="Stop Session"
        okButtonProps={{ danger: true }}
        confirmLoading={submitting === "killTerminal"}
        cancelButtonProps={{ disabled: submitting === "killTerminal" }}
        onOk={() => void handleKillInteractiveTerminal()}
        destroyOnClose
      >
        This stops the live interactive terminal session and keeps whatever is currently in the workspace so AgentSwarm
        can create the usual checkpoint for recovery.
      </Modal>
      <Modal
        open={deleteConfirmOpen && !!task}
        title="Delete task?"
        onCancel={() => {
          if (submitting !== "delete") {
            setDeleteConfirmOpen(false);
          }
        }}
        okText="Delete"
        okButtonProps={{ danger: true, loading: submitting === "delete" }}
        cancelButtonProps={{ disabled: submitting === "delete" }}
        onOk={() => void handleDeleteTask()}
        destroyOnClose
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          This removes the task and its stored logs.
        </Typography.Paragraph>
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
            onFinish={async (values: { title: string; prompt: string }) => {
              setSubmitting("continue");
              try {
                const normalizedPrompt = values.prompt.trim();
                const nextTask = await api.createTask({
                  title: values.title.trim(),
                  prompt: normalizedPrompt,
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
                message="This creates a new task on the current branch"
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
                <Input placeholder="Follow-up task on this branch" />
              </Form.Item>
              <Form.Item name="prompt" label="Prompt" rules={[{ required: true }]}>
                <Input.TextArea
                  autoSize={{ minRows: 6, maxRows: 18 }}
                  placeholder="Describe the new problem to solve on this branch."
                  style={{ resize: "none" }}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting === "continue"}>
                Create Continued Task
              </Button>
            </Space>
          </Form>
        ) : null}
      </Modal>
    </>
  );
}
