"use client";

import type {
  CreateTaskFromIssueInput,
  CreateTaskFromPullRequestInput,
  CreateTaskMessageInput,
  CreateRepositoryInput,
  CreateTaskInput,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  Repository,
  SystemSettings,
  Task,
  TaskLiveDiff,
  TaskMessage,
  TaskRun,
  TaskAction,
  UpdateTaskPlanInput,
  UpdateTaskPinInput,
  UpdateCredentialSettingsInput,
  UpdateTaskConfigInput,
  UpdateRepositoryInput,
  UpdateSettingsInput
} from "@agentswarm/shared-types";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
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
  acceptTask: (id: string) =>
    request<Task>(`/tasks/${id}/accept`, {
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
