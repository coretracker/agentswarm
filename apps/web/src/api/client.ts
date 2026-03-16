"use client";

import type {
  AgentProvider,
  AuthSession,
  CreateRoleInput,
  Preset,
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
  SystemSettings,
  TaskDefinitionInput,
  Task,
  TaskLiveDiff,
  TaskMessage,
  TaskRun,
  TaskAction,
  UpdateRoleInput,
  UpdateTaskPlanInput,
  UpdateTaskPinInput,
  UpdateCredentialSettingsInput,
  UpdateTaskConfigInput,
  UpdateRepositoryInput,
  UpdateSettingsInput,
  UpdateUserInput,
  User
} from "@agentswarm/shared-types";

export interface ProviderModelsResponse {
  models: ProviderModelOption[];
  source: "api" | "static";
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

  const response = await fetch(`${apiBaseUrl}${path}`, {
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
  listPresets: () => request<Preset[]>("/presets"),
  getPreset: (id: string) => request<Preset>(`/presets/${id}`),
  createPreset: (input: TaskDefinitionInput) =>
    request<Preset>("/presets", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updatePreset: (id: string, input: TaskDefinitionInput) =>
    request<Preset>(`/presets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deletePreset: (id: string) =>
    request<void>(`/presets/${id}`, {
      method: "DELETE"
    }),
  spawnPreset: (id: string) =>
    request<Task>(`/presets/${id}/spawn`, {
      method: "POST"
    }),
  listTasks: () => request<Task[]>("/tasks"),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  getTaskLiveDiff: (id: string) => request<TaskLiveDiff>(`/tasks/${id}/live-diff`),
  listTaskMessages: (id: string) => request<TaskMessage[]>(`/tasks/${id}/messages`),
  listTaskRuns: (id: string) => request<TaskRun[]>(`/tasks/${id}/runs`),
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
  triggerTaskAction: (id: string, action: TaskAction, iterateInput?: string) =>
    request<Task>(`/tasks/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, iterateInput })
    }),
  createTaskMessage: (id: string, input: CreateTaskMessageInput) =>
    request<Task>(`/tasks/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  buildTaskFromRun: (id: string, runId: string) =>
    request<Task>(`/tasks/${id}/build-from-run/${runId}`, {
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
  pushTask: (id: string) =>
    request<Task>(`/tasks/${id}/push`, {
      method: "POST"
    }),
  mergeTask: (id: string) =>
    request<Task>(`/tasks/${id}/merge`, {
      method: "POST"
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
  updateTaskPlan: (id: string, input: UpdateTaskPlanInput) =>
    request<Task>(`/tasks/${id}/plan`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateTaskPin: (id: string, input: UpdateTaskPinInput) =>
    request<Task>(`/tasks/${id}/pin`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  listRepositories: () => request<Repository[]>("/repositories"),
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
    })
};
