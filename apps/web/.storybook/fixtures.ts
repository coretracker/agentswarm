import {
  ALL_PERMISSION_SCOPES,
  CODEX_MODELS,
  CLAUDE_MODELS,
  type AuthProfile,
  type AuthSession,
  type HostexecAvailability,
  type IntegrationRule,
  type PersonalAccessToken,
  type Repository,
  type Role,
  type SystemSettings,
  type Task,
  type TaskChangeProposal,
  type TaskGitStateSnapshot,
  type TaskInteractiveTerminalTranscript,
  type TaskLiveDiff,
  type TaskMessage,
  type TaskRun,
  type TaskWorkspaceCommitLog,
  type TaskWorkspaceFilePreview,
  type TaskWorkspaceFileTree,
  type User,
  type WebhookInboxEntry
} from "@verft/shared-types";

export const storybookNow = "2026-07-23T09:00:00.000Z";

export const adminRole: Role = {
  id: "admin",
  name: "Admin",
  description: "Full access to all Verft screens and actions.",
  scopes: ALL_PERMISSION_SCOPES,
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: [],
  scopeVersion: 1,
  isSystem: true,
  createdAt: storybookNow,
  updatedAt: storybookNow
};

export const viewerRole: Role = {
  id: "viewer",
  name: "Viewer",
  description: "Read-only workspace access.",
  scopes: ["task:list", "task:read", "repo:list", "repo:read"],
  allowedProviders: ["codex"],
  allowedModels: ["gpt-5.5"],
  allowedEfforts: ["medium"],
  scopeVersion: 1,
  isSystem: false,
  createdAt: storybookNow,
  updatedAt: storybookNow
};

export const roles: Role[] = [adminRole, viewerRole];

export const adminUser: User = {
  id: "user-admin",
  name: "Andreas",
  email: "andreas@example.com",
  githubUsername: "andreas",
  defaultProvider: "codex",
  defaultModel: "gpt-5.5",
  defaultProviderProfile: "high",
  active: true,
  roles: [{ id: adminRole.id, name: adminRole.name, isSystem: adminRole.isSystem }],
  repositoryIds: [],
  lastLoginAt: storybookNow,
  createdAt: storybookNow,
  updatedAt: storybookNow
};

export const viewerUser: User = {
  ...adminUser,
  id: "user-viewer",
  name: "Casey Viewer",
  email: "casey@example.com",
  githubUsername: "casey",
  defaultProvider: "codex",
  defaultModel: "gpt-5.5",
  defaultProviderProfile: "medium",
  roles: [{ id: viewerRole.id, name: viewerRole.name, isSystem: viewerRole.isSystem }]
};

export const users: User[] = [adminUser, viewerUser];

export const adminSession: AuthSession = {
  user: {
    ...adminUser,
    scopes: ALL_PERMISSION_SCOPES,
    allowedProviders: [],
    allowedModels: [],
    allowedEfforts: []
  },
  expiresAt: "2026-07-23T17:00:00.000Z"
};

export const viewerSession: AuthSession = {
  user: {
    ...viewerUser,
    scopes: viewerRole.scopes,
    allowedProviders: viewerRole.allowedProviders,
    allowedModels: viewerRole.allowedModels,
    allowedEfforts: viewerRole.allowedEfforts
  },
  expiresAt: "2026-07-23T17:00:00.000Z"
};

export const profile: AuthProfile = {
  name: adminUser.name,
  email: adminUser.email,
  githubUsername: adminUser.githubUsername,
  defaultProvider: adminUser.defaultProvider,
  defaultModel: adminUser.defaultModel,
  defaultProviderProfile: adminUser.defaultProviderProfile
};

export const personalAccessTokens: PersonalAccessToken[] = [
  {
    id: "pat-mcp",
    name: "MCP clients",
    scopes: ["task:list", "task:read"],
    tokenPrefix: "verft_abc",
    expiresAt: null,
    lastUsedAt: "2026-07-22T15:24:00.000Z",
    revokedAt: null,
    createdAt: "2026-07-01T08:00:00.000Z"
  }
];

