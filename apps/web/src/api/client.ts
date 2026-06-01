"use client";

import type {
  AgentProvider,
  AuthProfile,
  AuthSession,
  CreateRoleInput,
  CreateSequenceInput,
  CreateSnippetInput,
  CreateTaskFromIssueInput,
  CreateTaskFromPullRequestInput,
  CreateTaskMessageInput,
  CreateRepositoryInput,
  CreateTaskInput,
  CreateUserInput,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  LoginInput,
  ProviderModelOption,
  Repository,
  Role,
  Sequence,
  SequenceRun,
  Snippet,
  SystemSettings,
  Task,
  OpenAiDiffAssistInput,
  OpenAiDiffAssistResult,
  TaskPromptMagicInput,
  TaskPromptMagicResult,
  TaskLiveDiff,
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
  UpdateSequenceInput,
  UpdateSnippetInput,
  UpdateTaskPinInput,
  UpdateTaskNotesInput,
  UpdateTaskAssigneeInput,
  UpdateTaskStateInput,
  UpdateUserNotesInput,
  UpdateTaskTitleInput,
  UpdateAuthProfileInput,
  UpdateCredentialSettingsInput,
  UpdateTaskConfigInput,
  UpdateRepositoryInput,
  UpdateSettingsInput,
  UpdateUserInput,
  User,
  UserNotes
} from "@agentswarm/shared-types";
export type { TaskWorkspaceFilePreview } from "@agentswarm/shared-types";
import { buildApiUrl } from "../lib/public-url";

export interface ProviderModelsResponse {
  models: ProviderModelOption[];
  source: "api" | "static";
}

export interface TaskInteractiveTerminalStatus {
  available: boolean;
  reason?: string;
  /** Server sets this when a terminal WebSocket session is active for the task. */
  activeInteractiveSession?: boolean;
  /** Present when an active session exists for this task. */
  terminalMode?: TaskTerminalSessionMode;
}

export interface TaskBranchSyncCounts {
  pullCount: number;
  pushCount: number;
}

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
  listSnippets: () => request<Snippet[]>("/snippets"),
  getSnippet: (id: string) => request<Snippet>(`/snippets/${id}`),
  createSnippet: (input: CreateSnippetInput) =>
    request<Snippet>("/snippets", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateSnippet: (id: string, input: UpdateSnippetInput) =>
    request<Snippet>(`/snippets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteSnippet: (id: string) =>
    request<void>(`/snippets/${id}`, {
      method: "DELETE"
    }),
  duplicateSnippet: (id: string) =>
    request<Snippet>(`/snippets/${id}/duplicate`, {
      method: "POST"
    }),
  listSequences: () => request<Sequence[]>("/sequences"),
  getSequence: (id: string) => request<Sequence>(`/sequences/${id}`),
  createSequence: (input: CreateSequenceInput) =>
    request<Sequence>("/sequences", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateSequence: (id: string, input: UpdateSequenceInput) =>
    request<Sequence>(`/sequences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteSequence: (id: string) =>
    request<void>(`/sequences/${id}`, {
      method: "DELETE"
    }),
  duplicateSequence: (id: string) =>
    request<Sequence>(`/sequences/${id}/duplicate`, {
      method: "POST"
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
  getTaskSequenceRun: (id: string) => request<SequenceRun>(`/tasks/${id}/sequence-run`),
  approveTaskSequenceRun: (id: string) =>
    request<SequenceRun>(`/tasks/${id}/sequence-run/approve`, {
      method: "POST"
    }),
  getTaskBranchSyncCounts: (id: string) => request<TaskBranchSyncCounts>(`/tasks/${id}/branch-sync-counts`),
  getTaskGitOperation: (id: string) => request<TaskGitOperation | null>(`/tasks/${id}/git-operation`),
  getTaskInteractiveTerminalStatus: (id: string, options?: { mode?: TaskTerminalSessionMode }) => {
    const params = new URLSearchParams();
    if (options?.mode) {
      params.set("mode", options.mode);
    }
    const query = params.toString();
    return request<TaskInteractiveTerminalStatus>(`/tasks/${id}/interactive-terminal/status${query ? `?${query}` : ""}`);
  },
  getTaskInteractiveTerminalTranscript: (taskId: string, sessionId: string) =>
    request<TaskInteractiveTerminalTranscript>(`/tasks/${taskId}/interactive-terminal/sessions/${encodeURIComponent(sessionId)}/transcript`),
  killTaskInteractiveTerminal: (id: string) =>
    request<Task>(`/tasks/${id}/interactive-terminal/kill`, {
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
  createTaskFromIssue: (input: CreateTaskFromIssueInput) =>
    request<Task>("/imports/issue", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createTaskFromPullRequest: (input: CreateTaskFromPullRequestInput) =>
    request<Task>("/imports/pull-request", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  listGitHubIssues: (repoId: string) =>
    request<GitHubIssueReference[]>(`/imports/github/issues?repoId=${encodeURIComponent(repoId)}`),
  listGitHubPullRequests: (repoId: string) =>
    request<GitHubPullRequestReference[]>(`/imports/github/pull-requests?repoId=${encodeURIComponent(repoId)}`),
  listGitHubBranches: (repoId: string) =>
    request<GitHubBranchReference[]>(`/imports/github/branches?repoId=${encodeURIComponent(repoId)}`),
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
  cancelTask: (id: string) =>
    request<Task>(`/tasks/${id}/cancel`, {
      method: "POST"
    }),
  pullTask: (id: string) =>
    request<Task>(`/tasks/${id}/pull`, {
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
  archiveTask: (id: string) =>
    request<Task>(`/tasks/${id}/archive`, {
      method: "POST"
    }),
  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, {
      method: "DELETE"
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
  updateTaskNotes: (id: string, input: UpdateTaskNotesInput) =>
    request<Task>(`/tasks/${id}/notes`, {
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
  listModels: (provider: AgentProvider) =>
    request<ProviderModelsResponse>(`/settings/models?provider=${encodeURIComponent(provider)}`),
  updateSettings: (input: UpdateSettingsInput) =>
    request<SystemSettings>("/settings", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateCredentials: (input: UpdateCredentialSettingsInput) =>
    request<SystemSettings>("/settings/credentials", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  getUserNotes: () => request<UserNotes>("/settings/notes"),
  updateUserNotes: (input: UpdateUserNotesInput) =>
    request<UserNotes>("/settings/notes", {
      method: "PATCH",
      body: JSON.stringify(input)
    })
};
