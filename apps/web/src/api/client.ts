"use client";

import type {
  AgentProvider,
  AuthProfile,
  AuthSession,
  CreateRoleInput,
  CreateTaskMessageInput,
  CreateRepositoryInput,
  CreateTaskInput,
  CreateUserInput,
  LoginInput,
  CreatedPersonalAccessToken,
  HostexecAvailability,
  PersonalAccessToken,
  PermissionScope,
  ProviderModelOption,
  Repository,
  Role,
  SystemSettings,
  Task,
  OpenAiDiffAssistInput,
  OpenAiDiffAssistResult,
  TaskPromptMagicInput,
  TaskPromptMagicResult,
  TaskLiveDiff,
  TaskGitStateSnapshot,
  TaskWorkspaceFileSearchResult,
  TaskWorkspaceFileTree,
  TaskWorkspaceFilePreview,
  TaskWorkspaceCommitLog,
  TaskPushPreview,
  TaskMergePreview,
  TaskMessage,
  MergeTaskInput,
  ApplyTaskChangeProposalInput,
  RevertTaskChangeProposalFileInput,
  UpdateTaskMessageInput,
  UpdateTaskWorkspaceFileInput,
  TaskRun,
  TaskGitOperation,
  TaskChangeProposal,
  TaskInteractiveTerminalTranscript,
  TaskAction,
  TaskTerminalSessionMode,
  UpdateRoleInput,
  UpdateTaskPinInput,
  UpdateTaskDeadlineInput,
  UpdateTaskDraftInput,
  UpdateTaskAssigneeInput,
  UpdateTaskStateInput,
  UpdateTaskTitleInput,
  UpdateAuthProfileInput,
  UpdateCredentialSettingsInput,
  UpdateTaskConfigInput,
  UpdateTaskIssueInput,
  UpdateTaskPullRequestInput,
  UpdateRepositoryInput,
  UpdateSettingsInput,
  UpdateUserInput,
  User
} from "@verft/shared-types";
export type { TaskWorkspaceFilePreview } from "@verft/shared-types";
import { buildApiUrl } from "../lib/public-url";

export interface ProviderModelsResponse {
  models: ProviderModelOption[];
  source: "api" | "cache" | "fallback";
}

export interface ProviderBaseStateStatus {
  volume: string;
  files: Record<string, boolean>;
}

export interface TaskInteractiveTerminalStatus {
  available: boolean;
  reason?: string;
  /** Server sets this when a terminal WebSocket session is active for the task. */
  activeInteractiveSession?: boolean;
  /** Present when an active session exists for this task. */
  terminalMode?: TaskTerminalSessionMode;
}

export type TaskBranchSyncCounts = Pick<TaskGitStateSnapshot, "pullCount" | "pushCount">;

export interface ListTasksOptions {
  view?: "all" | "active" | "archived";
  limit?: number;
}

export interface HistoryPageOptions {
  before?: string | null;
  beforeId?: string | null;
  limit?: number;
}

