export type TaskType = "build" | "ask";
export type AgentProvider = "codex" | "claude";

export const DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS = [
  "If the feedback is a question without a clear requested code or file change, reply on GitHub asking for confirmation or a follow-up before changing files.",
  "",
  "After handling this feedback, reply on GitHub at the URL above with a brief status."
].join("\n");

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
  { label: "GPT-5.5", value: "gpt-5.5" },
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "GPT-5.4 mini", value: "gpt-5.4-mini" },
  { label: "GPT-5.4 nano", value: "gpt-5.4-nano" },
  { label: "o3", value: "o3" },
  { label: "o4-mini", value: "o4-mini" },
  { label: "o3-mini", value: "o3-mini" },
  { label: "GPT-4.1", value: "gpt-4.1" },
  { label: "GPT-4o", value: "gpt-4o" }
];

export const CLAUDE_MODELS: ProviderModelOption[] = [
  { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
  { label: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  { label: "Claude Opus 4.5", value: "claude-opus-4-5" },
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
  provider === "claude" ? "claude-opus-4-8" : "gpt-5.5";
export type TaskMessageRole = "user" | "assistant" | "system";
export type TaskRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type TaskStatus =
  | "draft"
  | "build_queued"
  | "preparing_workspace"
  | "building"
  | "ask_queued"
  | "asking"
  | "open"
  | "in_progress"
  | "in_review"
  | "awaiting_review"
  | "done"
  | "completed"
  | "answered"
  | "accepted"
  | "archived"
  | "cancelled"
  | "failed";

export type TaskWorkflowStatus = "backlog" | "ready" | "in_progress" | "review" | "done" | "archived";
export type TaskExecutionStatus = "idle" | "queued" | "preparing" | "running" | "failed" | "cancelled";
export type TaskReviewReason = "checkpoint" | "answer" | "manual" | "merge" | null;
export type TaskAction = "build" | "ask";
export type TaskExecutionAction = TaskAction | "terminal" | null;
export type TaskMessageAction = TaskAction | "comment";
export const TASK_PROMPT_ATTACHMENT_MAX_COUNT = 6;
export const TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES = 6 * 1024 * 1024;
export const TASK_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
/** @deprecated Use ProviderProfile instead. Kept for Redis migration in task-store. */
export type TaskReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type TaskComplexity = "trivial" | "normal" | "complex";
export type TaskBranchStrategy = "feature_branch" | "work_on_branch";
export type AudienceType = "technical" | "non_technical" | "mixed";
export type AgentResponseStyle = Extract<AudienceType, "technical" | "non_technical">;
export type AgentExplanationDepth = "one_line" | "brief" | "standard" | "detailed" | "deep_dive";
export type AgentJargonLevel = "avoid" | "balanced" | "expert";
export type AgentCodePreference = "only_when_needed" | "prefer_examples" | "avoid_code";
export type AgentClarifyBehavior = "ask_when_ambiguous" | "make_reasonable_assumptions";
export type AgentFormattingStyle = "direct" | "teaching" | "executive" | "step_by_step" | "checklist" | "qa" | "problem_solution";

export interface AgentResponsePolicy {
  audience?: AudienceType;
  explanationDepth?: AgentExplanationDepth;
  jargonLevel?: AgentJargonLevel;
  codePreference?: AgentCodePreference;
  clarifyBehavior?: AgentClarifyBehavior;
  formattingStyle?: AgentFormattingStyle;
  extraInstructions?: string;
}

export type AgentResponsePreference = AgentResponsePolicy;

export interface ResponsePreferencePreset {
  id: string;
  name: string;
  description: string;
  preference: AgentResponsePreference;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResponsePreferencePresetInput {
  id?: string;
  name: string;
  description?: string;
  preference: AgentResponsePolicy;
}

export type McpServerTransport = "stdio" | "http";
export type PermissionScope =
  | "task:list"
  | "task:create"
  | "task:read"
  | "task:edit"
  | "task:build"
  | "task:ask"
  | "task:terminal"
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
  "task:terminal",
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

export const LEGACY_PERMISSION_SCOPE_ALIASES: Record<string, PermissionScope> = {
  "task:interactive": "task:terminal"
};

export const normalizePermissionScope = (scope: string): PermissionScope | null => {
  const normalized = LEGACY_PERMISSION_SCOPE_ALIASES[scope.trim()] ?? scope.trim();
  return ALL_PERMISSION_SCOPES.includes(normalized as PermissionScope) ? (normalized as PermissionScope) : null;
};

export interface PermissionScopeGroup {
  label: string;
  scopes: PermissionScope[];
}

export const PERMISSION_SCOPE_GROUPS: PermissionScopeGroup[] = [
  { label: "Tasks", scopes: ["task:list", "task:create", "task:read", "task:edit", "task:build", "task:ask", "task:terminal", "task:delete"] },
  { label: "Snippets", scopes: ["snippet:list", "snippet:create", "snippet:read", "snippet:edit", "snippet:delete"] },
  { label: "Repositories", scopes: ["repo:list", "repo:read", "repo:create", "repo:edit", "repo:delete"] },
  { label: "Settings", scopes: ["settings:read", "settings:edit"] },
  { label: "Users", scopes: ["user:list", "user:create", "user:read", "user:edit", "user:delete"] }
];

export type TaskCapabilityScope = Extract<PermissionScope, "task:build" | "task:ask">;

export const getTaskCapabilityScopeForTaskType = (taskType: TaskType): TaskCapabilityScope =>
  taskType === "ask" ? "task:ask" : "task:build";

export const getTaskCapabilityScopeForTaskAction = (action: TaskAction): TaskCapabilityScope =>
  action === "ask" ? "task:ask" : "task:build";

export const getRequiredTaskCapabilityScopes = (input: { taskType?: TaskType }): TaskCapabilityScope[] => [
  getTaskCapabilityScopeForTaskType(input.taskType ?? "build")
];

export const hasRequiredTaskCapabilities = (
  grantedScopes: Iterable<PermissionScope>,
  input: { taskType?: TaskType }
): boolean => {
  const granted = new Set(grantedScopes);
  return getRequiredTaskCapabilityScopes(input).every((scope) => granted.has(scope));
};

export const getRequiredTaskCapabilityScopesForDefinition = (definition: TaskDefinitionInput): TaskCapabilityScope[] =>
  getRequiredTaskCapabilityScopes({
    taskType: definition.taskType
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
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  active: boolean;
  agentResponsePreference: AgentResponsePreference;
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
  codexAuthJsonConfigured?: boolean;
}

export interface AuthSession {
  user: AuthSessionUser;
  expiresAt: string;
}

export interface AuthProfile {
  name: string;
  email: string;
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  agentResponsePreference: AgentResponsePreference;
  codexAuthJsonConfigured: boolean;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  scopes: PermissionScope[];
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedPersonalAccessToken extends PersonalAccessToken {
  token: string;
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
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  password: string;
  active?: boolean;
  roleIds?: string[];
  repositoryIds?: string[];
  agentResponsePreference?: Partial<AgentResponsePreference>;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  password?: string;
  active?: boolean;
  roleIds?: string[];
  repositoryIds?: string[];
  agentResponsePreference?: Partial<AgentResponsePreference>;
}

export interface RepositoryEnvVar {
  key: string;
  type?: "text";
  value: string;
}

export interface RepositoryEnvFile {
  key: string;
  type: "file";
  configured: boolean;
  fileName?: string;
}

export type RepositoryEnvVarValue = RepositoryEnvVar | RepositoryEnvFile;

export interface RepositoryEnvVarInputText {
  key: string;
  type?: "text";
  value: string;
}

export interface RepositoryEnvVarInputFile {
  key: string;
  type: "file";
  fileName?: string;
  fileContentBase64?: string;
}

export type RepositoryEnvVarInput = RepositoryEnvVarInputText | RepositoryEnvVarInputFile;

export interface RepositoryEnvSecret {
  key: string;
  configured: boolean;
  type?: "text" | "file";
  fileName?: string;
}

export interface RepositoryEnvSecretInputText {
  key: string;
  type?: "text";
  value?: string;
}

export interface RepositoryEnvSecretInputFile {
  key: string;
  type: "file";
  fileName?: string;
  fileContentBase64?: string;
}

export type RepositoryEnvSecretInput = RepositoryEnvSecretInputText | RepositoryEnvSecretInputFile;

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  envVars: RepositoryEnvVarValue[];
  envSecrets?: RepositoryEnvSecret[];
  webhookUrl: string | null;
  webhookEnabled: boolean;
  webhookSecretConfigured: boolean;
  githubPrWebhookSecretConfigured?: boolean;
  githubIntegrationBotLogin?: string | null;
  githubPrAllowedUsers?: string[];
  githubPrRequireBotMention?: boolean;
  githubPrFeedbackInstructions?: string | null;
  githubPrTaskOwnerUserId?: string | null;
  webhookLastAttemptAt: string | null;
  webhookLastStatus: "success" | "failed" | null;
  webhookLastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskTerminalSessionMode = "terminal";
export type CodexCredentialSource = "auto" | "profile" | "global";

export interface TaskLinkedWorkspace {
  taskId: string;
  alias: string;
  title: string;
  repoName: string;
  linkedAt: string;
  linkedByUserId: string;
}

export interface Task {
  id: string;
  title: string;
  deadline: string | null;
  pinned: boolean;
  hasPendingCheckpoint: boolean;
  autoApplyCheckpoints: boolean;
  activeInteractiveSession?: boolean;
  activeTerminalSessionMode?: TaskTerminalSessionMode | null;
  linkedWorkspaces?: TaskLinkedWorkspace[];
  ownerUserId: string | null;
  creatorName?: string | null;
  repoId: string;
  repoName: string;
  repoUrl: string;
  repoDefaultBranch: string;
  githubPrNumber?: number | null;
  taskType: TaskType;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  codexCredentialSource?: CodexCredentialSource;
  taskSource?: "blank" | "snippet";
  snippetId?: string;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
  complexity: TaskComplexity;
  branchName: string | null;
  workspaceBaseRef: string | null;
  prompt: string;
  notes?: string;
  resultMarkdown: string | null;
  executionSummary: string;
  branchDiff: string | null;
  pullCount?: number;
  pushCount?: number;
  lastAction: TaskAction | null;
  status: TaskStatus;
  workflowStatus: TaskWorkflowStatus;
  executionStatus: TaskExecutionStatus;
  executionAction: TaskExecutionAction;
  reviewReason: TaskReviewReason;
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

export interface TaskPromptMagicInput {
  prompt: string;
}

export interface TaskPromptMagicResult {
  prompt: string;
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
  /** True when this commit is already reachable from the task branch on origin. */
  isPushed: boolean;
}

export interface TaskWorkspaceCommitLog {
  commits: TaskWorkspaceCommit[];
  fetchedAt: string;
  message: string | null;
}

export type TaskWorkspaceFileTreeEntryKind = "file" | "directory";

export interface TaskWorkspaceFileTreeEntry {
  path: string;
  name: string;
  kind: TaskWorkspaceFileTreeEntryKind;
}

export interface TaskWorkspaceFileTree {
  /** Directory prefix that was listed; null means workspace root. */
  prefix: string | null;
  entries: TaskWorkspaceFileTreeEntry[];
  fetchedAt: string;
  truncated: boolean;
  totalCount: number;
}

export interface TaskWorkspaceFileSearchResult {
  query: string;
  results: string[];
  fetchedAt: string;
  truncated: boolean;
  totalCount: number;
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

export interface TaskGitStateSnapshot {
  fetchedAt: string;
  pullCount: number;
  pushCount: number;
  pushPreview: TaskPushPreview;
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
  queueState?: "pending" | null;
  queueSource?: "user" | "github_pr" | null;
  externalId?: string | null;
  /** Optional saved image attachments that were attached when the user submitted this message. */
  attachments?: TaskPromptAttachment[];
  /** Present for terminal lifecycle messages so history can address the terminal session. */
  sessionId?: string | null;
  createdAt: string;
}

export interface TaskExecutionInput {
  content: string;
  attachments?: TaskPromptAttachment[];
}

export type NormalizedAgentEventKind =
  | "run.started"
  | "run.status"
  | "run.completed"
  | "run.failed"
  | "turn.started"
  | "turn.completed"
  | "assistant.message"
  | "assistant.message.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "file.changed"
  | "subtask.started"
  | "subtask.progress"
  | "subtask.completed"
  | "usage.reported"
  | "unknown";

export interface NormalizedAgentEvent {
  id: string;
  provider: AgentProvider;
  kind: NormalizedAgentEventKind;
  rawEventIndex: number;
  title: string;
  detail?: string;
  message?: string;
  status?: string;
  sessionId?: string;
  messageId?: string;
  toolCallId?: string;
  parentToolCallId?: string | null;
  toolName?: string;
  filePath?: string;
  fileChangeKind?: string;
  exitCode?: number | null;
  usage?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

export interface TaskRun {
  id: string;
  taskId: string;
  action: TaskAction;
  promptMessageId?: string | null;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | null;
  branchName: string | null;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  /** Build-only outcome. Null for ask runs and legacy runs. */
  changeOutcome?: "changed" | "no_change" | null;
  errorMessage: string | null;
  /** Git HEAD ref captured before the agent container runs; used for change proposals. */
  changeProposalCheckpointRef?: string | null;
  /** Untracked paths (repo-relative) at checkpoint; used so reject does not wipe pre-existing untracked files. */
  changeProposalUntrackedPaths?: string[] | null;
  /** True when the provider's native JSONL stream has been captured for this run. */
  hasRawJson?: boolean;
  timelineEvents?: NormalizedAgentEvent[];
  logs: string[];
}

export type TaskGitOperationType = "clone_for_task" | "pull_task_branch" | "push_task_branch";
export type TaskGitOperationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type TaskGitOperationFailureCode =
  | "auth_failed"
  | "network_error"
  | "branch_missing"
  | "conflict"
  | "nothing_to_push"
  | "workspace_missing"
  | "unknown";

export interface TaskGitOperation {
  operationId: string;
  taskId: string;
  operationType: TaskGitOperationType;
  status: TaskGitOperationStatus;
  startedAt: string;
  finishedAt: string | null;
  errorCode: TaskGitOperationFailureCode | null;
  errorMessage: string | null;
  attemptCount: number;
}

export type TaskChangeProposalSourceType = "build_run" | "interactive_session";

export type TaskChangeProposalStatus = "pending" | "applying" | "applied" | "rejected" | "reverted";

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

export interface RevertTaskChangeProposalFileInput {
  path: string;
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
  env?: Record<string, string>;
  url?: string | null;
  bearerTokenEnvVar?: string | null;
}

export type DataStoreBackend = "redis" | "postgres";
export type WorkspaceProvisioningMode = "clone_only" | "hybrid";

export interface SystemDataStores {
  taskStore: "postgres";
  snippetStore: "postgres";
  repositoryStore: "postgres";
  credentialStore: "postgres";
  roleStore: "postgres";
  userStore: "postgres";
  settingsStore: "postgres";
  taskQueueStore: "redis";
  webhookDeliveryStore: "redis";
  sessionStore: "redis";
  eventBus: "redis";
}

export interface SystemSettings {
  defaultProvider: AgentProvider;
  maxAgents: number;
  branchPrefix: string;
  workspaceProvisioningMode: WorkspaceProvisioningMode;
  gitUsername: string;
  mcpServers: McpServerConfig[];
  openaiBaseUrl: string | null;
  taskPromptMagicModel: string;
  taskPromptMagicTemplate: string;
  githubTokenConfigured: boolean;
  openaiApiKeyConfigured: boolean;
  codexAuthJsonConfigured: boolean;
  anthropicApiKeyConfigured: boolean;
  codexDefaultModel: string;
  codexModels: ProviderModelOption[];
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeModels: ProviderModelOption[];
  claudeDefaultEffort: ProviderProfile;
  responsePreferencePresets: ResponsePreferencePreset[];
  dataStores?: SystemDataStores;
}

export interface UserNotes {
  notes: string;
  updatedAt: string;
}

export interface CreateRepositoryInput {
  name: string;
  url: string;
  defaultBranch?: string;
  envVars?: RepositoryEnvVarInput[];
  envSecrets?: RepositoryEnvSecretInput[];
  webhookUrl?: string | null;
  webhookEnabled?: boolean;
  webhookSecret?: string;
  githubPrWebhookSecret?: string;
  githubIntegrationBotLogin?: string | null;
  githubPrAllowedUsers?: string[];
  githubPrRequireBotMention?: boolean;
  githubPrFeedbackInstructions?: string | null;
  githubPrTaskOwnerUserId?: string | null;
}

export interface UpdateRepositoryInput {
  name?: string;
  url?: string;
  defaultBranch?: string;
  envVars?: RepositoryEnvVarInput[];
  envSecrets?: RepositoryEnvSecretInput[];
  webhookUrl?: string | null;
  webhookEnabled?: boolean;
  webhookSecret?: string;
  clearWebhookSecret?: boolean;
  githubPrWebhookSecret?: string;
  clearGithubPrWebhookSecret?: boolean;
  githubIntegrationBotLogin?: string | null;
  githubPrAllowedUsers?: string[];
  githubPrRequireBotMention?: boolean;
  githubPrFeedbackInstructions?: string | null;
  githubPrTaskOwnerUserId?: string | null;
}

export interface CreateTaskInput {
  title: string;
  draft?: boolean;
  deadline?: string | null;
  repoId: string;
  prompt: string;
  notes?: string;
  attachments?: CreateTaskPromptAttachmentInput[];
  taskType?: TaskType;
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  codexCredentialSource?: CodexCredentialSource;
  baseBranch?: string;
  branchStrategy?: TaskBranchStrategy;
  autoApplyCheckpoints?: boolean;
  model?: string;
  reasoningEffort?: TaskReasoningEffort;
}

export interface TaskDefinitionInput {
  title: string;
  deadline?: string | null;
  repoId: string;
  prompt: string;
  notes?: string;
  attachments?: CreateTaskPromptAttachmentInput[];
  taskType: TaskType;
  provider: AgentProvider;
  model: string;
  providerProfile: ProviderProfile;
  codexCredentialSource?: CodexCredentialSource;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  variables: SnippetVariable[];
  createdAt: string;
  updatedAt: string;
}

export type SnippetVariableType = "text" | "multiline";

export interface SnippetVariable {
  name: string;
  type: SnippetVariableType;
  title: string;
  description: string;
  defaultValue: string;
}

export interface CreateSnippetInput {
  name: string;
  content: string;
  variables?: SnippetVariable[];
}

export interface UpdateSnippetInput {
  name: string;
  content: string;
  variables?: SnippetVariable[];
}

export interface TriggerTaskActionInput {
  action: TaskAction;
}

export interface UpdateTaskConfigInput {
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string | null;
  codexCredentialSource?: CodexCredentialSource;
  branchStrategy?: TaskBranchStrategy;
  autoApplyCheckpoints?: boolean;
}

export interface UpdateTaskPinInput {
  pinned: boolean;
}

export interface UpdateTaskTitleInput {
  title: string;
}

export interface UpdateTaskNotesInput {
  notes: string;
}

export interface UpdateTaskDeadlineInput {
  deadline: string | null;
}

export interface UpdateTaskDraftInput {
  title: string;
  deadline: string | null;
  prompt: string;
  notes?: string;
  taskType: TaskType;
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride?: string | null;
  codexCredentialSource?: CodexCredentialSource;
  baseBranch: string;
  branchStrategy: TaskBranchStrategy;
}

export interface UpdateUserNotesInput {
  notes: string;
}

export interface UpdateTaskStateInput {
  status: Extract<TaskWorkflowStatus, "backlog" | "ready" | "in_progress" | "review" | "done">;
}

export interface UpdateTaskAssigneeInput {
  ownerUserId: string;
}

export interface UpdateTaskPullRequestInput {
  githubPrNumber: number | null;
}

export interface CreateTaskMessageInput {
  content: string;
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
  deleteRemoteBranch?: boolean;
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

export const isTaskWorking = (task: Pick<Task, "status" | "activeInteractiveSession"> & { executionStatus?: TaskExecutionStatus }): boolean =>
  task.executionStatus === "queued" ||
  task.executionStatus === "preparing" ||
  task.executionStatus === "running" ||
  isActiveTaskStatus(task.status) ||
  task.activeInteractiveSession === true;

export const getTaskExecutionStatus = (
  task: Pick<Task, "status" | "activeInteractiveSession"> & { executionStatus?: TaskExecutionStatus }
): TaskExecutionStatus => {
  if (task.activeInteractiveSession === true) {
    return "running";
  }

  if (
    task.executionStatus === "idle" ||
    task.executionStatus === "queued" ||
    task.executionStatus === "preparing" ||
    task.executionStatus === "running" ||
    task.executionStatus === "failed" ||
    task.executionStatus === "cancelled"
  ) {
    return task.executionStatus;
  }

  if (isQueuedTaskStatus(task.status)) {
    return "queued";
  }

  if (task.status === "preparing_workspace") {
    return "preparing";
  }

  if (isActiveTaskStatus(task.status)) {
    return "running";
  }

  if (task.status === "failed") {
    return "failed";
  }

  if (task.status === "cancelled") {
    return "cancelled";
  }

  return "idle";
};

export const getTaskExecutionAction = (
  task: Pick<Task, "status" | "lastAction" | "activeInteractiveSession" | "activeTerminalSessionMode"> & { executionAction?: TaskExecutionAction }
): TaskExecutionAction => {
  if (task.activeInteractiveSession === true) {
    return "terminal";
  }

  if (task.status === "draft") {
    return null;
  }

  const executionAction = task.executionAction as string | null | undefined;
  if (executionAction === "build" || executionAction === "ask" || executionAction === "terminal") {
    return executionAction;
  }
  if (executionAction === "interactive") {
    return "terminal";
  }

  if (task.status === "build_queued" || task.status === "preparing_workspace" || task.status === "building") {
    return "build";
  }

  if (task.status === "ask_queued" || task.status === "asking") {
    return "ask";
  }

  return task.lastAction ?? null;
};

export const getTaskReviewReason = (task: Pick<Task, "status" | "hasPendingCheckpoint" | "taskType">): TaskReviewReason => {
  if (task.hasPendingCheckpoint || task.status === "awaiting_review") {
    return "checkpoint";
  }

  if (task.status === "in_review") {
    return task.taskType === "ask" ? "answer" : "manual";
  }

  return null;
};

export const getTaskWorkflowStatus = (task: Pick<Task, "status" | "hasPendingCheckpoint" | "taskType">): TaskWorkflowStatus => {
  if (task.status === "archived") {
    return "archived";
  }

  if (task.status === "done" || task.status === "accepted") {
    return "done";
  }

  if (task.status === "in_progress") {
    return "in_progress";
  }

  if (task.status === "awaiting_review" || task.status === "in_review") {
    return "review";
  }

  if (task.status === "draft") {
    return "backlog";
  }

  return "ready";
};

export const getTaskTerminalSessionLabel = (_mode: TaskTerminalSessionMode): string =>
  "Terminal";

export const getTaskTerminalSessionSentenceLabel = (_mode: TaskTerminalSessionMode): string =>
  "Terminal";

export const getTaskTerminalSessionStartMessage = (mode: TaskTerminalSessionMode): string =>
  `${getTaskTerminalSessionSentenceLabel(mode)} session started.`;

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
    draft: "Draft",
    build_queued: "Build Queued",
    preparing_workspace: "Preparing Workspace",
    building: "Building",
    ask_queued: "Ask Queued",
    asking: "Answering",
    open: "Open",
    in_progress: "In Progress",
    in_review: "In Review",
    awaiting_review: "Awaiting Review",
    done: "Done",
    completed: "Completed",
    answered: "Answered",
    accepted: "Accepted",
    archived: "Archived",
    cancelled: "Cancelled",
    failed: "Failed"
  })[status];

export const getTaskWorkflowStatusLabel = (status: TaskWorkflowStatus): string =>
  ({
    backlog: "Backlog",
    ready: "Ready",
    in_progress: "In Progress",
    review: "Review",
    done: "Done",
    archived: "Archived"
  })[status];

export const getTaskExecutionStatusLabel = (status: TaskExecutionStatus): string =>
  ({
    idle: "Idle",
    queued: "Queued",
    preparing: "Preparing",
    running: "Running",
    failed: "Failed",
    cancelled: "Cancelled"
  })[status];

export interface UpdateSettingsInput {
  defaultProvider?: AgentProvider;
  maxAgents?: number;
  branchPrefix?: string;
  workspaceProvisioningMode?: WorkspaceProvisioningMode;
  gitUsername?: string;
  mcpServers?: McpServerConfig[];
  openaiBaseUrl?: string | null;
  taskPromptMagicModel?: string;
  taskPromptMagicTemplate?: string;
  codexDefaultModel?: string;
  codexModels?: ProviderModelOption[];
  codexDefaultEffort?: ProviderProfile;
  claudeDefaultModel?: string;
  claudeModels?: ProviderModelOption[];
  claudeDefaultEffort?: ProviderProfile;
  responsePreferencePresets?: ResponsePreferencePresetInput[];
}

export interface UpdateCredentialSettingsInput {
  githubToken?: string;
  openaiApiKey?: string;
  codexAuthJson?: string;
  anthropicApiKey?: string;
  clearGithubToken?: boolean;
  clearOpenAiApiKey?: boolean;
  clearCodexAuthJson?: boolean;
  clearAnthropicApiKey?: boolean;
}

export interface UpdateAuthProfileInput {
  name?: string;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  codexAuthJson?: string;
  clearCodexAuthJson?: boolean;
  agentResponsePreference?: Partial<AgentResponsePreference>;
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

export interface TaskMessageDeletedEvent {
  type: "task:message_deleted";
  payload: {
    taskId: string;
    messageId: string;
  };
}

export interface TaskRunEvent {
  type: "task:run_updated";
  payload: TaskRun;
}

export interface TaskGitOperationEvent {
  type: "task:git_operation";
  payload: TaskGitOperation;
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
  | TaskMessageDeletedEvent
  | TaskRunEvent
  | TaskGitOperationEvent
  | TaskChangeProposalEvent
  | TaskPushedEvent
  | TaskMergedEvent
  | SettingsEvent
  | RepositoryEvent
  | SnippetEvent;
