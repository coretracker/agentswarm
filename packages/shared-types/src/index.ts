export type TaskType = "build" | "ask";

/** What happens immediately after a task row is created. */
export type TaskStartMode = "run_now" | "prepare_workspace" | "idle";
export type AgentProvider = "codex" | "claude";

/** Native effort values from providers. "max" is Claude-only. */
export type ProviderProfile = "low" | "medium" | "high" | "max";

export interface ProviderModelOption {
  label: string;
  value: string;
}

export interface ProviderEffortOption {
  label: string;
  value: ProviderProfile;
}

export const CODEX_MODELS: ProviderModelOption[] = [
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "o3", value: "o3" },
  { label: "o4-mini", value: "o4-mini" },
  { label: "o3-mini", value: "o3-mini" },
  { label: "GPT-4.1", value: "gpt-4.1" },
  { label: "GPT-4o", value: "gpt-4o" }
];

export const CLAUDE_MODELS: ProviderModelOption[] = [
  { label: "Claude Opus 4", value: "claude-opus-4-5" },
  { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
  { label: "Claude Sonnet 4", value: "claude-sonnet-4" },
  { label: "Claude Haiku 3.5", value: "claude-haiku-3-5" }
];

/** Codex natively supports low / medium / high reasoning effort. */
export const CODEX_EFFORT_OPTIONS: ProviderEffortOption[] = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" }
];

/** Claude profiles map to thinking budgets when the resolved model supports it; "max" leaves the budget unset. */
export const CLAUDE_EFFORT_OPTIONS: ProviderEffortOption[] = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Max", value: "max" }
];

export const getModelsForProvider = (provider: AgentProvider): ProviderModelOption[] =>
  provider === "claude" ? CLAUDE_MODELS : CODEX_MODELS;

export const getEffortOptionsForProvider = (provider: AgentProvider): ProviderEffortOption[] =>
  provider === "claude" ? CLAUDE_EFFORT_OPTIONS : CODEX_EFFORT_OPTIONS;

export const getDefaultModelForProvider = (provider: AgentProvider): string =>
  provider === "claude" ? "claude-sonnet-4-5" : "gpt-5.4";
export type TaskMessageRole = "user" | "assistant" | "system";
export type TaskRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type TaskStatus =
  | "build_queued"
  | "preparing_workspace"
  | "building"
  | "ask_queued"
  | "asking"
  | "open"
  | "awaiting_review"
  | "completed"
  | "answered"
  | "accepted"
  | "archived"
  | "cancelled"
  | "failed";

export type TaskAction = "build" | "ask";
export type TaskMessageAction = TaskAction | "comment";
export type TaskContextEntryKind = "message" | "run" | "proposal" | "terminal_session";
export const TASK_CONTEXT_ENTRY_MAX_COUNT = 8;
export const TASK_CONTEXT_ENTRY_MAX_LABEL_LENGTH = 160;
export const TASK_CONTEXT_ENTRY_MAX_CONTENT_LENGTH = 2_500;
export const TASK_CONTEXT_TOTAL_MAX_CHARS = 12_000;
export const TASK_PROMPT_ATTACHMENT_MAX_COUNT = 6;
export const TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES = 6 * 1024 * 1024;
export const TASK_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
/** @deprecated Use ProviderProfile instead. Kept for Redis migration in task-store. */
export type TaskReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type TaskComplexity = "trivial" | "normal" | "complex";
export type TaskBranchStrategy = "feature_branch" | "work_on_branch";
export type McpServerTransport = "stdio" | "http";
export type PermissionScope =
  | "task:list"
  | "task:create"
  | "task:read"
  | "task:edit"
  | "task:build"
  | "task:ask"
  | "task:interactive"
  | "task:delete"
  | "snippet:list"
  | "snippet:create"
  | "snippet:read"
  | "snippet:edit"
  | "snippet:delete"
  | "repo:list"
  | "repo:read"
  | "repo:create"
  | "repo:edit"
  | "repo:delete"
  | "settings:read"
  | "settings:edit"
  | "user:list"
  | "user:create"
  | "user:read"
  | "user:edit"
  | "user:delete";