export const repositories: Repository[] = [
  {
    id: "repo-verft",
    name: "verft",
    url: "https://github.com/example/verft",
    defaultBranch: "main",
    defaultProvider: "codex",
    defaultModel: "gpt-5.5",
    defaultProviderProfile: "high",
    envVars: [{ key: "PUBLIC_PORT", value: "3217" }],
    envSecrets: [{ key: "OPENAI_API_KEY", configured: true }],
    mcpServers: [],
    hostCommands: ["npm run ci", "npm run build-storybook -w @verft/web"],
    webhookUrl: "https://example.com/webhooks/verft",
    webhookEnabled: true,
    webhookSecretConfigured: true,
    githubPrWebhookSecretConfigured: true,
    inboundWebhookSecretConfigured: true,
    inboundWebhookSignatureHeaders: ["x-webhook-signature", "x-hub-signature-256"],
    inboundWebhookSignatureHeaderSecrets: [
      { header: "x-webhook-signature", secretConfigured: true },
      { header: "x-hub-signature-256", secretConfigured: false }
    ],
    githubIntegrationBotLogin: "verft-bot",
    githubPrAllowedUsers: ["andreas"],
    githubPrRequireBotMention: true,
    githubPrAutoArchiveOnMerge: true,
    githubPrInitialInstructions: null,
    githubPrFeedbackInstructions: null,
    githubPrReviewInstructions: null,
    githubPrTaskCreatedCommentTemplate: null,
    githubPrTaskOwnerUserId: adminUser.id,
    slackChannelId: "C123STORY",
    slackInitialInstructions: null,
    slackFeedbackInstructions: null,
    slackTaskCreatedReplyTemplate: null,
    slackTaskOwnerUserId: adminUser.id,
    harnessWhatExists: "A Next.js web app, Fastify server, and shared TypeScript contracts.",
    harnessAllowedActions: "Modify app code, docs, and tests.",
    harnessNotAllowedActions: "Do not rewrite unrelated history.",
    harnessHowToWork: "Use focused checks while iterating, then run CI.",
    harnessDefinitionOfDone: "Typecheck, tests, and Storybook build pass.",
    harnessEvidenceExpectations: "Summarize verification commands in the final response.",
    webhookLastAttemptAt: "2026-07-22T19:18:00.000Z",
    webhookLastStatus: "success",
    webhookLastError: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: storybookNow
  },
  {
    id: "repo-docs",
    name: "docs-site",
    url: "https://github.com/example/docs-site",
    defaultBranch: "develop",
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-8",
    defaultProviderProfile: "max",
    envVars: [],
    envSecrets: [],
    mcpServers: [],
    hostCommands: [],
    webhookUrl: null,
    webhookEnabled: false,
    webhookSecretConfigured: false,
    webhookLastAttemptAt: null,
    webhookLastStatus: null,
    webhookLastError: null,
    createdAt: "2026-06-12T08:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z"
  }
];

export const settings: SystemSettings = {
  defaultProvider: "codex",
  defaultAutoApplyCheckpoints: false,
  maxAgents: 4,
  archivedTaskAutoDeleteEnabled: true,
  archivedTaskAutoDeleteDays: 30,
  branchPrefix: "task/",
  workspaceProvisioningMode: "hybrid",
  gitUsername: "verft-agent",
  gitAuthorName: "Verft Agent",
  gitAuthorEmail: "agent@example.com",
  hostexec: { enabled: true, url: "http://host.docker.internal:38127", bearerTokenEnvVar: null },
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  harnessWhatExists: repositories[0]?.harnessWhatExists ?? null,
  harnessAllowedActions: repositories[0]?.harnessAllowedActions ?? null,
  harnessNotAllowedActions: repositories[0]?.harnessNotAllowedActions ?? null,
  harnessHowToWork: repositories[0]?.harnessHowToWork ?? null,
  harnessDefinitionOfDone: repositories[0]?.harnessDefinitionOfDone ?? null,
  harnessEvidenceExpectations: repositories[0]?.harnessEvidenceExpectations ?? null,
  githubTokenConfigured: true,
  openaiApiKeyConfigured: true,
  anthropicApiKeyConfigured: true,
  slackSigningSecretConfigured: true,
  slackBotTokenConfigured: false,
  codexDefaultModel: "gpt-5.5",
  codexModels: CODEX_MODELS,
  codexDefaultEffort: "high",
  claudeDefaultModel: "claude-opus-4-8",
  claudeModels: CLAUDE_MODELS,
  claudeDefaultEffort: "high",
  dataStores: {
    taskStore: "postgres",
    repositoryStore: "postgres",
    credentialStore: "postgres",
    roleStore: "postgres",
    userStore: "postgres",
    settingsStore: "postgres",
    taskQueueStore: "redis",
    webhookDeliveryStore: "redis",
    sessionStore: "redis",
    eventBus: "redis"
  }
};