export interface HistoryPageResult<T> {
  items: T[];
  hasMore: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw || response.statusText;
    try {
      const parsed = JSON.parse(raw) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      // Keep the raw response body when the server does not return JSON.
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login: (input: LoginInput) =>
    request<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  getProfile: () => request<AuthProfile>("/auth/profile"),
  updateProfile: (input: UpdateAuthProfileInput) =>
    request<AuthProfile>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  logout: () =>
    request<void>("/auth/logout", {
      method: "POST"
    }),
  listPersonalAccessTokens: () => request<PersonalAccessToken[]>("/auth/personal-access-tokens"),
  createPersonalAccessToken: (input: { name: string; scopes?: PermissionScope[]; expiresAt?: string | null }) =>
    request<CreatedPersonalAccessToken>("/auth/personal-access-tokens", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  revokePersonalAccessToken: (id: string) =>
    request<PersonalAccessToken>(`/auth/personal-access-tokens/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  getSession: () => request<AuthSession>("/auth/session"),
  listUsers: () => request<User[]>("/users"),
  getUser: (id: string) => request<User>(`/users/${id}`),
  createUser: (input: CreateUserInput) =>
    request<User>("/users", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateUser: (id: string, input: UpdateUserInput) =>
    request<User>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteUser: (id: string) =>
    request<void>(`/users/${id}`, {
      method: "DELETE"
    }),
  listRoles: () => request<Role[]>("/roles"),
  getRole: (id: string) => request<Role>(`/roles/${id}`),
  createRole: (input: CreateRoleInput) =>
    request<Role>("/roles", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateRole: (id: string, input: UpdateRoleInput) =>
    request<Role>(`/roles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteRole: (id: string) =>
    request<void>(`/roles/${id}`, {
      method: "DELETE"
    }),
  listTasks: (options?: ListTasksOptions) => {
    const params = new URLSearchParams();
    if (options?.view) {
      params.set("view", options.view);
    }
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<Task[]>(`/tasks${query ? `?${query}` : ""}`);
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  linkTaskWorkspace: (id: string, linkedTaskId: string) =>
    request<Task>(`/tasks/${id}/linked-workspaces`, {
      method: "POST",
      body: JSON.stringify({ linkedTaskId })
    }),
  unlinkTaskWorkspace: (id: string, linkedTaskId: string) =>
    request<Task>(`/tasks/${id}/linked-workspaces/${encodeURIComponent(linkedTaskId)}`, {
      method: "DELETE"
    }),
  startTask: (id: string) =>
    request<Task>(`/tasks/${id}/start`, {
      method: "POST"
    }),
  getTaskBranchSyncCounts: (id: string) => request<TaskBranchSyncCounts>(`/tasks/${id}/branch-sync-counts`),
  getTaskGitState: (id: string) => request<TaskGitStateSnapshot>(`/tasks/${id}/git-state`),
  getTaskGitOperation: (id: string) => request<TaskGitOperation | null>(`/tasks/${id}/git-operation`),
  getTaskInteractiveTerminalStatus: (id: string, options?: { mode?: TaskTerminalSessionMode }) => {
    const params = new URLSearchParams();
    if (options?.mode) {
      params.set("mode", options.mode);
    }
    const query = params.toString();
    return request<TaskInteractiveTerminalStatus>(`/tasks/${id}/terminal/status${query ? `?${query}` : ""}`);
  },
  getTaskInteractiveTerminalTranscript: (taskId: string, sessionId: string) =>
    request<TaskInteractiveTerminalTranscript>(`/tasks/${taskId}/terminal/sessions/${encodeURIComponent(sessionId)}/transcript`),
  killTaskInteractiveTerminal: (id: string) =>
    request<Task>(`/tasks/${id}/terminal/kill`, {
      method: "POST"
    }),
  resetTaskSession: (id: string) =>
    request<Task>(`/tasks/${id}/new-session`, {
      method: "POST"
    }),
  getTaskLiveDiff: (
    id: string,
    options?: { baseRef?: string | null; diffKind?: "compare" | "working" | "commits"; commitSha?: string | null }
  ) => {
    const params = new URLSearchParams();
    const base = options?.baseRef?.trim();
    if (base) {
      params.set("base", base);
    }
    if (options?.diffKind === "working") {
      params.set("kind", "working");
    } else if (options?.diffKind === "commits") {
      params.set("kind", "commits");
    }
    const commit = options?.commitSha?.trim();
    if (commit) {
      params.set("commit", commit);
    }
    const query = params.toString();
    return request<TaskLiveDiff>(`/tasks/${id}/live-diff${query ? `?${query}` : ""}`);
  },
  getTaskWorkspaceCommitLog: (id: string, options?: { limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<TaskWorkspaceCommitLog>(`/tasks/${id}/workspace-commit-log${query ? `?${query}` : ""}`);
  },
  getTaskWorkspaceFiles: (id: string, options?: { prefix?: string | null; limit?: number }) => {
    const params = new URLSearchParams();
    const prefix = options?.prefix?.trim();
    if (prefix) {
      params.set("prefix", prefix);
    }
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<TaskWorkspaceFileTree>(`/tasks/${id}/workspace-files${query ? `?${query}` : ""}`);
  },
  searchTaskWorkspaceFiles: (id: string, options: { query: string; limit?: number }) => {
    const params = new URLSearchParams({ q: options.query });
    if (options.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    return request<TaskWorkspaceFileSearchResult>(`/tasks/${id}/workspace-files/search?${params.toString()}`);
  },
  getTaskWorkspaceFile: (id: string, filePath: string, options?: { ref?: string | null }) => {
    const params = new URLSearchParams({ path: filePath });
    const ref = options?.ref?.trim();
    if (ref) {
      params.set("ref", ref);
    }
    return request<TaskWorkspaceFilePreview>(`/tasks/${id}/workspace-file?${params.toString()}`);
  },
  updateTaskWorkspaceFile: (id: string, input: UpdateTaskWorkspaceFileInput) =>
    request<TaskWorkspaceFilePreview>(`/tasks/${id}/workspace-file`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  openAiDiffAssist: (taskId: string, input: OpenAiDiffAssistInput) =>
    request<OpenAiDiffAssistResult>(`/tasks/${taskId}/openai/diff-assist`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  generateTaskPromptMagic: (input: TaskPromptMagicInput) =>
    request<TaskPromptMagicResult>("/tasks/prompt-magic", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  getTaskMessageAttachmentUrl: (taskId: string, messageId: string, attachmentId: string) =>
    buildApiUrl(`/tasks/${taskId}/messages/${messageId}/attachments/${attachmentId}`),
  listTaskMessages: (id: string, options?: HistoryPageOptions) => {
    const params = new URLSearchParams();
    const before = options?.before?.trim();
    if (before) {
      params.set("before", before);
    }
    const beforeId = options?.beforeId?.trim();
    if (beforeId) {
      params.set("beforeId", beforeId);
    }
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<HistoryPageResult<TaskMessage>>(`/tasks/${id}/messages${query ? `?${query}` : ""}`);
  },
  updateTaskMessage: (taskId: string, messageId: string, input: UpdateTaskMessageInput) =>
    request<TaskMessage>(`/tasks/${taskId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  listTaskRuns: (id: string, options?: HistoryPageOptions) => {
    const params = new URLSearchParams();
    const before = options?.before?.trim();
    if (before) {
      params.set("before", before);
    }
    const beforeId = options?.beforeId?.trim();
    if (beforeId) {
      params.set("beforeId", beforeId);
    }
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<HistoryPageResult<TaskRun>>(`/tasks/${id}/runs${query ? `?${query}` : ""}`);
  },
  getTaskRunRawJsonUrl: (taskId: string, runId: string) =>
    buildApiUrl(`/tasks/${taskId}/runs/${encodeURIComponent(runId)}/raw-json`),
  listTaskChangeProposals: (id: string, options?: HistoryPageOptions) => {
    const params = new URLSearchParams();
    const before = options?.before?.trim();
    if (before) {
      params.set("before", before);
    }
    const beforeId = options?.beforeId?.trim();
    if (beforeId) {
      params.set("beforeId", beforeId);
    }
    if (options?.limit != null && Number.isFinite(options.limit)) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    return request<HistoryPageResult<TaskChangeProposal>>(`/tasks/${id}/change-proposals${query ? `?${query}` : ""}`);
  },
  applyTaskChangeProposal: (taskId: string, proposalId: string, input?: ApplyTaskChangeProposalInput) =>
    request<Task>(`/tasks/${taskId}/change-proposals/${proposalId}/apply`, {
      method: "POST",
      ...(input ? { body: JSON.stringify(input) } : {})
    }),
  /** @deprecated Prefer applyTaskChangeProposal */
  acceptTaskChangeProposal: (taskId: string, proposalId: string, input?: ApplyTaskChangeProposalInput) =>
    request<Task>(`/tasks/${taskId}/change-proposals/${proposalId}/accept`, {
      method: "POST",
      ...(input ? { body: JSON.stringify(input) } : {})
    }),
  revertTaskChangeProposal: (taskId: string, proposalId: string) =>
    request<Task>(`/tasks/${taskId}/change-proposals/${proposalId}/revert`, { method: "POST" }),
  revertTaskChangeProposalFile: (
    taskId: string,
    proposalId: string,
    input: RevertTaskChangeProposalFileInput
  ) =>
    request<Task>(`/tasks/${taskId}/change-proposals/${proposalId}/revert-file`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  rejectTaskChangeProposal: (taskId: string, proposalId: string) =>
    request<Task>(`/tasks/${taskId}/change-proposals/${proposalId}/reject`, { method: "POST" }),
  createTask: (input: CreateTaskInput) =>
    request<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  triggerTaskAction: (id: string, action: TaskAction) =>
    request<Task>(`/tasks/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action })
    }),
  runTaskPostflight: (id: string) =>
    request<Task>(`/tasks/${id}/postflight`, {
      method: "POST"
    }),
  createTaskMessage: (id: string, input: CreateTaskMessageInput) =>
    request<Task>(`/tasks/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deletePendingTaskMessage: (taskId: string, messageId: string) =>
    request<Task>(`/tasks/${taskId}/messages/${encodeURIComponent(messageId)}/queue`, {
      method: "DELETE"
    }),
  runNextQueuedTaskMessage: (taskId: string) =>
    request<Task>(`/tasks/${taskId}/queue/run-next`, {
      method: "POST"
    }),
  unstickTaskQueue: (taskId: string) =>
    request<Task>(`/tasks/${taskId}/queue/unstick`, {
      method: "POST"
    }),
  cancelTask: (id: string) =>
    request<Task>(`/tasks/${id}/cancel`, {
      method: "POST"
    }),
  pullTask: (id: string) =>
    request<Task>(`/tasks/${id}/pull`, {
      method: "POST"
    }),
  resetTaskGit: (id: string) =>
    request<Task>(`/tasks/${id}/reset-git`, {
      method: "POST"
    }),
  revertTaskCommit: (id: string, commitSha: string) =>
    request<Task>(`/tasks/${id}/commits/${encodeURIComponent(commitSha)}/revert`, {
      method: "POST"
    }),
  resetTaskCommit: (id: string, commitSha: string) =>
    request<Task>(`/tasks/${id}/commits/${encodeURIComponent(commitSha)}/reset`, {
      method: "POST"
    }),
  getTaskMergePreview: (id: string, targetBranch: string) =>
    request<TaskMergePreview>(`/tasks/${id}/merge-preview?targetBranch=${encodeURIComponent(targetBranch)}`),
  getTaskPushPreview: (id: string) => request<TaskPushPreview>(`/tasks/${id}/push-preview`),
  pushTask: (id: string, input?: { commitMessage?: string }) =>
    request<Task>(`/tasks/${id}/push`, {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  mergeTask: (id: string, input: MergeTaskInput) =>
    request<Task>(`/tasks/${id}/merge`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  archiveTask: (id: string, input?: { deleteRemoteBranch?: boolean }) =>
    request<Task>(`/tasks/${id}/archive`, {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  deleteTask: (id: string, input?: { deleteRemoteBranch?: boolean }) =>
    request<void>(`/tasks/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input ?? {})
    }),
  updateTaskConfig: (id: string, input: UpdateTaskConfigInput) =>
    request<Task>(`/tasks/${id}/config`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskPin: (id: string, input: UpdateTaskPinInput) =>
    request<Task>(`/tasks/${id}/pin`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskTitle: (id: string, input: UpdateTaskTitleInput) =>
    request<Task>(`/tasks/${id}/title`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskDeadline: (id: string, input: UpdateTaskDeadlineInput) =>
    request<Task>(`/tasks/${id}/deadline`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskDraft: (id: string, input: UpdateTaskDraftInput) =>
    request<Task>(`/tasks/${id}/draft`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskState: (id: string, input: UpdateTaskStateInput) =>
    request<Task>(`/tasks/${id}/state`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskAssignee: (id: string, input: UpdateTaskAssigneeInput) =>
    request<Task>(`/tasks/${id}/assignee`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskPullRequest: (id: string, input: UpdateTaskPullRequestInput) =>
    request<Task>(`/tasks/${id}/github-pr`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskIssue: (id: string, input: UpdateTaskIssueInput) =>
    request<Task>(`/tasks/${id}/github-issue`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  listRepositories: () => request<Repository[]>("/repositories"),
  getRepository: (id: string) => request<Repository>(`/repositories/${id}`),
  createRepository: (input: CreateRepositoryInput) =>
    request<Repository>("/repositories", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateRepository: (id: string, input: UpdateRepositoryInput) =>
    request<Repository>(`/repositories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteRepository: (id: string) =>
    request<void>(`/repositories/${id}`, {
      method: "DELETE"
    }),
  getSettings: () => request<SystemSettings>("/settings"),
  getProviderBaseStateStatus: () => request<ProviderBaseStateStatus>("/settings/provider-base-state"),
  checkHostexec: () => request<HostexecAvailability>("/settings/hostexec/check"),
  listModels: (provider: AgentProvider, options?: { refresh?: boolean }) =>
    request<ProviderModelsResponse>(`/settings/models?provider=${encodeURIComponent(provider)}${options?.refresh ? "&refresh=1" : ""}`),
  updateSettings: (input: UpdateSettingsInput) =>
    request<SystemSettings>("/settings", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateCredentials: (input: UpdateCredentialSettingsInput) =>
    request<SystemSettings>("/settings/credentials", {
      method: "PATCH",
      body: JSON.stringify(input)
    })
};
