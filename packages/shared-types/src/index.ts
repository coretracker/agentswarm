export type TaskQueueMode = "manual" | "auto";
export type TaskMode = TaskQueueMode;
export type TaskType = "plan" | "build" | "review" | "ask";
export type TaskReviewVerdict = "approved" | "changes_requested";
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

/** Claude supports low / medium / high / max effort (max = unlimited turns, Opus 4 only). */
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
  | "plan_queued"
  | "planning"
  | "planned"
  | "build_queued"
  | "building"
  | "review_queued"
  | "reviewing"
  | "ask_queued"
  | "asking"
  | "review"
  | "answered"
  | "accepted"
  | "archived"
  | "cancelled"
  | "failed";

export type TaskAction = "plan" | "build" | "iterate" | "review" | "ask";
export type TaskMessageAction = TaskAction | "comment";
/** @deprecated Use ProviderProfile instead. Kept for Redis migration in task-store. */
export type TaskReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type TaskComplexity = "trivial" | "normal" | "complex";
export type TaskPlanningMode = "direct-build" | "plan-first";
export type TaskBranchStrategy = "feature_branch" | "work_on_branch";
export type McpServerTransport = "stdio" | "http";
export type PermissionScope =
  | "task:list"
  | "task:create"
  | "task:read"
  | "task:edit"
  | "task:delete"
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
  "task:delete",
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
  { label: "Tasks", scopes: ["task:list", "task:create", "task:read", "task:edit", "task:delete"] },
  { label: "Repositories", scopes: ["repo:list", "repo:read", "repo:create", "repo:edit", "repo:delete"] },
  { label: "Settings", scopes: ["settings:read", "settings:edit"] },
  { label: "Users", scopes: ["user:list", "user:create", "user:read", "user:edit", "user:delete"] }
];