export const exampleDiff = [
  "diff --git a/apps/web/components/example.tsx b/apps/web/components/example.tsx",
  "index 1111111..2222222 100644",
  "--- a/apps/web/components/example.tsx",
  "+++ b/apps/web/components/example.tsx",
  "@@ -1,3 +1,4 @@",
  " export function Example() {",
  "-  return <div>Old</div>;",
  "+  return <div>Storybook ready</div>;",
  " }"
].join("\n");

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-storybook",
    title: "Bring existing components to Storybook",
    pinned: false,
    hasPendingCheckpoint: false,
    autoApplyCheckpoints: false,
    activeInteractiveSession: false,
    activeTerminalSessionMode: null,
    linkedWorkspaces: [],
    parentTaskId: null,
    rootTaskId: null,
    ownerUserId: adminUser.id,
    creatorName: adminUser.name,
    repoId: repositories[0].id,
    repoName: repositories[0].name,
    repoUrl: repositories[0].url,
    repoDefaultBranch: repositories[0].defaultBranch,
    githubPrNumber: 42,
    githubIssueNumber: null,
    slackChannelId: null,
    slackThreadTs: null,
    taskType: "build",
    provider: "codex",
    providerProfile: "high",
    modelOverride: "gpt-5.5",
    baseBranch: "main",
    branchStrategy: "feature_branch",
    complexity: "normal",
    branchName: "task/storybook-components",
    workspaceBaseRef: "origin/main",
    prompt: "Bring all current web components, layout, and pages into Storybook with realistic states.",
    resultMarkdown: "Implemented a shared Storybook harness and fixture-backed stories.",
    executionSummary: "Storybook coverage added for major workflows.",
    branchDiff: exampleDiff,
    pullCount: 1,
    pushCount: 0,
    lastAction: "build",
    status: "awaiting_review",
    workflowStatus: "review",
    executionStatus: "idle",
    executionAction: null,
    reviewReason: "checkpoint",
    logs: [],
    enqueued: false,
    createdAt: "2026-07-22T08:00:00.000Z",
    updatedAt: storybookNow,
    startedAt: "2026-07-22T08:02:00.000Z",
    finishedAt: "2026-07-22T08:24:00.000Z",
    errorMessage: null,
    ...overrides
  };
}

export const tasks: Task[] = [
  createTask({ pinned: true }),
  createTask({
    id: "task-running",
    title: "Run Storybook visual smoke check",
    pinned: false,
    hasPendingCheckpoint: false,
    status: "building",
    workflowStatus: "in_progress",
    executionStatus: "running",
    executionAction: "build",
    reviewReason: null,
    updatedAt: "2026-07-23T08:55:00.000Z"
  }),
  createTask({
    id: "task-failed",
    title: "Fix failing task detail empty state",
    pinned: false,
    hasPendingCheckpoint: false,
    status: "failed",
    workflowStatus: "in_progress",
    executionStatus: "failed",
    executionAction: null,
    reviewReason: null,
    errorMessage: "TypeScript detected a missing fixture field.",
    updatedAt: "2026-07-21T11:30:00.000Z"
  }),
  createTask({
    id: "task-archived",
    title: "Archive old visual regression task",
    status: "archived",
    workflowStatus: "archived",
    updatedAt: "2026-07-12T10:00:00.000Z"
  })
];

export const imageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3+kwAAAABJRU5ErkJggg==";

export const workspaceFileTree: TaskWorkspaceFileTree = {
  prefix: null,
  entries: [
    { path: "apps", name: "apps", kind: "directory" },
    { path: "apps/web/components/app-shell.tsx", name: "app-shell.tsx", kind: "file" },
    { path: "apps/web/components/tasks-page.tsx", name: "tasks-page.tsx", kind: "file" },
    { path: "docs/development/testing.md", name: "testing.md", kind: "file" }
  ],
  fetchedAt: storybookNow,
  truncated: false,
  totalCount: 4
};

export const textPreview: TaskWorkspaceFilePreview = {
  path: "apps/web/components/app-shell.tsx",
  ref: null,
  kind: "text",
  mimeType: "text/typescript",
  encoding: "utf8",
  content: "export function AppShell() {\n  return <main>Storybook shell</main>;\n}\n",
  sizeBytes: 72
};

export const imagePreview: TaskWorkspaceFilePreview = {
  path: "apps/web/public/logo-preview.png",
  ref: null,
  kind: "image",
  mimeType: "image/png",
  encoding: "base64",
  content: imageBase64,
  sizeBytes: 68
};

export const binaryPreview: TaskWorkspaceFilePreview = {
  path: "apps/web/public/archive.zip",
  ref: null,
  kind: "binary",
  mimeType: "application/zip",
  encoding: "base64",
  content: "",
  sizeBytes: 4096
};

export const taskMessages: TaskMessage[] = [
  {
    id: "message-user",
    taskId: tasks[0].id,
    role: "user",
    action: "build",
    content: tasks[0].prompt,
    createdAt: "2026-07-22T08:00:00.000Z"
  },
  {
    id: "message-assistant",
    taskId: tasks[0].id,
    role: "assistant",
    action: "build",
    content: "Added Storybook stories for the app shell and page workflows.",
    createdAt: "2026-07-22T08:24:00.000Z"
  }
];