export const ALL_PERMISSION_SCOPES: PermissionScope[] = [
  "task:list",
  "task:create",
  "task:read",
  "task:edit",
  "task:build",
  "task:ask",
  "task:interactive",
  "task:delete",
  "snippet:list",
  "snippet:create",
  "snippet:read",
  "snippet:edit",
  "snippet:delete",
  "repo:list",
  "repo:read",
  "repo:create",
  "repo:edit",
  "repo:delete",
  "settings:read",
  "settings:edit",
  "user:list",
  "user:create",
  "user:read",
  "user:edit",
  "user:delete"
];

export interface PermissionScopeGroup {
  label: string;
  scopes: PermissionScope[];
}

export const PERMISSION_SCOPE_GROUPS: PermissionScopeGroup[] = [
  { label: "Tasks", scopes: ["task:list", "task:create", "task:read", "task:edit", "task:build", "task:ask", "task:interactive", "task:delete"] },
  { label: "Snippets", scopes: ["snippet:list", "snippet:create", "snippet:read", "snippet:edit", "snippet:delete"] },
  { label: "Repositories", scopes: ["repo:list", "repo:read", "repo:create", "repo:edit", "repo:delete"] },
  { label: "Settings", scopes: ["settings:read", "settings:edit"] },
  { label: "Users", scopes: ["user:list", "user:create", "user:read", "user:edit", "user:delete"] }
];

export type TaskCapabilityScope = Extract<PermissionScope, "task:build" | "task:ask" | "task:interactive">;

export const getTaskCapabilityScopeForTaskType = (taskType: TaskType): TaskCapabilityScope =>
  taskType === "ask" ? "task:ask" : "task:build";

export const getTaskCapabilityScopeForTaskAction = (action: TaskAction): TaskCapabilityScope =>
  action === "ask" ? "task:ask" : "task:build";

export const getRequiredTaskCapabilityScopes = (input: { taskType?: TaskType; startMode?: TaskStartMode }): TaskCapabilityScope[] =>
  input.startMode === "prepare_workspace" ? ["task:interactive"] : [getTaskCapabilityScopeForTaskType(input.taskType ?? "build")];

export const hasRequiredTaskCapabilities = (
  grantedScopes: Iterable<PermissionScope>,
  input: { taskType?: TaskType; startMode?: TaskStartMode }
): boolean => {
  const granted = new Set(grantedScopes);
  return getRequiredTaskCapabilityScopes(input).every((scope) => granted.has(scope));
};

export const getRequiredTaskCapabilityScopesForDefinition = (definition: TaskDefinitionInput): TaskCapabilityScope[] =>
  definition.sourceType === "pull_request"
    ? getRequiredTaskCapabilityScopes({ taskType: "build", startMode: "run_now" })
    : getRequiredTaskCapabilityScopes({
        taskType: definition.taskType,
        startMode: definition.startMode
      });

export const hasRequiredTaskCapabilitiesForDefinition = (
  grantedScopes: Iterable<PermissionScope>,
  definition: TaskDefinitionInput
): boolean => {
  const granted = new Set(grantedScopes);
  return getRequiredTaskCapabilityScopesForDefinition(definition).every((scope) => granted.has(scope));
};