export interface Role {
  id: string;
  name: string;
  description: string;
  scopes: PermissionScope[];
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
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionUser extends User {
  scopes: PermissionScope[];
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
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  scopes?: PermissionScope[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  active?: boolean;
  roleIds?: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
  roleIds?: string[];
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  plansDir: string;
  rules: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  pinned: boolean;
  repoId: string;
  repoName: string;
  repoUrl: string;
  repoPlansDir: string;
  repoDefaultBranch: string;
  taskType: TaskType;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
  complexity: TaskComplexity;
  planningMode: TaskPlanningMode;
  branchName: string | null;
  currentPlanRunId: string | null;
  builtPlanRunIds: string[];
  workspaceBaseRef: string | null;
  requirements: string;
  planPath: string | null;
  planMarkdown: string | null;
  resultMarkdown: string | null;
  reviewVerdict: TaskReviewVerdict | null;
  executionSummary: string;
  branchDiff: string | null;
  pullCount?: number;
  pushCount?: number;
  latestIterationInput: string | null;
  lastAction: TaskAction | null;
  queueMode: TaskQueueMode;
  status: TaskStatus;
  logs: string[];
  enqueued: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface TaskLiveDiff {
  diff: string | null;
  live: boolean;
  fetchedAt: string;
  message: string | null;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  role: TaskMessageRole;
  content: string;
  action: TaskMessageAction | null;
  createdAt: string;
}

export interface TaskRunTokenUsage {
  status: "available" | "unavailable";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  note?: string | null;
}

export interface TaskRun {
  id: string;
  taskId: string;
  action: TaskAction;
  provider: AgentProvider;
  branchName: string | null;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  errorMessage: string | null;
  tokenUsage: TaskRunTokenUsage | null;
  logs: string[];
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

export interface SystemSettings {
  defaultProvider: AgentProvider;
  maxAgents: number;
  branchPrefix: string;
  gitUsername: string;
  agentRules: string;
  mcpServers: McpServerConfig[];
  openaiBaseUrl: string | null;
  githubTokenConfigured: boolean;
  openaiApiKeyConfigured: boolean;
  anthropicApiKeyConfigured: boolean;
  codexDefaultModel: string;
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeDefaultEffort: ProviderProfile;
}

export interface CreateRepositoryInput {
  name: string;
  url: string;
  defaultBranch?: string;
  plansDir?: string;
  rules?: string;
}

export interface UpdateRepositoryInput {
  name?: string;
  url?: string;
  defaultBranch?: string;
  plansDir?: string;
  rules?: string;
}

export interface CreateTaskInput {
  title: string;
  repoId: string;
  requirements: string;
  taskType?: TaskType;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  queueMode?: TaskQueueMode;
  mode?: TaskMode;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export type TaskSourceType = "blank" | "issue" | "pull_request";

export interface CreateTaskFromIssueInput {
  repoId: string;
  issueNumber: number;
  includeComments?: boolean;
  taskType?: Extract<TaskType, "plan" | "build" | "ask">;
  title?: string;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  queueMode?: TaskQueueMode;
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
  queueMode?: TaskQueueMode;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export interface TriggerTaskActionInput {
  action: TaskAction;
  iterateInput?: string;
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

export interface UpdateTaskPlanInput {
  planMarkdown: string;
}

export interface CreateTaskMessageInput {
  content: string;
  action?: TaskMessageAction;
}

export const getTaskBranchStrategyLabel = (strategy: TaskBranchStrategy): string =>
  ({
    feature_branch: "Create Feature Branch",
    work_on_branch: "Work On Existing Branch"
  })[strategy];

export const getAgentProviderLabel = (provider: AgentProvider): string =>
  ({
    codex: "Codex",
    claude: "Claude Code"
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
    plan: "Plan",
    build: "Build",
    review: "Review",
    ask: "Ask"
  })[taskType];

const queuedStatusByAction: Record<TaskAction, TaskStatus> = {
  plan: "plan_queued",
  iterate: "plan_queued",
  build: "build_queued",
  review: "review_queued",
  ask: "ask_queued"
};

const activeStatusByAction: Record<TaskAction, TaskStatus> = {
  plan: "planning",
  iterate: "planning",
  build: "building",
  review: "reviewing",
  ask: "asking"
};

const successfulStatusByAction: Record<TaskAction, TaskStatus> = {
  plan: "planned",
  iterate: "planned",
  build: "review",
  review: "review",
  ask: "answered"
};

export const getQueuedStatusForAction = (action: TaskAction): TaskStatus => queuedStatusByAction[action];
export const getActiveStatusForAction = (action: TaskAction): TaskStatus => activeStatusByAction[action];
export const getSuccessfulStatusForAction = (action: TaskAction): TaskStatus => successfulStatusByAction[action];

export const isQueuedTaskStatus = (status: TaskStatus): boolean =>
  status === "plan_queued" ||
  status === "build_queued" ||
  status === "review_queued" ||
  status === "ask_queued";

export const isActiveTaskStatus = (status: TaskStatus): boolean =>
  status === "planning" ||
  status === "building" ||
  status === "reviewing" ||
  status === "asking";

export const isTerminalTaskStatus = (status: TaskStatus): boolean =>
  status === "accepted" || status === "archived" || status === "cancelled" || status === "failed";
export const getTaskStatusLabel = (status: TaskStatus): string =>
  ({
    plan_queued: "Plan Queued",
    planning: "Planning",
    planned: "Planned",
    build_queued: "Build Queued",
    building: "Building",
    review_queued: "Review Queued",
    reviewing: "Reviewing",
    ask_queued: "Ask Queued",
    asking: "Answering",
    review: "In Review",
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
  agentRules?: string;
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

export interface TaskRunEvent {
  type: "task:run_updated";
  payload: TaskRun;
}

export interface SettingsEvent {
  type: "settings:updated";
  payload: SystemSettings;
}

export interface RepositoryEvent {
  type: "repository:created" | "repository:updated" | "repository:deleted";
  payload: Repository | { id: string };
}

export type RealtimeEvent = TaskEvent | TaskDeletedEvent | TaskLogEvent | TaskMessageEvent | TaskRunEvent | SettingsEvent | RepositoryEvent;
