import { api, type ProviderModelsResponse, type TaskInteractiveTerminalStatus } from "../src/api/client";
import {
  adminSession,
  binaryPreview,
  commitLog,
  createTask,
  gitState,
  hostexecAvailable,
  imagePreview,
  integrationRules,
  liveDiff,
  personalAccessTokens,
  profile,
  repositories,
  roles,
  settings,
  taskChangeProposals,
  taskMessages,
  taskRuns,
  tasks,
  terminalTranscript,
  textPreview,
  users,
  webhookInbox,
  workspaceFileTree
} from "./fixtures";

type Api = typeof api;
export type MockApiOverrides = Partial<{ [K in keyof Api]: Api[K] }>;

function getTaskById(id: string) {
  return tasks.find((task) => task.id === id) ?? createTask({ id, title: `Storybook task ${id}` });
}

function getRepositoryById(id: string) {
  return repositories.find((repository) => repository.id === id) ?? repositories[0];
}

function updateTask(id: string, patch: Partial<ReturnType<typeof createTask>>) {
  return { ...getTaskById(id), ...patch, updatedAt: new Date().toISOString() };
}

export function createMockApi(overrides: MockApiOverrides = {}): MockApiOverrides {
  const defaults: MockApiOverrides = {
    login: async () => adminSession,
    getSession: async () => adminSession,
    logout: async () => undefined,
    getProfile: async () => profile,
    updateProfile: async (input) => ({ ...profile, ...input }),
    listPersonalAccessTokens: async () => personalAccessTokens,
    createPersonalAccessToken: async (input) => ({
      ...personalAccessTokens[0],
      id: "pat-created",
      name: input.name,
      scopes: input.scopes ?? [],
      tokenPrefix: "verft_new",
      token: "verft_new_storybook_token"
    }),
    revokePersonalAccessToken: async (id) => ({ ...personalAccessTokens[0], id, revokedAt: new Date().toISOString() }),
    listUsers: async () => users,
    getUser: async (id) => users.find((user) => user.id === id) ?? users[0],
    createUser: async (input) => ({
      ...users[0],
      id: "user-created",
      name: input.name,
      email: input.email,
      githubUsername: input.githubUsername ?? null,
      active: input.active ?? true,
      roles: [],
      repositoryIds: input.repositoryIds ?? []
    }),
    updateUser: async (id, input) => ({ ...users.find((user) => user.id === id), ...users[0], id, ...input }),
    deleteUser: async () => undefined,
    listRoles: async () => roles,
    getRole: async (id) => roles.find((role) => role.id === id) ?? roles[0],
    createRole: async (input) => ({
      ...roles[1],
      id: "role-created",
      name: input.name,
      description: input.description ?? "",
      scopes: input.scopes,
      allowedProviders: input.allowedProviders ?? [],
      allowedModels: input.allowedModels ?? [],
      allowedEfforts: input.allowedEfforts ?? []
    }),
    updateRole: async (id, input) => ({ ...roles.find((role) => role.id === id), ...roles[0], id, ...input }),
    deleteRole: async () => undefined,
    listTasks: async (options) => {
      if (options?.view === "active") {
        return tasks.filter((task) => task.status !== "archived").slice(0, options.limit ?? tasks.length);
      }
      if (options?.view === "archived") {
        return tasks.filter((task) => task.status === "archived").slice(0, options.limit ?? tasks.length);
      }
      return tasks.slice(0, options?.limit ?? tasks.length);
    },
    getTask: async (id) => getTaskById(id),
    linkTaskWorkspace: async (id, linkedTaskId) => updateTask(id, { linkedWorkspaces: [{ taskId: linkedTaskId, alias: "linked", title: "Linked task", repoName: "verft", linkedAt: new Date().toISOString(), linkedByUserId: "user-admin" }] }),
    unlinkTaskWorkspace: async (id) => updateTask(id, { linkedWorkspaces: [] }),
    startTask: async (id) => updateTask(id, { status: "building", executionStatus: "running", executionAction: "build" }),
    getTaskBranchSyncCounts: async () => ({ pullCount: gitState.pullCount, pushCount: gitState.pushCount }),
    getTaskGitState: async () => gitState,
    getTaskGitOperation: async () => null,
    getTaskInteractiveTerminalStatus: async (): Promise<TaskInteractiveTerminalStatus> => ({ available: true, activeInteractiveSession: true, terminalMode: "terminal" }),
    getTaskInteractiveTerminalTranscript: async () => terminalTranscript,
    killTaskInteractiveTerminal: async (id) => updateTask(id, { activeInteractiveSession: false }),
    resetTaskSession: async (id) => updateTask(id, { executionStatus: "idle" }),
    getTaskLiveDiff: async () => liveDiff,
    getTaskWorkspaceCommitLog: async () => commitLog,
    getTaskWorkspaceFiles: async () => workspaceFileTree,
    searchTaskWorkspaceFiles: async (_id, options) => ({
      query: options.query,
      results: workspaceFileTree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
      fetchedAt: workspaceFileTree.fetchedAt,
      truncated: false,
      totalCount: 3
    }),
    getTaskWorkspaceFile: async (_id, filePath) => {
      if (/\.(png|jpg|jpeg|gif|webp)$/i.test(filePath)) {
        return { ...imagePreview, path: filePath };
      }
      if (/\.(zip|pdf)$/i.test(filePath)) {
        return { ...binaryPreview, path: filePath };
      }
      return { ...textPreview, path: filePath };
    },
    updateTaskWorkspaceFile: async (_id, input) => ({ ...textPreview, path: input.path, content: input.content }),
    openAiDiffAssist: async () => ({ text: "This diff looks focused and ready for review." }),
    getTaskMessageAttachmentUrl: (taskId, messageId, attachmentId) => `/storybook/tasks/${taskId}/messages/${messageId}/attachments/${attachmentId}`,
    listTaskMessages: async (id) => ({ items: taskMessages.filter((message) => message.taskId === id), hasMore: false }),
    updateTaskMessage: async (_taskId, messageId, input) => ({ ...taskMessages[0], id: messageId, content: input.content }),
    listTaskRuns: async (id) => ({ items: taskRuns.filter((run) => run.taskId === id), hasMore: false }),
    getTaskRunRawJsonUrl: (taskId, runId) => `/storybook/tasks/${taskId}/runs/${runId}/raw-json`,
    listTaskChangeProposals: async (id) => ({
      items: taskChangeProposals.filter((proposal) => proposal.taskId === id),
      hasMore: false
    }),
    applyTaskChangeProposal: async (taskId) => updateTask(taskId, { hasPendingCheckpoint: false, status: "done", workflowStatus: "done" }),
    acceptTaskChangeProposal: async (taskId) => updateTask(taskId, { hasPendingCheckpoint: false, status: "done", workflowStatus: "done" }),
    revertTaskChangeProposal: async (taskId) => updateTask(taskId, { hasPendingCheckpoint: false }),
    revertTaskChangeProposalFile: async (taskId) => updateTask(taskId, { hasPendingCheckpoint: true }),
    rejectTaskChangeProposal: async (taskId) => updateTask(taskId, { hasPendingCheckpoint: false, status: "open", workflowStatus: "ready" }),
    createTask: async (input) => createTask({
      id: "task-created",
      title: input.title,
      repoId: input.repoId,
      prompt: input.prompt,
      taskType: input.taskType,
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride ?? input.model ?? null,
      baseBranch: input.baseBranch ?? "main",
      branchStrategy: input.branchStrategy ?? "feature_branch"
    }),
    triggerTaskAction: async (id, action) => updateTask(id, { executionStatus: "running", executionAction: action }),
    runTaskPostflight: async (id) => updateTask(id, { status: "done", workflowStatus: "done" }),
    createTaskMessage: async (id) => updateTask(id, { lastAction: "ask", status: "ask_queued", executionStatus: "queued" }),
    deletePendingTaskMessage: async (id) => updateTask(id, {}),
    runNextQueuedTaskMessage: async (id) => updateTask(id, { executionStatus: "running" }),
    unstickTaskQueue: async (id) => updateTask(id, { executionStatus: "idle" }),
    cancelTask: async (id) => updateTask(id, { executionStatus: "cancelled", status: "cancelled" }),
    pullTask: async (id) => updateTask(id, { pullCount: (getTaskById(id).pullCount ?? 0) + 1 }),
    resetTaskGit: async (id) => updateTask(id, { pullCount: 0, pushCount: 0 }),
    revertTaskCommit: async (id) => updateTask(id, { hasPendingCheckpoint: true }),
    resetTaskCommit: async (id) => updateTask(id, { hasPendingCheckpoint: true }),
    getTaskMergePreview: async (_id, targetBranch) => ({ sourceBranch: "task/storybook-components", targetBranch, mergeable: true, message: "Clean merge.", suggestedCommitMessage: "Merge Storybook coverage" }),
    getTaskPushPreview: async () => gitState.pushPreview,
    pushTask: async (id) => updateTask(id, { pushCount: (getTaskById(id).pushCount ?? 0) + 1 }),
    mergeTask: async (id) => updateTask(id, { status: "done", workflowStatus: "done" }),
    archiveTask: async (id) => updateTask(id, { status: "archived", workflowStatus: "archived" }),
    deleteTask: async () => undefined,
    updateTaskConfig: async (id, input) => updateTask(id, { provider: input.provider, providerProfile: input.providerProfile, modelOverride: input.modelOverride }),
    updateTaskPin: async (id, input) => updateTask(id, { pinned: input.pinned }),
    updateTaskTitle: async (id, input) => updateTask(id, { title: input.title }),
    updateTaskDraft: async (id, input) => updateTask(id, { ...input }),
    updateTaskState: async (id, input) => updateTask(id, { workflowStatus: input.status }),
    updateTaskAssignee: async (id, input) => updateTask(id, { ownerUserId: input.ownerUserId }),
    updateTaskPullRequest: async (id, input) => updateTask(id, { githubPrNumber: input.githubPrNumber }),
    updateTaskIssue: async (id, input) => updateTask(id, { githubIssueNumber: input.githubIssueNumber }),
    listRepositories: async () => repositories,
    getRepository: async (id) => getRepositoryById(id),
    listRepositoryBranches: async (id) => ({
      branches:
        id === "repo-harness"
          ? ["develop", "feature/runner-cache", "release/harness-v2"]
          : ["main", "develop", "feature/storybook-coverage", "fix/repository-editor"]
    }),
    createRepository: async (input) => ({ ...repositories[0], id: "repo-created", name: input.name, url: input.url, defaultBranch: input.defaultBranch ?? "main" }),
    updateRepository: async (id, input) => ({ ...getRepositoryById(id), ...input }),
    deleteRepository: async () => undefined,
    getSettings: async () => settings,
    checkHostexec: async () => hostexecAvailable,
    listModels: async (provider): Promise<ProviderModelsResponse> => ({
      models: provider === "claude" ? settings.claudeModels : settings.codexModels,
      source: "cache"
    }),
    updateSettings: async (input) => ({ ...settings, ...input }),
    updateCredentials: async () => settings,
    listIntegrationRules: async () => integrationRules,
    createIntegrationRule: async (_repositoryId, input) => ({ ...integrationRules[0], id: "rule-created", name: input.name, filter: input.filter, mapping: input.mapping, execution: input.execution ?? null }),
    updateIntegrationRule: async (_repositoryId, ruleId, input) => ({ ...integrationRules[0], id: ruleId, ...input }),
    deleteIntegrationRule: async () => undefined,
    copyIntegrationSetup: async () => ({ rulesCopied: 1, rulesDeleted: 0, inboundWebhookSecretCopied: false, inboundWebhookSecretCleared: false }),
    listWebhookInbox: async () => webhookInbox,
    getWebhookInboxEntry: async (_repositoryId, entryId) => webhookInbox.find((entry) => entry.id === entryId) ?? webhookInbox[0],
    deleteWebhookInboxEntry: async () => undefined
  };

  return { ...defaults, ...overrides };
}

export function installMockApi(overrides: MockApiOverrides = {}): void {
  Object.assign(api, createMockApi(overrides));
}