export interface Role {
  id: string;
  name: string;
  description: string;
  scopes: PermissionScope[];
  allowedProviders: AgentProvider[];
  allowedModels: string[];
  allowedEfforts: ProviderProfile[];
  scopeVersion?: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleRef {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: UserRoleRef[];
  repositoryIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionUser extends User {
  scopes: PermissionScope[];
  allowedProviders: AgentProvider[];
  allowedModels: string[];
  allowedEfforts: ProviderProfile[];
}

export interface AuthSession {
  user: AuthSessionUser;
  expiresAt: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  scopes: PermissionScope[];
  allowedProviders?: AgentProvider[];
  allowedModels?: string[];
  allowedEfforts?: ProviderProfile[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  scopes?: PermissionScope[];
  allowedProviders?: AgentProvider[];
  allowedModels?: string[];
  allowedEfforts?: ProviderProfile[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  active?: boolean;
  roleIds?: string[];
  repositoryIds?: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
  roleIds?: string[];
  repositoryIds?: string[];
}

export interface RepositoryEnvVar {
  key: string;
  value: string;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  envVars: RepositoryEnvVar[];
  webhookUrl: string | null;
  webhookEnabled: boolean;
  webhookSecretConfigured: boolean;
  webhookLastAttemptAt: string | null;
  webhookLastStatus: "success" | "failed" | null;
  webhookLastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskTerminalSessionMode = "interactive" | "git";

export interface Task {
  id: string;
  title: string;
  pinned: boolean;
  hasPendingCheckpoint: boolean;
  activeInteractiveSession?: boolean;
  activeTerminalSessionMode?: TaskTerminalSessionMode | null;
  ownerUserId: string | null;
  repoId: string;
  repoName: string;
  repoUrl: string;
  repoDefaultBranch: string;
  taskType: TaskType;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
  complexity: TaskComplexity;
  branchName: string | null;
  workspaceBaseRef: string | null;
  prompt: string;
  resultMarkdown: string | null;
  executionSummary: string;
  branchDiff: string | null;
  pullCount?: number;
  pushCount?: number;
  lastAction: TaskAction | null;
  status: TaskStatus;
  logs: string[];
  enqueued: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface OpenAiDiffAssistInput {
  model: string;
  providerProfile: ProviderProfile;
  userPrompt: string;
  /** Repository-relative path (optional `a/` or `b/` prefixes are stripped server-side). */
  filePath: string;
  selectedSnippet: string;
}

export interface OpenAiDiffAssistResult {
  text: string;
}

export interface TaskLiveDiff {
  diff: string | null;
  live: boolean;
  fetchedAt: string;
  message: string | null;
  /** Current workspace HEAD branch (or "HEAD" when detached). */
  headBranch: string | null;
  /** Short SHA for HEAD. */
  headShaShort: string | null;
  /** Ref used as the compare base for this diff (e.g. origin/main). */
  baseRef: string | null;
  /** Auto-resolved base when no override was requested; mirrors baseRef when using default. */
  defaultBaseRef: string | null;
}

/** One commit on the task workspace’s current branch (from `git log`). */
export interface TaskWorkspaceCommit {
  sha: string;
  shortSha: string;
  subject: string;
  /** ISO 8601 timestamp from `git log` (%cI). */
  committedAt: string;
  authorName: string;
}

export interface TaskWorkspaceCommitLog {
  commits: TaskWorkspaceCommit[];
  fetchedAt: string;
  message: string | null;
}

export type TaskWorkspaceFilePreviewKind = "text" | "image" | "binary";

export interface TaskWorkspaceFilePreview {
  path: string;
  /** Git ref used for the preview, or null when reading the live workspace file. */
  ref: string | null;
  kind: TaskWorkspaceFilePreviewKind;
  mimeType: string | null;
  encoding: "utf8" | "base64";
  content: string;
  sizeBytes: number;
}

/** Snapshot for the Push UI before staging/commit (working tree + index vs HEAD). */
export interface TaskPushPreview {
  branchName: string;
  changedFiles: string[];
  /** Unified diff vs HEAD; may be truncated for large workspaces. */
  diff: string;
  diffTruncated: boolean;
  /** `git diff HEAD --stat` output (may be truncated). */
  diffStat: string;
  hasUncommittedChanges: boolean;
  unpushedCommitSubjects: string[];
  /** Suggested first line if a new commit is created from current changes. */
  suggestedCommitMessage: string;
}

export interface TaskMergePreview {
  sourceBranch: string;
  targetBranch: string;
  mergeable: boolean;
  message: string;
  suggestedCommitMessage: string;
}

export interface TaskPromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  relativePath: string;
}

export interface CreateTaskPromptAttachmentInput {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  role: TaskMessageRole;
  content: string;
  action: TaskMessageAction | null;
  /** Optional saved context entries that were attached when the user submitted this message. */
  contextEntries?: TaskContextEntry[];
  /** Optional saved image attachments that were attached when the user submitted this message. */
  attachments?: TaskPromptAttachment[];
  /** Present for interactive terminal lifecycle messages so history can address the terminal session. */
  sessionId?: string | null;
  createdAt: string;
}

export interface TaskContextEntry {
  kind: TaskContextEntryKind;
  label: string;
  content: string;
}

export interface TaskExecutionInput {
  content: string;
  contextEntries?: TaskContextEntry[];
  attachments?: TaskPromptAttachment[];
}

export interface TaskRun {
  id: string;
  taskId: string;
  action: TaskAction;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  branchName: string | null;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  errorMessage: string | null;
  /** Git HEAD ref captured before the agent container runs; used for change proposals. */
  changeProposalCheckpointRef?: string | null;
  /** Untracked paths (repo-relative) at checkpoint; used so reject does not wipe pre-existing untracked files. */
  changeProposalUntrackedPaths?: string[] | null;
  logs: string[];
}

export type TaskChangeProposalSourceType = "build_run" | "interactive_session";

export type TaskChangeProposalStatus = "pending" | "applied" | "rejected" | "reverted";

export interface TaskChangeProposal {
  id: string;
  taskId: string;
  sourceType: TaskChangeProposalSourceType;
  /** `TaskRun.id` for build_run; session id for interactive_session */
  sourceId: string;
  status: TaskChangeProposalStatus;
  fromRef: string;
  toRef: string;
  /** Persisted unified diff for preview and revert (when not truncated). */
  diff: string;
  diffStat: string;
  changedFiles: string[];
  diffTruncated: boolean;
  /** Untracked paths at proposal start; on reject only *new* untracked files (not in this list) are removed. */
  untrackedPathsAtCheckpoint: string[];
  createdAt: string;
  /** Set when leaving pending (apply or reject). */
  resolvedAt: string | null;
  /** Set when an applied checkpoint is reverted via stored diff. */
  revertedAt: string | null;
}

export interface ApplyTaskChangeProposalInput {
  commitMessage?: string;
}

export interface TaskInteractiveTerminalTranscript {
  taskId: string;
  sessionId: string;
  content: string;
  truncated: boolean;
}

export interface McpServerConfig {
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  bearerTokenEnvVar?: string | null;
}

export interface GitHubIssueReference {
  number: number;
  title: string;
  url: string;
}

export interface GitHubPullRequestReference {
  number: number;
  title: string;
  url: string;
  headBranch: string;
  baseBranch: string;
}

export interface GitHubBranchReference {
  name: string;
  isDefault: boolean;
}

export type DataStoreBackend = "redis" | "postgres";

export interface SystemDataStores {
  taskStore: DataStoreBackend;
  snippetStore: DataStoreBackend;
  repositoryStore: DataStoreBackend;
  credentialStore: DataStoreBackend;
  roleStore: DataStoreBackend;
  userStore: DataStoreBackend;
  settingsStore: DataStoreBackend;
  taskQueueStore: "redis";
  webhookDeliveryStore: "redis";
  sessionStore: "redis";
  eventBus: "redis";
}

export interface SystemSettings {
  defaultProvider: AgentProvider;
  maxAgents: number;
  branchPrefix: string;
  gitUsername: string;
  mcpServers: McpServerConfig[];
  openaiBaseUrl: string | null;
  githubTokenConfigured: boolean;
  openaiApiKeyConfigured: boolean;
  anthropicApiKeyConfigured: boolean;
  codexDefaultModel: string;
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeDefaultEffort: ProviderProfile;
  dataStores?: SystemDataStores;
}

export interface CreateRepositoryInput {
  name: string;
  url: string;
  defaultBranch?: string;
  envVars?: RepositoryEnvVar[];
  webhookUrl?: string | null;
  webhookEnabled?: boolean;
  webhookSecret?: string;
}

export interface UpdateRepositoryInput {
  name?: string;
  url?: string;
  defaultBranch?: string;
  envVars?: RepositoryEnvVar[];
  webhookUrl?: string | null;
  webhookEnabled?: boolean;
  webhookSecret?: string;
  clearWebhookSecret?: boolean;
}

export interface CreateTaskInput {
  title: string;
  repoId: string;
  prompt: string;
  attachments?: CreateTaskPromptAttachmentInput[];
  taskType?: TaskType;
  /** Default `run_now`. `prepare_workspace` clones/checks out only (no agent run). `idle` is accepted for API compatibility but not offered in the UI. */
  startMode?: TaskStartMode;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export type TaskSourceType = "blank" | "issue" | "pull_request";

export interface BlankTaskDefinitionInput {
  sourceType: "blank";
  title: string;
  repoId: string;
  prompt: string;
  attachments?: CreateTaskPromptAttachmentInput[];
  taskType: TaskType;
  startMode?: TaskStartMode;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
}

export interface IssueTaskDefinitionInput {
  sourceType: "issue";
  title?: string;
  repoId: string;
  issueNumber: number;
  includeComments: boolean;
  taskType: Extract<TaskType, "build" | "ask">;
  startMode?: TaskStartMode;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
}

export interface PullRequestTaskDefinitionInput {
  sourceType: "pull_request";
  title?: string;
  repoId: string;
  pullRequestNumber: number;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
}

export type TaskDefinitionInput = BlankTaskDefinitionInput | IssueTaskDefinitionInput | PullRequestTaskDefinitionInput;

export interface Snippet {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSnippetInput {
  name: string;
  content: string;
}

export interface UpdateSnippetInput {
  name: string;
  content: string;
}

export interface CreateTaskFromIssueInput {
  repoId: string;
  issueNumber: number;
  includeComments?: boolean;
  taskType?: Extract<TaskType, "build" | "ask">;
  startMode?: TaskStartMode;
  title?: string;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export interface CreateTaskFromPullRequestInput {
  repoId: string;
  pullRequestNumber: number;
  title?: string;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export interface TriggerTaskActionInput {
  action: TaskAction;
}

export interface UpdateTaskConfigInput {
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string | null;
  branchStrategy?: TaskBranchStrategy;
}

export interface UpdateTaskPinInput {
  pinned: boolean;
}

export interface UpdateTaskTitleInput {
  title: string;
}

export interface CreateTaskMessageInput {
  content: string;
  contextEntries?: TaskContextEntry[];
  attachments?: CreateTaskPromptAttachmentInput[];
  action?: TaskMessageAction;
}

export interface UpdateTaskMessageInput {
  content: string;
}

export interface UpdateTaskWorkspaceFileInput {
  path: string;
  content: string;
}

export interface MergeTaskInput {
  targetBranch: string;
  commitMessage?: string;
}

export const getTaskBranchStrategyLabel = (strategy: TaskBranchStrategy): string =>
  ({
    feature_branch: "Create Feature Branch",
    work_on_branch: "Work On Existing Branch"
  })[strategy];

export const getAgentProviderLabel = (provider: AgentProvider): string =>
  ({
    codex: "Codex",
    claude: "Claude Code (experimental)"
  })[provider];

export const getProviderProfileLabel = (profile: ProviderProfile): string =>
  ({
    low: "Low",
    medium: "Medium",
    high: "High",
    max: "Max"
  })[profile];

export const getTaskTypeLabel = (taskType: TaskType): string =>
  ({
    build: "Build",
    ask: "Ask"
  })[taskType];

const queuedStatusByAction: Record<TaskAction, TaskStatus> = {
  build: "build_queued",
  ask: "ask_queued"
};

const activeStatusByAction: Record<TaskAction, TaskStatus> = {
  build: "building",
  ask: "asking"
};

const successfulStatusByAction: Record<TaskAction, TaskStatus> = {
  build: "completed",
  ask: "answered"
};

export const getQueuedStatusForAction = (action: TaskAction): TaskStatus => queuedStatusByAction[action];
export const getActiveStatusForAction = (action: TaskAction): TaskStatus => activeStatusByAction[action];
export const getSuccessfulStatusForAction = (action: TaskAction): TaskStatus => successfulStatusByAction[action];

export const isQueuedTaskStatus = (status: TaskStatus): boolean =>
  status === "build_queued" ||
  status === "ask_queued";

export const isActiveTaskStatus = (status: TaskStatus): boolean =>
  status === "preparing_workspace" ||
  status === "building" ||
  status === "asking";

export const isTaskWorking = (task: Pick<Task, "status" | "activeInteractiveSession">): boolean =>
  isActiveTaskStatus(task.status) || task.activeInteractiveSession === true;

export const getTaskTerminalSessionLabel = (mode: TaskTerminalSessionMode): string =>
  mode === "git" ? "Git Terminal" : "Interactive Terminal";

export const getTaskTerminalSessionSentenceLabel = (mode: TaskTerminalSessionMode): string =>
  mode === "git" ? "Git terminal" : "Interactive terminal";

export const getTaskTerminalSessionStartMessage = (mode: TaskTerminalSessionMode): string =>
  mode === "git" ? "Terminal session started." : `${getTaskTerminalSessionSentenceLabel(mode)} session started.`;

export const getTaskTerminalSessionEndMessage = (mode: TaskTerminalSessionMode): string =>
  `${getTaskTerminalSessionSentenceLabel(mode)} session ended.`;

export const getTaskTerminalSessionNoChangesMessage = (mode: TaskTerminalSessionMode): string =>
  `${getTaskTerminalSessionSentenceLabel(mode)} session ended. No workspace changes were detected.`;

export const getTaskTerminalSessionReviewMessage = (mode: TaskTerminalSessionMode): string =>
  `${getTaskTerminalSessionSentenceLabel(mode)} session ended. Review proposed changes below.`;

/** When set, checkpoint apply / reject / revert must be refused (agent run queued or in progress). */
export function getCheckpointMutationBlockedReason(status: TaskStatus): string | null {
  if (isQueuedTaskStatus(status) || isActiveTaskStatus(status)) {
    return `Checkpoint actions are unavailable while the task is “${getTaskStatusLabel(status)}”.`;
  }
  return null;
}

export const isTerminalTaskStatus = (status: TaskStatus): boolean =>
  status === "archived";
export const getTaskStatusLabel = (status: TaskStatus): string =>
  ({
    build_queued: "Build Queued",
    preparing_workspace: "Preparing Workspace",
    building: "Building",
    ask_queued: "Ask Queued",
    asking: "Answering",
    open: "Open",
    awaiting_review: "Awaiting Review",
    completed: "Completed",
    answered: "Answered",
    accepted: "Accepted",
    archived: "Archived",
    cancelled: "Cancelled",
    failed: "Failed"
  })[status];

export interface UpdateSettingsInput {
  defaultProvider?: AgentProvider;
  maxAgents?: number;
  branchPrefix?: string;
  gitUsername?: string;
  mcpServers?: McpServerConfig[];
  openaiBaseUrl?: string | null;
  codexDefaultModel?: string;
  codexDefaultEffort?: ProviderProfile;
  claudeDefaultModel?: string;
  claudeDefaultEffort?: ProviderProfile;
}

export interface UpdateCredentialSettingsInput {
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  clearGithubToken?: boolean;
  clearOpenAiApiKey?: boolean;
  clearAnthropicApiKey?: boolean;
}

export interface TaskEvent {
  type: "task:created" | "task:updated";
  payload: Task;
}

export interface TaskDeletedEvent {
  type: "task:deleted";
  payload: {
    id: string;
    repoId: string;
    ownerUserId: string | null;
  };
}

export interface TaskLogEvent {
  type: "task:log";
  payload: {
    taskId: string;
    runId?: string | null;
    line: string;
    timestamp: string;
  };
}

export interface TaskMessageEvent {
  type: "task:message";
  payload: TaskMessage;
}

export interface TaskMessageUpdatedEvent {
  type: "task:message_updated";
  payload: TaskMessage;
}

export interface TaskRunEvent {
  type: "task:run_updated";
  payload: TaskRun;
}

export interface TaskChangeProposalEvent {
  type: "task:change_proposal";
  payload: TaskChangeProposal;
}

export interface TaskPushedEvent {
  type: "task:pushed";
  payload: {
    taskId: string;
    repoId: string;
    branchName: string;
    commitMessage: string | null;
    triggeredAt: string;
  };
}

export interface TaskMergedEvent {
  type: "task:merged";
  payload: {
    taskId: string;
    repoId: string;
    sourceBranch: string;
    targetBranch: string;
    commitMessage: string | null;
    triggeredAt: string;
  };
}

export interface SettingsEvent {
  type: "settings:updated";
  payload: SystemSettings;
}

export interface RepositoryEvent {
  type: "repository:created" | "repository:updated" | "repository:deleted";
  payload: Repository | { id: string };
}

export interface SnippetEvent {
  type: "snippet:created" | "snippet:updated" | "snippet:deleted";
  payload: Snippet | { id: string };
}

export type RealtimeEvent =
  | TaskEvent
  | TaskDeletedEvent
  | TaskLogEvent
  | TaskMessageEvent
  | TaskMessageUpdatedEvent
  | TaskRunEvent
  | TaskChangeProposalEvent
  | TaskPushedEvent
  | TaskMergedEvent
  | SettingsEvent
  | RepositoryEvent
  | SnippetEvent;
