export type TaskQueueMode = "manual" | "auto";
export type TaskMode = TaskQueueMode;
export type TaskType = "plan" | "build" | "review" | "ask";
export type TaskReviewVerdict = "approved" | "changes_requested";
export type AgentProvider = "codex" | "claude";
export type ProviderProfile = "quick" | "balanced" | "deep" | "super_deep" | "unlimited";
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
  | "cancelled"
  | "failed";

export type TaskAction = "plan" | "build" | "iterate" | "review" | "ask";
export type TaskMessageAction = TaskAction | "comment";
export type TaskReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type TaskComplexity = "trivial" | "normal" | "complex";
export type TaskPlanningMode = "direct-build" | "plan-first";
export type TaskBranchStrategy = "feature_branch" | "work_on_branch";
export type McpServerTransport = "stdio" | "http";

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
    quick: "Quick",
    balanced: "Balanced",
    deep: "Deep",
    super_deep: "Super Deep",
    unlimited: "Unlimited"
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
  status === "accepted" || status === "cancelled" || status === "failed";
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