export const taskRuns: TaskRun[] = [
  {
    id: "run-storybook",
    taskId: tasks[0].id,
    action: "build",
    promptMessageId: taskMessages[0].id,
    provider: "codex",
    providerProfile: "high",
    modelOverride: "gpt-5.5",
    branchName: tasks[0].branchName,
    status: "succeeded",
    startedAt: "2026-07-22T08:02:00.000Z",
    finishedAt: "2026-07-22T08:24:00.000Z",
    summary: "Storybook stories added.",
    changeOutcome: "changed",
    errorMessage: null,
    changeProposalCheckpointRef: "abc1234",
    changeProposalUntrackedPaths: [],
    hasRawJson: true,
    timelineEvents: [
      { id: "event-1", provider: "codex", kind: "run.started", rawEventIndex: 0, title: "Started build" },
      { id: "event-2", provider: "codex", kind: "file.changed", rawEventIndex: 1, title: "Updated Storybook stories", filePath: "apps/web/components/pages.stories.tsx" }
    ],
    logs: []
  }
];

export const taskChangeProposals: TaskChangeProposal[] = [
  {
    id: "proposal-storybook",
    taskId: tasks[0].id,
    sourceType: "build_run",
    sourceId: taskRuns[0].id,
    status: "pending",
    fromRef: "abc1234",
    toRef: "def5678",
    diff: exampleDiff,
    diffStat: "3 files changed, 220 insertions(+)",
    changedFiles: ["apps/web/.storybook/fixtures.ts", "apps/web/components/pages.stories.tsx"],
    diffTruncated: false,
    untrackedPathsAtCheckpoint: [],
    createdAt: "2026-07-22T08:25:00.000Z",
    resolvedAt: null,
    revertedAt: null
  }
];

export const liveDiff: TaskLiveDiff = {
  diff: exampleDiff,
  live: true,
  fetchedAt: storybookNow,
  message: null,
  headBranch: "task/storybook-components",
  headShaShort: "def5678",
  baseRef: "origin/main",
  defaultBaseRef: "origin/main"
};

export const gitState: TaskGitStateSnapshot = {
  fetchedAt: storybookNow,
  pullCount: 1,
  pushCount: 0,
  pushPreview: {
    branchName: "task/storybook-components",
    changedFiles: ["apps/web/components/pages.stories.tsx"],
    diff: exampleDiff,
    diffTruncated: false,
    diffStat: "1 file changed, 40 insertions(+)",
    hasUncommittedChanges: true,
    unpushedCommitSubjects: ["Add Storybook page stories"],
    suggestedCommitMessage: "Add Storybook coverage for web pages"
  }
};

export const commitLog: TaskWorkspaceCommitLog = {
  commits: [
    {
      sha: "def5678def5678def5678",
      shortSha: "def5678",
      subject: "Add Storybook coverage for web pages",
      committedAt: "2026-07-22T08:26:00.000Z",
      authorName: "Verft Agent",
      isPushed: false
    }
  ],
  fetchedAt: storybookNow,
  message: null
};

export const terminalTranscript: TaskInteractiveTerminalTranscript = {
  taskId: tasks[0].id,
  sessionId: "terminal-storybook",
  content: "$ npm run build-storybook -w @verft/web\nStorybook built successfully.\n",
  truncated: false
};

export const integrationRules: IntegrationRule[] = [
  {
    id: "rule-github-review",
    repositoryId: repositories[0].id,
    name: "GitHub review requested",
    enabled: true,
    filter: { conditions: [{ source: "body", field: "action", op: "equals", value: "review_requested" }] },
    mapping: {
      title: "Review {{pull_request.title}}",
      instructions: "Review the pull request and summarize findings.",
      branch: "main"
    },
    execution: { provider: "codex", model: "gpt-5.5", providerProfile: "high" },
    correlationField: "pull_request.number",
    taskOwnerUserId: adminUser.id,
    createdAt: "2026-07-18T08:00:00.000Z",
    updatedAt: storybookNow
  }
];

export const webhookInbox: WebhookInboxEntry[] = [
  {
    id: "webhook-1",
    repositoryId: repositories[0].id,
    headers: { "x-github-event": "pull_request" },
    body: { action: "review_requested", pull_request: { number: 42, title: "Storybook coverage" } },
    sourceIp: "127.0.0.1",
    status: "accepted",
    reason: null,
    matchedRuleId: integrationRules[0].id,
    taskId: tasks[0].id,
    receivedAt: "2026-07-22T09:00:00.000Z"
  }
];

export const hostexecAvailable: HostexecAvailability = {
  available: true,
  enabled: true,
  url: "http://host.docker.internal:38127",
  detected: true,
  allowAll: false,
  commands: ["npm run ci"],
  message: "Hostexec is available."
};
