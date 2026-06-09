import path from "node:path";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getCheckpointMutationBlockedReason,
  isActiveTaskStatus,
  isQueuedTaskStatus,
  TASK_PROMPT_ATTACHMENT_MAX_COUNT,
  type Task,
  type TaskAction,
  type TaskPromptAttachment,
  type TaskTerminalSessionMode
} from "@agentswarm/shared-types";
import type { AuthService } from "../lib/auth.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SnippetStore } from "../services/snippet-store.js";
import type { UserStore } from "../services/user-store.js";
import { getTaskInteractiveTerminalStatus, killTaskInteractiveTerminalSession } from "../lib/task-interactive-terminal.js";
import { getTriggerActionForNewTask, orchestrateTaskActionStart, orchestrateTaskStart } from "../lib/task-start-orchestrator.js";
import { executeOpenAiDiffAssist } from "../services/openai-diff-assist-service.js";
import { executeTaskPromptMagic } from "../services/openai-task-prompt-magic-service.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskQueueStore } from "../services/task-queue-store.js";
import type { TaskStore } from "../services/task-store.js";
import { buildExecutionSummaryFromPrompt, classifyTaskComplexity } from "../lib/task-intelligence.js";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import { persistTaskPromptAttachments, readTaskPromptAttachmentBuffer } from "../lib/task-prompt-attachments.js";
import {
  requireInteractiveTerminalAccess,
  requireTaskActionCapabilityAccess,
  requireTaskCapabilityAccess,
  requireTaskExecutionConfigAccess
} from "../lib/task-capability-access.js";
import { canUserAccessRepository, canUserAccessTask, isAdminUser } from "../lib/task-ownership.js";
import { writeSafeWorkspaceFile } from "../lib/safe-workspace-file.js";
import { env } from "../config/env.js";
import { normalizeProvider } from "../lib/provider-config.js";
import { resolveTaskProviderStatePaths } from "../lib/task-provider-state.js";

const taskPromptAttachmentInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  dataBase64: z.string().trim().min(1)
});

const deadlineSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), "Deadline must be a valid date.")
  .nullable();

const createTaskSchema = z
  .object({
    title: z.string().min(1),
    draft: z.boolean().optional(),
    deadline: deadlineSchema.optional(),
    repoId: z.string().min(1),
    prompt: z.string().default(""),
    notes: z.string().max(40_000).optional(),
    attachments: z.array(taskPromptAttachmentInputSchema).max(TASK_PROMPT_ATTACHMENT_MAX_COUNT).optional(),
    taskType: z.enum(["build", "ask"]).optional(),
    provider: z.enum(["codex", "claude"]).optional(),
    providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
    modelOverride: z.string().trim().min(1).optional(),
    codexCredentialSource: z.enum(["auto", "profile", "global"]).optional(),
    baseBranch: z.string().min(1).optional(),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    task_source: z.enum(["blank", "snippet"]).optional(),
    snippet_id: z.string().trim().min(1).optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.task_source === "snippet") {
      if (!data.snippet_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "snippet_id is required when task_source is snippet",
          path: ["snippet_id"]
        });
      }
    }
    if (data.prompt.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt is required",
        path: ["prompt"]
      });
    }
  });

const triggerTaskActionSchema = z.object({
  action: z.enum(["build", "ask"])
});

const updateTaskConfigSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  providerProfile: z.enum(["low", "medium", "high", "max"]),
  modelOverride: z.string().trim().nullable().optional(),
  codexCredentialSource: z.enum(["auto", "profile", "global"]).optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional()
});

const updateTaskPinSchema = z.object({
  pinned: z.boolean()
});

const updateTaskTitleSchema = z.object({
  title: z.string().trim().min(1).max(500)
});

const updateTaskNotesSchema = z.object({
  notes: z.string().max(40_000)
});

const updateTaskDeadlineSchema = z.object({
  deadline: deadlineSchema
});

const updateTaskDraftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  deadline: deadlineSchema,
  prompt: z.string().trim().default(""),
  notes: z.string().max(40_000).optional(),
  taskType: z.enum(["build", "ask"]),
  provider: z.enum(["codex", "claude"]),
  providerProfile: z.enum(["low", "medium", "high", "max"]),
  modelOverride: z.string().trim().min(1).nullable().optional(),
  codexCredentialSource: z.enum(["auto", "profile", "global"]).optional(),
  baseBranch: z.string().trim().min(1),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"])
});

const updateTaskStateSchema = z.object({
  status: z.enum(["backlog", "ready", "in_progress", "review", "done"])
});

const updateTaskAssigneeSchema = z.object({
  ownerUserId: z.string().trim().min(1)
});

const applyTaskChangeProposalSchema = z.object({
  commitMessage: z.string().trim().min(1).max(200).optional()
});

const revertTaskChangeProposalFileSchema = z.object({
  path: z.string().trim().min(1).max(4096)
});

const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1),
  action: z.enum(["build", "ask", "comment"]).optional(),
  attachments: z.array(taskPromptAttachmentInputSchema).max(TASK_PROMPT_ATTACHMENT_MAX_COUNT).optional()
});

const updateTaskMessageSchema = z.object({
  content: z.string().trim().min(1)
});

const pushTaskBodySchema = z.object({
  commitMessage: z.string().max(8000).optional()
});

const mergeTaskBodySchema = z.object({
  targetBranch: z.string().trim().min(1).max(255),
  commitMessage: z.string().max(8000).optional(),
  deleteRemoteBranch: z.boolean().optional().default(false)
});

const taskBranchCleanupBodySchema = z.object({
  deleteRemoteBranch: z.boolean().optional().default(false)
});

const mergePreviewQuerySchema = z.object({
  targetBranch: z.string().trim().min(1).max(255)
});

const openAiDiffAssistSchema = z.object({
  model: z.string().trim().min(1).max(256),
  providerProfile: z.enum(["low", "medium", "high", "max"]),
  userPrompt: z.string().max(16_000).default(""),
  filePath: z.string().trim().min(1).max(4096),
  selectedSnippet: z.string().max(48_000)
});

const taskPromptMagicSchema = z.object({
  prompt: z.string().max(16_000)
});

const workspaceFileQuerySchema = z.object({
  path: z.string().trim().min(1).max(4096),
  ref: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/-]+(?:[~^][0-9]*)*$/, "Invalid git ref.")
    .optional()
});

const workspaceFilesQuerySchema = z.object({
  prefix: z.string().trim().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(20_000).optional()
});

const workspaceFileSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(512),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const updateWorkspaceFileSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  content: z.string().max(8 * 1024 * 1024)
});

const listTasksQuerySchema = z.object({
  view: z.enum(["all", "active", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const historyPageQuerySchema = z.object({
  before: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid before cursor.")
    .optional(),
  beforeId: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const archivedTaskReadOnlyMessage = "Archived tasks are read-only";
const PROVIDER_SESSION_ID_FILE = "agentswarm-session-id.txt";

const clearTaskProviderSessionId = async (taskId: string): Promise<void> => {
  for (const provider of ["codex", "claude"] as const) {
    const providerStatePath = resolveTaskProviderStatePaths(taskId, provider).serverPath;
    await rm(path.join(providerStatePath, PROVIDER_SESSION_ID_FILE), { force: true }).catch(() => undefined);
  }
};

const applyCreateDefaultsFromSettings = <
  T extends {
    provider?: "codex" | "claude";
    providerProfile?: "low" | "medium" | "high" | "max";
    modelOverride?: string;
    model?: string;
  }
>(
  payload: T,
  settings: Awaited<ReturnType<SettingsStore["getSettings"]>>
): T => {
  const provider = normalizeProvider(payload.provider ?? settings.defaultProvider);
  const providerProfile =
    payload.providerProfile ??
    (provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort);
  const hasLegacyModel = Boolean(payload.model?.trim());
  const modelOverride =
    payload.modelOverride ??
    (hasLegacyModel ? undefined : provider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel);

  return {
    ...payload,
    provider,
    providerProfile,
    modelOverride
  };
};

export const withBranchSyncCounts = async (spawner: SpawnerService, task: Task): Promise<Task> => {
  const { pullCount, pushCount } = await spawner.getTaskBranchSyncCounts(task);
  return {
    ...task,
    pullCount,
    pushCount
  };
};

export const withTaskCreatorName = async (
  userStore: UserStore,
  task: Task,
  creatorNameCache: Map<string, string | null> = new Map()
): Promise<Task> => {
  if (task.creatorName !== undefined) {
    return task;
  }

  const ownerUserId = task.ownerUserId?.trim() ?? "";
  if (!ownerUserId) {
    return {
      ...task,
      creatorName: null
    };
  }

  let creatorName = creatorNameCache.get(ownerUserId);
  if (creatorName === undefined) {
    const creator = await userStore.getUser(ownerUserId);
    creatorName = creator?.name ?? null;
    creatorNameCache.set(ownerUserId, creatorName);
  }

  return {
    ...task,
    creatorName
  };
};

const getChatActionForTask = (task: Task): TaskAction => {
  return task.taskType === "ask" ? "ask" : "build";
};

const getAccessibleTask = async (
  request: FastifyRequest,
  reply: FastifyReply,
  taskStore: TaskStore,
  taskId: string
): Promise<Task | null> => {
  const task = await taskStore.getTask(taskId);
  if (!task || !canUserAccessTask(request.auth?.user, task)) {
    await reply.status(404).send({ message: "Task not found" });
    return null;
  }

  return task;
};

const replyWithMutationBlocked = (reply: FastifyReply, blocked: { code: string; message: string }) =>
  reply.status(409).send({ message: blocked.message, reasonCode: blocked.code });

export const registerTaskRoutes = (
  app: FastifyInstance,
  deps: {
    taskStore: TaskStore;
    taskQueueStore: TaskQueueStore;
    repositoryStore: RepositoryStore;
    userStore: UserStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
    settingsStore: SettingsStore;
    snippetStore: SnippetStore;
    auth: AuthService;
  }
): void => {
  const resolveCheckpointMutationTransition = async (
    task: Task,
    mutationResult: { ok: true } | { ok: false; message: string }
  ): Promise<{ ok: false; message: string } | { ok: true; task: Task }> => {
    if (!mutationResult.ok) {
      return { ok: false, message: mutationResult.message };
    }
    const refreshedTask = (await deps.taskStore.getTask(task.id)) ?? task;
    return {
      ok: true,
      task: await withBranchSyncCounts(deps.spawner, refreshedTask)
    };
  };

  const ensureGitMutationAllowed = async (reply: FastifyReply, task: Task): Promise<boolean> => {
    if (task.status === "archived") {
      await reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      return false;
    }
    const blocked = await getMutationBlocked(deps.taskStore, task.id);
    if (blocked) {
      await replyWithMutationBlocked(reply, blocked);
      return false;
    }
    return true;
  };

  const runGitCommand = async <T>(
    operation: () => Promise<T>,
    fallbackMessage: string
  ): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      return { ok: false, message };
    }
  };

  app.get<{ Querystring: { view?: string; limit?: string } }>(
    "/tasks",
    { preHandler: deps.auth.requireAllScopes(["task:list"]) },
    async (request, reply) => {
      const parsed = listTasksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const userId = request.auth?.user.id ?? null;
      const creatorNameCache = new Map<string, string | null>();
      const tasks = await deps.taskStore.listTasks({
        ownerUserId: isAdminUser(request.auth?.user) ? null : userId,
        view: parsed.data.view ?? "all",
        limit: parsed.data.limit
      });
      return Promise.all(tasks.map((task) => withTaskCreatorName(deps.userStore, task, creatorNameCache)));
    }
  );

  app.get<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    return withTaskCreatorName(deps.userStore, task);
  });

  app.get<{ Params: { id: string } }>(
    "/tasks/:id/branch-sync-counts",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return deps.spawner.getTaskBranchSyncCounts(task);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/tasks/:id/git-operation",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return reply.send(await deps.taskStore.getLatestGitOperation(task.id));
    }
  );

  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    "/tasks/:id/interactive-terminal/status",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      if (!requireInteractiveTerminalAccess(request, reply)) {
        return;
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const terminalMode: TaskTerminalSessionMode = request.query.mode === "git" ? "git" : "interactive";
      const status = await getTaskInteractiveTerminalStatus(
        deps.taskStore,
        deps.settingsStore,
        task.id,
        terminalMode,
        request.auth!.user.id
      );
      return reply.send(status);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/tasks/:id/interactive-terminal/kill",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      if (!requireInteractiveTerminalAccess(request, reply)) {
        return;
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const activeSession = await deps.taskStore.getActiveInteractiveSession(task.id);
      if (!activeSession) {
        return reply.status(409).send({ message: "No terminal session is active for this task." });
      }

      const killedLiveSession = await killTaskInteractiveTerminalSession(task.id);
      if (!killedLiveSession) {
        await deps.spawner.endInteractiveTerminalSession(task.id, activeSession.sessionId);
      }

      await deps.taskStore.appendLog(
        task.id,
        killedLiveSession
          ? `${activeSession.mode === "git" ? "Git" : "Interactive"} terminal session terminated by user via kill switch.`
          : `${activeSession.mode === "git" ? "Git" : "Interactive"} terminal kill requested after the live terminal process was already unreachable; cleaned up the session from server state.`
      );

      const refreshed = await deps.taskStore.getTask(task.id);
      return reply.send(await withBranchSyncCounts(deps.spawner, refreshed ?? task));
    },
  );

  app.get<{ Params: { id: string; sessionId: string } }>(
    "/tasks/:id/interactive-terminal/sessions/:sessionId/transcript",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const transcript = await deps.taskStore.getInteractiveTerminalTranscript(task.id, request.params.sessionId);
      if (!transcript) {
        return reply.status(404).send({ message: "Terminal transcript not found." });
      }

      return reply.send(transcript);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string; limit?: string } }>(
    "/tasks/:id/messages",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsedQuery = historyPageQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ message: parsedQuery.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return reply.send(await deps.taskStore.listMessagesPage(task.id, parsedQuery.data));
    }
  );

  app.get<{ Params: { id: string; messageId: string; attachmentId: string } }>(
    "/tasks/:id/messages/:messageId/attachments/:attachmentId",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const messages = await deps.taskStore.listMessages(task.id);
      const selectedMessage = messages.find((message) => message.id === request.params.messageId) ?? null;
      if (!selectedMessage) {
        return reply.status(404).send({ message: "Message not found." });
      }

      const attachment = (selectedMessage.attachments ?? []).find((item) => item.id === request.params.attachmentId) ?? null;
      if (!attachment) {
        return reply.status(404).send({ message: "Attachment not found." });
      }

      try {
        const buffer = await readTaskPromptAttachmentBuffer(task.id, attachment);
        reply.header("Content-Type", attachment.mimeType);
        reply.header("Cache-Control", "no-store");
        reply.header("Content-Length", String(buffer.length));
        return reply.send(buffer);
      } catch {
        return reply.status(404).send({ message: "Attachment file is unavailable." });
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string; limit?: string } }>(
    "/tasks/:id/runs",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsedQuery = historyPageQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ message: parsedQuery.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return reply.send(await deps.taskStore.listRunsPage(task.id, parsedQuery.data));
    }
  );

  app.get<{ Params: { id: string; runId: string } }>(
    "/tasks/:id/runs/:runId/raw-json",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const run = await deps.taskStore.getRun(request.params.runId);
      if (!run || run.taskId !== task.id) {
        return reply.status(404).send({ message: "Run not found." });
      }

      const rawEventsJsonlPath = deps.spawner.resolveTaskRunRawEventsJsonlPath(task.id, run.id);
      const fileStats = await stat(rawEventsJsonlPath).catch(() => null);
      if (!fileStats?.isFile()) {
        return reply.status(404).send({ message: "Raw JSON stream is unavailable for this run." });
      }

      const provider = run.provider === "claude" ? "claude" : "codex";
      reply.header("Content-Type", "application/x-ndjson");
      reply.header("Cache-Control", "no-store");
      reply.header("Content-Length", String(fileStats.size));
      reply.header("Content-Disposition", `attachment; filename="agentswarm-${task.id}-${run.id}-${provider}-raw.jsonl"`);
      return reply.send(createReadStream(rawEventsJsonlPath));
    }
  );

  app.get<{ Params: { id: string }; Querystring: { base?: string; kind?: string; commit?: string } }>(
    "/tasks/:id/live-diff",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const rawBase = request.query.base;
      const base = typeof rawBase === "string" ? rawBase.trim() : "";
      const rawKind = request.query.kind;
      const diffKind =
        rawKind === "working" ? "working" : rawKind === "commits" ? "commits" : "compare";
      const rawCommit = request.query.commit;
      const commit = typeof rawCommit === "string" ? rawCommit.trim() : "";

      return deps.spawner.getLiveTaskDiff(task, {
        ...(base ? { compareBaseRef: base } : {}),
        diffKind,
        ...(commit ? { commitSha: commit } : {})
      });
    }
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/tasks/:id/workspace-commit-log",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const rawLimit = request.query.limit;
      const limitParsed = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : Number.NaN;
      const limit = Number.isFinite(limitParsed) ? limitParsed : undefined;

      return reply.send(await deps.spawner.getWorkspaceCommitLog(task, { limit }));
    }
  );

  app.get<{ Params: { id: string }; Querystring: { prefix?: string; limit?: string } }>(
    "/tasks/:id/workspace-files",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsed = workspaceFilesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const listing = await deps.spawner.listTaskWorkspaceFiles(task, {
        prefix: parsed.data.prefix ?? null,
        limit: parsed.data.limit
      });
      return reply.send(listing);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string } }>(
    "/tasks/:id/workspace-files/search",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsed = workspaceFileSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      const result = await deps.spawner.searchTaskWorkspaceFiles(task, {
        query: parsed.data.q,
        limit: parsed.data.limit
      });
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { path: string; ref?: string } }>(
    "/tasks/:id/workspace-file",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsed = workspaceFileQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      try {
        const preview = await deps.spawner.getTaskWorkspaceFilePreview(
          task,
          parsed.data.path,
          parsed.data.ref ?? null
        );
        if (preview === null) {
          return reply.status(404).send({ message: "Workspace file not found or is outside the task workspace." });
        }

        return reply.send(preview);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not preview workspace file.";
        return reply.status(413).send({ message });
      }
    }
  );

  app.put<{ Params: { id: string } }>(
    "/tasks/:id/workspace-file",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = updateWorkspaceFileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const checkpointBlocked =
        task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running"
          ? "Checkpoint actions are unavailable while task execution is queued or running."
          : null;
      if (checkpointBlocked) {
        return reply.status(409).send({ message: checkpointBlocked });
      }

      if (await deps.taskStore.getActiveInteractiveSession(task.id)) {
        return reply.status(409).send({ message: "Close the terminal session before editing files." });
      }

      const preview = await deps.spawner.getTaskWorkspaceFilePreview(task, parsed.data.path, null);
      if (preview === null) {
        return reply.status(404).send({ message: "Workspace file not found or is outside the task workspace." });
      }

      if (preview.kind !== "text") {
        return reply.status(409).send({ message: "Only text files can be edited in this modal." });
      }

      const saved = await writeSafeWorkspaceFile(path.join(env.TASK_WORKSPACE_ROOT, task.id), parsed.data.path, parsed.data.content);
      if (!saved) {
        return reply.status(404).send({ message: "Workspace file could not be updated." });
      }

      const refreshed = await deps.spawner.getTaskWorkspaceFilePreview(task, parsed.data.path, null);
      if (refreshed === null) {
        return reply.status(404).send({ message: "Workspace file could not be reloaded after saving." });
      }

      await deps.spawner.refreshPendingChangeProposalPreview(task).catch(() => undefined);

      return reply.send(refreshed);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string; limit?: string } }>(
    "/tasks/:id/change-proposals",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsedQuery = historyPageQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ message: parsedQuery.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return reply.send(await deps.taskStore.listChangeProposalsPage(task.id, parsedQuery.data));
    }
  );

  app.post<{ Params: { id: string; proposalId: string }; Body: { commitMessage?: string } }>(
    "/tasks/:id/change-proposals/:proposalId/apply",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = applyTaskChangeProposalSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const result = await deps.spawner.applyChangeProposal(task, request.params.proposalId, {
        commitMessage: parsed.data.commitMessage ?? null
      });
      const transition = await resolveCheckpointMutationTransition(task, result);
      if (!transition.ok) {
        return reply.status(409).send({ message: transition.message });
      }
      return reply.send(transition.task);
    }
  );

  /** @deprecated Prefer POST .../apply */
  app.post<{ Params: { id: string; proposalId: string }; Body: { commitMessage?: string } }>(
    "/tasks/:id/change-proposals/:proposalId/accept",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = applyTaskChangeProposalSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const result = await deps.spawner.applyChangeProposal(task, request.params.proposalId, {
        commitMessage: parsed.data.commitMessage ?? null
      });
      const transition = await resolveCheckpointMutationTransition(task, result);
      if (!transition.ok) {
        return reply.status(409).send({ message: transition.message });
      }
      return reply.send(transition.task);
    }
  );

  app.post<{ Params: { id: string; proposalId: string } }>(
    "/tasks/:id/change-proposals/:proposalId/revert",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const result = await deps.spawner.revertChangeProposal(task, request.params.proposalId);
      const transition = await resolveCheckpointMutationTransition(task, result);
      if (!transition.ok) {
        return reply.status(409).send({ message: transition.message });
      }
      return reply.send(transition.task);
    }
  );

  app.post<{ Params: { id: string; proposalId: string }; Body: { path: string } }>(
    "/tasks/:id/change-proposals/:proposalId/revert-file",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = revertTaskChangeProposalFileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const result = await deps.spawner.revertPendingChangeProposalFile(task, request.params.proposalId, parsed.data.path);
      const transition = await resolveCheckpointMutationTransition(task, result);
      if (!transition.ok) {
        return reply.status(409).send({ message: transition.message });
      }
      return reply.send(transition.task);
    }
  );

  app.post<{ Params: { id: string; proposalId: string } }>(
    "/tasks/:id/change-proposals/:proposalId/reject",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const result = await deps.spawner.rejectChangeProposal(task, request.params.proposalId);
      const transition = await resolveCheckpointMutationTransition(task, result);
      if (!transition.ok) {
        return reply.status(409).send({ message: transition.message });
      }
      return reply.send(transition.task);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/tasks/:id/openai/diff-assist",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const parsed = openAiDiffAssistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const auth = request.auth;
      if (!auth) {
        return reply.status(401).send({ message: "Authentication required" });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials();
      const settings = await deps.settingsStore.getSettings();
      if (!credentials.openaiApiKey) {
        return reply.status(400).send({ message: "OpenAI API key is not configured in Settings." });
      }

      try {
        const result = await executeOpenAiDiffAssist({
          taskId: task.id,
          model: parsed.data.model,
          providerProfile: parsed.data.providerProfile,
          userPrompt: parsed.data.userPrompt,
          filePath: parsed.data.filePath,
          selectedSnippet: parsed.data.selectedSnippet,
          openaiApiKey: credentials.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
        ) {
          const status = (error as { status: number }).status;
          const message = error instanceof Error ? error.message : "Request failed";
          return reply.status(status).send({ message });
        }
        throw error;
      }
    }
  );

  app.post(
    "/tasks/prompt-magic",
    { preHandler: deps.auth.requireAllScopes(["task:create"]) },
    async (request, reply) => {
      const parsed = taskPromptMagicSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials();
      const settings = await deps.settingsStore.getSettings();
      if (!credentials.openaiApiKey) {
        return reply.status(400).send({ message: "OpenAI API key is not configured in Settings." });
      }

      try {
        const result = await executeTaskPromptMagic({
          prompt: parsed.data.prompt,
          model: settings.taskPromptMagicModel,
          template: settings.taskPromptMagicTemplate,
          openaiApiKey: credentials.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl
        });
        return reply.send(result);
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
        ) {
          const status = (error as { status: number }).status;
          const message = error instanceof Error ? error.message : "Request failed";
          return reply.status(status).send({ message });
        }
        throw error;
      }
    }
  );

  app.post("/tasks", { preHandler: deps.auth.requireAllScopes(["task:create", "repo:list"]) }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
    if (!repository || !canUserAccessRepository(request.auth?.user, parsed.data.repoId)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const {
      attachments: attachmentUploads = [],
      ...rawCreatePayload
    } = parsed.data;
    const settings = await deps.settingsStore.getSettings();
    const createPayload = applyCreateDefaultsFromSettings(rawCreatePayload, settings);
    if (
      !requireTaskCapabilityAccess(request, reply, {
        taskType: createPayload.taskType ?? "build"
      })
    ) {
      return;
    }
    if (!requireTaskExecutionConfigAccess(request, reply, createPayload)) {
      return;
    }

    const task = await deps.taskStore.createTask(
      {
        ...createPayload,
        prompt: createPayload.prompt.trim(),
        notes: createPayload.notes?.trim() ?? ""
      },
      repository,
      request.auth!.user.id
    );
    const taskWithCreator = await deps.taskStore.patchTask(task.id, {
      creatorName: request.auth!.user.name
    });
    const createdTask = taskWithCreator ?? {
      ...task,
      creatorName: request.auth!.user.name
    };

    let persistedAttachments: TaskPromptAttachment[] = [];
    if (attachmentUploads.length > 0) {
      try {
        persistedAttachments = await persistTaskPromptAttachments(createdTask.id, attachmentUploads);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image attachments could not be stored.";
        return reply.status(400).send({ message });
      }
      const initialMessage = (await deps.taskStore.listMessages(createdTask.id)).at(-1) ?? null;
      if (initialMessage) {
        await deps.taskStore.setMessageAttachments(createdTask.id, initialMessage.id, persistedAttachments);
      }
    }
    if (createPayload.draft === true) {
      await deps.taskStore.appendMessage(createdTask.id, {
        role: "user",
        action: getTriggerActionForNewTask(createdTask),
        content: createPayload.prompt.trim().length > 0 ? createPayload.prompt.trim() : "(No prompt provided.)",
        ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
      });
      const draftTask = (await deps.taskStore.getTask(createdTask.id)) ?? createdTask;
      return reply.status(201).send(await withTaskCreatorName(deps.userStore, draftTask));
    }
    const startResult = await orchestrateTaskStart(
      {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler,
        spawner: deps.spawner
      },
      {
        task: createdTask,
        fallbackMessage: "Task follow-up failed",
        input: {
          content: createPayload.prompt.trim(),
          ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
        }
      }
    );
    if (!startResult.ok) {
      return reply.status(startResult.statusCode).send({ message: startResult.message });
    }

    return reply.status(201).send(await withTaskCreatorName(deps.userStore, await withBranchSyncCounts(deps.spawner, startResult.task)));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/actions", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = triggerTaskActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (!requireTaskActionCapabilityAccess(request, reply, parsed.data.action)) {
      return;
    }

    const allowParallelAsk =
      parsed.data.action === "ask" &&
      task.executionStatus === "running" &&
      (task.executionAction === "build" || task.executionAction === "ask");
    const actionStartResult = await orchestrateTaskActionStart(
      {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler
      },
      {
        task,
        action: parsed.data.action,
        allowParallelAsk,
        busyMessage: "Task is already running",
        triggerRejectedMessage: "Task is already running",
        capacityMessage: "No agent capacity is available for a parallel ask right now."
      }
    );
    if (!actionStartResult.ok) {
      const body = actionStartResult.reasonCode
        ? { message: actionStartResult.message, reasonCode: actionStartResult.reasonCode }
        : { message: actionStartResult.message };
      return reply.status(actionStartResult.statusCode).send(body);
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/start", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status !== "draft") {
      return reply.status(409).send({ message: "Only draft tasks can be started with this endpoint." });
    }

    const action = getTriggerActionForNewTask(task);
    if (!requireTaskActionCapabilityAccess(request, reply, action)) {
      return;
    }

    const promotedTask = await deps.taskStore.setStatus(task.id, "open", {
      executionStatus: "idle",
      executionAction: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null
    });
    const startTask = promotedTask ?? task;
    const messages = await deps.taskStore.listMessages(task.id);
    const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
    const startResult = await orchestrateTaskStart(
      {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler,
        spawner: deps.spawner
      },
      {
        task: startTask,
        fallbackMessage: "Draft task start failed",
        input: {
          content: firstUserMessage?.content?.trim() || startTask.prompt,
          ...(firstUserMessage?.attachments && firstUserMessage.attachments.length > 0 ? { attachments: firstUserMessage.attachments } : {})
        }
      }
    );
    if (!startResult.ok) {
      await deps.taskStore.setStatus(task.id, "draft", {
        executionStatus: "idle",
        executionAction: null,
        enqueued: false
      });
      return reply.status(startResult.statusCode).send({ message: startResult.message });
    }

    return reply.send(await withTaskCreatorName(deps.userStore, await withBranchSyncCounts(deps.spawner, startResult.task)));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/new-session", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const blocked = await getMutationBlocked(deps.taskStore, task.id);
    if (blocked) {
      return replyWithMutationBlocked(reply, blocked);
    }

    if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
      return reply.status(409).send({ message: "Task is already running" });
    }

    await clearTaskProviderSessionId(task.id);
    await deps.taskStore.appendLog(task.id, "Session reset requested. Next run starts with a fresh provider session.");

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed ?? task);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/postflight", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (!requireTaskActionCapabilityAccess(request, reply, "build")) {
      return;
    }

    if (task.taskType !== "build") {
      return reply.status(409).send({ message: "Postflight is only available for build tasks." });
    }

    const blocked = await getMutationBlocked(deps.taskStore, task.id);
    if (blocked) {
      return replyWithMutationBlocked(reply, blocked);
    }

    if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
      return reply.status(409).send({ message: "Task is already running" });
    }

    try {
      await deps.spawner.validateTaskPostflight(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Postflight is not available for this task.";
      return reply.status(409).send({ message });
    }

    const accepted = await deps.scheduler.triggerPostflight(task.id);
    if (!accepted) {
      return reply.status(409).send({ message: "No agent capacity is available to run postflight right now." });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.status(202).send(refreshed ?? task);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const accepted = await deps.scheduler.cancelTask(task.id);
    if (!accepted) {
      return reply.status(409).send({ message: "Task cannot be cancelled in its current state" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/draft", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status !== "draft") {
      return reply.status(409).send({ message: "Only draft tasks can be edited with this endpoint." });
    }

    const repository = await deps.repositoryStore.getRepository(task.repoId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }
    if (!canUserAccessRepository(request.auth?.user, repository.id)) {
      return reply.status(403).send({ message: "Repository access denied" });
    }

    if (!requireTaskCapabilityAccess(request, reply, { taskType: parsed.data.taskType })) {
      return;
    }
    if (!requireTaskExecutionConfigAccess(request, reply, parsed.data)) {
      return;
    }

    const prompt = parsed.data.prompt.trim().length > 0 ? parsed.data.prompt.trim() : "(No prompt provided.)";
    const title = parsed.data.title.trim();
    const baseBranch = parsed.data.baseBranch.trim();
    const deadline = parsed.data.deadline === null ? null : new Date(Date.parse(parsed.data.deadline)).toISOString();
    const action: TaskAction = parsed.data.taskType === "ask" ? "ask" : "build";
    const codexCredentialSource = parsed.data.provider === "codex" ? (parsed.data.codexCredentialSource ?? task.codexCredentialSource ?? "auto") : undefined;
    const updated = await deps.taskStore.patchTask(task.id, {
      title,
      deadline,
      prompt,
      notes: parsed.data.notes?.trim() ?? "",
      taskType: parsed.data.taskType,
      provider: normalizeProvider(parsed.data.provider),
      providerProfile: parsed.data.providerProfile,
      modelOverride: parsed.data.modelOverride?.trim() || null,
      codexCredentialSource,
      baseBranch,
      branchStrategy: parsed.data.branchStrategy,
      branchName: parsed.data.branchStrategy === "work_on_branch" ? baseBranch : null,
      complexity: classifyTaskComplexity(title, prompt),
      executionSummary: buildExecutionSummaryFromPrompt(title, prompt),
      lastAction: action
    });
    if (!updated) {
      return reply.status(404).send({ message: "Task not found" });
    }

    const messages = await deps.taskStore.listMessages(task.id);
    const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
    if (firstUserMessage) {
      await deps.taskStore.updateMessage(task.id, firstUserMessage.id, prompt);
    } else {
      await deps.taskStore.appendMessage(task.id, {
        role: "user",
        action,
        content: prompt
      });
    }

    return reply.send(await withTaskCreatorName(deps.userStore, await withBranchSyncCounts(deps.spawner, updated)));
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/config", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }
    if (!requireTaskExecutionConfigAccess(request, reply, parsed.data)) {
      return;
    }

    const updated = await deps.taskStore.patchTask(task.id, {
      provider: parsed.data.provider,
      providerProfile: parsed.data.providerProfile,
      modelOverride: parsed.data.modelOverride?.trim() || null,
      codexCredentialSource: parsed.data.codexCredentialSource ?? task.codexCredentialSource,
      branchStrategy: parsed.data.branchStrategy ?? task.branchStrategy,
      branchName:
        (parsed.data.branchStrategy ?? task.branchStrategy) === "work_on_branch"
          ? task.baseBranch
          : task.branchStrategy === "work_on_branch"
            ? null
            : task.branchName
    });

    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/pin", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskPinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const updated = await deps.taskStore.patchTask(task.id, {
      pinned: parsed.data.pinned
    });

    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/title", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskTitleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const title = parsed.data.title;
    const complexity = classifyTaskComplexity(title, task.prompt);
    const executionSummary = buildExecutionSummaryFromPrompt(title, task.prompt);

    const updated = await deps.taskStore.patchTask(task.id, {
      title,
      complexity,
      executionSummary
    });

    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/notes", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskNotesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const updated = await deps.taskStore.patchTask(task.id, {
      notes: parsed.data.notes.trim()
    });

    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/deadline", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskDeadlineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const deadline = parsed.data.deadline === null ? null : new Date(Date.parse(parsed.data.deadline)).toISOString();
    const updated = await deps.taskStore.patchTask(task.id, {
      deadline
    });

    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/state", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskStateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (task.workflowStatus === parsed.data.status) {
      return reply.send(await withBranchSyncCounts(deps.spawner, task));
    }

    const updated = await deps.taskStore.patchTask(task.id, {
      workflowStatus: parsed.data.status
    });
    if (!updated) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return reply.send(await withBranchSyncCounts(deps.spawner, updated));
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id/assignee", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskAssigneeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (!isAdminUser(request.auth?.user)) {
      return reply.status(403).send({ message: "Only admins can reassign tasks." });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const nextOwnerUserId = parsed.data.ownerUserId.trim();
    if (nextOwnerUserId === task.ownerUserId) {
      return reply.send(await withTaskCreatorName(deps.userStore, task));
    }

    const targetUser = await deps.userStore.getUser(nextOwnerUserId);
    if (!targetUser) {
      return reply.status(404).send({ message: "Assignee user not found" });
    }
    if (!targetUser.active) {
      return reply.status(409).send({ message: "Cannot assign tasks to inactive users." });
    }

    const taskWithCreator = await withTaskCreatorName(deps.userStore, task);
    const updated = await deps.taskStore.patchTask(task.id, {
      ownerUserId: targetUser.id,
      creatorName: taskWithCreator.creatorName ?? null
    });
    if (!updated) {
      return reply.status(404).send({ message: "Task not found" });
    }

    await deps.taskStore.appendLog(task.id, `Task assigned to ${targetUser.name} by ${request.auth!.user.name}.`);
    return reply.send(await withTaskCreatorName(deps.userStore, updated));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/messages", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = createTaskMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const action = parsed.data.action ?? getChatActionForTask(task);
    if (action !== "comment" && !requireTaskActionCapabilityAccess(request, reply, action)) {
      return;
    }

    const allowParallelAsk =
      action === "ask" &&
      task.executionStatus === "running" &&
      (task.executionAction === "build" || task.executionAction === "ask");

    // comments are treated as read-only messages; ask can also run in parallel with another ask/build.
    if (
      action !== "comment" &&
      (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") &&
      !allowParallelAsk
    ) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    if (allowParallelAsk && !(await deps.scheduler.hasExecutionCapacity())) {
      return reply.status(409).send({ message: "No agent capacity is available for a parallel ask right now." });
    }

    if (action !== "comment") {
      const blocked = await getMutationBlocked(deps.taskStore, task.id);
      if (blocked) {
        return replyWithMutationBlocked(reply, blocked);
      }
    }

    let persistedAttachments: TaskPromptAttachment[] = [];
    if ((parsed.data.attachments ?? []).length > 0) {
      try {
        persistedAttachments = await persistTaskPromptAttachments(task.id, parsed.data.attachments);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image attachments could not be stored.";
        return reply.status(400).send({ message });
      }
    }

    await deps.taskStore.appendMessage(task.id, {
      role: "user",
      action,
      content: parsed.data.content,
      attachments: persistedAttachments
    });

    if (action === "comment") {
      const refreshed = await deps.taskStore.getTask(task.id);
      return reply.send(refreshed);
    }

    const accepted = await deps.scheduler.triggerAction(task.id, action, {
      content: parsed.data.content,
      ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
    });
    if (!accepted) {
      return reply.status(409).send({ message: "Task execution could not be started" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.patch<{ Params: { id: string; messageId: string } }>(
    "/tasks/:id/messages/:messageId",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = updateTaskMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      const existingMessage = (await deps.taskStore.listMessages(task.id)).find((message) => message.id === request.params.messageId);
      if (!existingMessage) {
        return reply.status(404).send({ message: "Message not found" });
      }

      if (existingMessage.role !== "user" || existingMessage.action !== "comment") {
        return reply.status(409).send({ message: "Only user comments can be edited" });
      }

      const updatedMessage = await deps.taskStore.updateMessage(task.id, existingMessage.id, parsed.data.content);
      if (!updatedMessage) {
        return reply.status(404).send({ message: "Message not found" });
      }

      return reply.send(updatedMessage);
    }
  );

  app.get<{ Params: { id: string } }>("/tasks/:id/push-preview", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const blocked = await getMutationBlocked(deps.taskStore, task.id);
    if (blocked) {
      return replyWithMutationBlocked(reply, blocked);
    }

    try {
      const preview = await deps.spawner.getTaskPushPreview(task);
      return reply.send(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push preview failed";
      return reply.status(400).send({ message });
    }
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/push", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (!(await ensureGitMutationAllowed(reply, task))) {
      return;
    }

    const parsed = pushTaskBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const pushResult = await runGitCommand(
      () =>
        deps.spawner.pushTaskBranch(task, {
          commitMessage: parsed.data.commitMessage
        }),
      "Push failed"
    );
    if (!pushResult.ok) {
      return reply.status(400).send({ message: pushResult.message });
    }
    const pushed = pushResult.value;
    const pushedRefreshed = await deps.taskStore.patchTask(pushed.id, {});
    const pushedTask = pushedRefreshed ?? pushed;
    const pushedBranchName =
      pushedTask.branchStrategy === "work_on_branch" ? pushedTask.baseBranch : pushedTask.branchName ?? task.branchName ?? task.baseBranch;
    if (pushedBranchName) {
      await deps.taskStore.publishTaskPushedEvent({
        taskId: pushedTask.id,
        branchName: pushedBranchName,
        commitMessage: parsed.data.commitMessage?.trim() || null
      });
    }
    return reply.send(await withBranchSyncCounts(deps.spawner, pushedTask));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/pull", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (!(await ensureGitMutationAllowed(reply, task))) {
      return;
    }

    const pullResult = await runGitCommand(() => deps.spawner.pullTaskBranch(task), "Pull failed");
    if (!pullResult.ok) {
      return reply.status(400).send({ message: pullResult.message });
    }
    const pulled = pullResult.value;
    const pulledRefreshed = await deps.taskStore.patchTask(pulled.id, {});
    return reply.send(await withBranchSyncCounts(deps.spawner, pulledRefreshed ?? pulled));
  });

  app.get<{ Params: { id: string }; Querystring: { targetBranch: string } }>(
    "/tasks/:id/merge-preview",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const parsed = mergePreviewQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      if (task.branchStrategy !== "feature_branch") {
        return reply.status(409).send({ message: "Only feature-branch tasks have a mergeable branch" });
      }

      if (!task.branchName) {
        return reply.status(409).send({ message: "Task branch is not available for merging" });
      }

      try {
        return reply.send(await deps.spawner.getTaskMergePreview(task, parsed.data.targetBranch));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Merge preview failed";
        return reply.status(400).send({ message });
      }
    }
  );

  app.post<{ Params: { id: string } }>("/tasks/:id/merge", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (!(await ensureGitMutationAllowed(reply, task))) {
      return;
    }

    if (task.branchStrategy !== "feature_branch") {
      return reply.status(409).send({ message: "Only feature-branch tasks have a mergeable branch" });
    }

    const parsed = mergeTaskBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    if (!task.branchName) {
      return reply.status(409).send({ message: "Task branch is not available for merging" });
    }

    if (task.branchName === parsed.data.targetBranch) {
      return reply.status(409).send({ message: "Task branch cannot merge into itself" });
    }

    const mergeResult = await runGitCommand(
      () =>
        deps.spawner.mergeTaskBranch(task, parsed.data.targetBranch, {
          commitMessage: parsed.data.commitMessage
        }),
      "Merge failed"
    );
    if (!mergeResult.ok) {
      return reply.status(400).send({ message: mergeResult.message });
    }
    const merged = mergeResult.value;
    if (parsed.data.deleteRemoteBranch) {
      try {
        await deps.spawner.deleteTaskRemoteBranch(task);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Remote branch deletion failed.";
        await deps.taskStore.appendLog(merged.id, `Warning: ${message}`);
      }
    }
    await deps.taskStore.publishTaskMergedEvent({
      taskId: merged.id,
      sourceBranch: task.branchName,
      targetBranch: parsed.data.targetBranch.trim(),
      commitMessage: parsed.data.commitMessage?.trim() || null
    });
    await deps.taskQueueStore.removeTask(merged.id);
    await deps.taskStore.archiveTask(merged.id);
    await deps.taskStore.appendLog(merged.id, "Task archived after merge.");
    const refreshed = await deps.taskStore.getTask(merged.id);
    return reply.send(await withBranchSyncCounts(deps.spawner, refreshed ?? merged));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/accept", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const canPublishBuild =
      task.taskType === "build" &&
      (task.status === "in_review" || task.status === "awaiting_review" || task.status === "open" || task.status === "in_progress" || task.status === "done");
    const canAcceptAsk = task.taskType === "ask" && (task.status === "open" || task.status === "done") && Boolean(task.resultMarkdown?.trim());
    if (!canPublishBuild && !canAcceptAsk) {
      return reply.status(409).send({ message: "Only ready task results can be accepted" });
    }

    if (task.taskType === "build") {
      const accepted = await deps.spawner.publishAcceptedTask(task);
      return reply.send(accepted);
    }

    const accepted = await deps.taskStore.setStatus(task.id, "open", {
      errorMessage: null,
      enqueued: false
    });
    await deps.taskStore.appendLog(task.id, "Ask result accepted; task remains open.");
    return reply.send(accepted);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/archive", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = taskBranchCleanupBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: "Task is already archived" });
    }

    if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
      return reply.status(409).send({ message: "Active tasks cannot be archived" });
    }

    if (parsed.data.deleteRemoteBranch) {
      const deleteResult = await runGitCommand(() => deps.spawner.deleteTaskRemoteBranch(task), "Remote branch deletion failed");
      if (!deleteResult.ok) {
        return reply.status(400).send({ message: deleteResult.message });
      }
    }

    await deps.spawner.cleanupTaskArtifacts(task);
    await deps.taskQueueStore.removeTask(task.id);
    await deps.taskStore.archiveTask(task.id);
    await deps.taskStore.appendLog(task.id, "Task archived by user.");
    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:delete"]) }, async (request, reply) => {
    const parsed = taskBranchCleanupBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
      return reply.status(409).send({ message: "Active tasks cannot be deleted" });
    }

    if (parsed.data.deleteRemoteBranch) {
      const deleteResult = await runGitCommand(() => deps.spawner.deleteTaskRemoteBranch(task), "Remote branch deletion failed");
      if (!deleteResult.ok) {
        return reply.status(400).send({ message: deleteResult.message });
      }
    }

    await deps.spawner.cleanupTaskArtifacts(task);
    await deps.taskQueueStore.removeTask(task.id);
    await deps.taskStore.deleteTask(task.id);
    return reply.status(204).send();
  });

  // Backward compatibility: /run maps to build.
  app.post<{ Params: { id: string } }>("/tasks/:id/run", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const action = getTriggerActionForNewTask(task);
    if (!requireTaskActionCapabilityAccess(request, reply, action)) {
      return;
    }

    const accepted = await deps.scheduler.triggerAction(task.id, action);
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });
};
