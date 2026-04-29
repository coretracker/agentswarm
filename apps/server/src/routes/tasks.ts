import path from "node:path";
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
import { getTaskInteractiveTerminalStatus, killTaskInteractiveTerminalSession } from "../lib/task-interactive-terminal.js";
import { applyTaskStartMode, getTriggerActionForNewTask } from "../lib/task-start-mode.js";
import { executeOpenAiDiffAssist } from "../services/openai-diff-assist-service.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskQueueStore } from "../services/task-queue-store.js";
import type { TaskStore } from "../services/task-store.js";
import { buildExecutionSummaryFromPrompt, classifyTaskComplexity } from "../lib/task-intelligence.js";
import { getMutationBlockedReason } from "../lib/task-mutation-guards.js";
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

const taskStartModeSchema = z.enum(["run_now", "prepare_workspace", "idle"]);

const taskPromptAttachmentInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  dataBase64: z.string().trim().min(1)
});

const createTaskSchema = z
  .object({
    title: z.string().min(1),
    repoId: z.string().min(1),
    prompt: z.string().default(""),
    attachments: z.array(taskPromptAttachmentInputSchema).max(TASK_PROMPT_ATTACHMENT_MAX_COUNT).optional(),
    startMode: taskStartModeSchema.optional().default("run_now"),
    taskType: z.enum(["build", "ask"]).optional(),
    provider: z.enum(["codex", "claude"]).optional(),
    providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
    modelOverride: z.string().trim().min(1).optional(),
    codexCredentialSource: z.enum(["auto", "profile", "global"]).optional(),
    baseBranch: z.string().min(1).optional(),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional()
  })
  .superRefine((data, ctx) => {
    if (data.startMode === "run_now" && data.prompt.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt is required when start mode is Run now",
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

const updateTaskStateSchema = z.object({
  status: z.enum(["open", "in_review", "awaiting_review", "done"])
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
  commitMessage: z.string().max(8000).optional()
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

const workspaceFileQuerySchema = z.object({
  path: z.string().trim().min(1).max(4096),
  ref: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/-]+(?:[~^][0-9]*)*$/, "Invalid git ref.")
    .optional(),
  executionId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid execution id.")
    .optional()
});

const workspaceFilesQuerySchema = z.object({
  executionId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid execution id.")
    .optional(),
  prefix: z.string().trim().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(20_000).optional()
});

const updateWorkspaceFileSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  content: z.string().max(8 * 1024 * 1024)
});

const listTasksQuerySchema = z.object({
  view: z.enum(["all", "active", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const archivedTaskReadOnlyMessage = "Archived tasks are read-only";

export const withBranchSyncCounts = async (spawner: SpawnerService, task: Task): Promise<Task> => {
  const { pullCount, pushCount } = await spawner.getTaskBranchSyncCounts(task);
  return {
    ...task,
    pullCount,
    pushCount
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

export const registerTaskRoutes = (
  app: FastifyInstance,
  deps: {
    taskStore: TaskStore;
    taskQueueStore: TaskQueueStore;
    repositoryStore: RepositoryStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
    settingsStore: SettingsStore;
    auth: AuthService;
  }
): void => {
  app.get<{ Querystring: { view?: string; limit?: string } }>(
    "/tasks",
    { preHandler: deps.auth.requireAllScopes(["task:list"]) },
    async (request, reply) => {
      const parsed = listTasksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const userId = request.auth?.user.id ?? null;
      return deps.taskStore.listTasks({
        ownerUserId: isAdminUser(request.auth?.user) ? null : userId,
        view: parsed.data.view ?? "all",
        limit: parsed.data.limit
      });
    }
  );

  app.get<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    return task;
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

  app.get<{ Params: { id: string } }>("/tasks/:id/messages", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    return deps.taskStore.listMessages(task.id);
  });

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

  app.get<{ Params: { id: string } }>("/tasks/:id/runs", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    return deps.taskStore.listRuns(task.id);
  });

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

  app.get<{ Params: { id: string }; Querystring: { executionId?: string; prefix?: string; limit?: string } }>(
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
        executionId: parsed.data.executionId ?? null,
        prefix: parsed.data.prefix ?? null,
        limit: parsed.data.limit
      });
      return reply.send(listing);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { path: string; ref?: string; executionId?: string } }>(
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
          parsed.data.ref ?? null,
          parsed.data.executionId ?? null
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

      const checkpointBlocked = getCheckpointMutationBlockedReason(task.status);
      if (checkpointBlocked) {
        return reply.status(409).send({ message: checkpointBlocked });
      }

      if (await deps.taskStore.getActiveInteractiveSession(task.id)) {
        return reply.status(409).send({ message: "Close the terminal session before editing files." });
      }

      const preview = await deps.spawner.getTaskWorkspaceFilePreview(task, parsed.data.path, null, null);
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

      const refreshed = await deps.spawner.getTaskWorkspaceFilePreview(task, parsed.data.path, null, null);
      if (refreshed === null) {
        return reply.status(404).send({ message: "Workspace file could not be reloaded after saving." });
      }

      await deps.spawner.refreshPendingChangeProposalPreview(task).catch(() => undefined);

      return reply.send(refreshed);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/tasks/:id/change-proposals",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
      if (!task) {
        return;
      }

      return reply.send(await deps.taskStore.listChangeProposals(task.id));
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
      if (!result.ok) {
        return reply.status(409).send({ message: result.message });
      }

      return reply.send(await withBranchSyncCounts(deps.spawner, (await deps.taskStore.getTask(task.id)) ?? task));
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
      if (!result.ok) {
        return reply.status(409).send({ message: result.message });
      }

      return reply.send(await withBranchSyncCounts(deps.spawner, (await deps.taskStore.getTask(task.id)) ?? task));
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
      if (!result.ok) {
        return reply.status(409).send({ message: result.message });
      }

      return reply.send(await withBranchSyncCounts(deps.spawner, (await deps.taskStore.getTask(task.id)) ?? task));
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
      if (!result.ok) {
        return reply.status(409).send({ message: result.message });
      }

      return reply.send(await withBranchSyncCounts(deps.spawner, (await deps.taskStore.getTask(task.id)) ?? task));
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
      if (!result.ok) {
        return reply.status(409).send({ message: result.message });
      }

      return reply.send(await withBranchSyncCounts(deps.spawner, (await deps.taskStore.getTask(task.id)) ?? task));
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

  app.post("/tasks", { preHandler: deps.auth.requireAllScopes(["task:create", "repo:list"]) }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
    if (!repository || !canUserAccessRepository(request.auth?.user, parsed.data.repoId)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const { startMode, attachments: attachmentUploads = [], ...createPayload } = parsed.data;
    if (attachmentUploads.length > 0 && startMode !== "run_now") {
      return reply.status(400).send({ message: "Image attachments are only supported when start mode is Run now." });
    }
    if (
      !requireTaskCapabilityAccess(request, reply, {
        taskType: createPayload.taskType ?? "build",
        startMode
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
        startMode
      },
      repository,
      request.auth!.user.id
    );

    let persistedAttachments: TaskPromptAttachment[] = [];
    if (attachmentUploads.length > 0) {
      try {
        persistedAttachments = await persistTaskPromptAttachments(task.id, attachmentUploads);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image attachments could not be stored.";
        return reply.status(400).send({ message });
      }
      const initialMessage = (await deps.taskStore.listMessages(task.id)).at(-1) ?? null;
      if (initialMessage) {
        await deps.taskStore.setMessageAttachments(task.id, initialMessage.id, persistedAttachments);
      }
    }
    try {
      const result = await applyTaskStartMode(task, startMode, {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler,
        spawner: deps.spawner
      }, {
        content: createPayload.prompt.trim(),
        ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
      });
      return reply.status(201).send(await withBranchSyncCounts(deps.spawner, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task follow-up failed";
      if (startMode === "prepare_workspace") {
        await deps.taskStore.patchTask(task.id, {
          status: "failed",
          enqueued: false,
          errorMessage: message,
          finishedAt: new Date().toISOString()
        });
        await deps.taskStore.appendLog(task.id, `Workspace preparation failed: ${message}`);
      }
      if (startMode === "run_now") {
        return reply.status(409).send({ message });
      }
      return reply.status(500).send({ message });
    }
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

    const allowParallelAsk = parsed.data.action === "ask" && (task.status === "building" || task.status === "asking");

    const blocked = await getMutationBlockedReason(deps.taskStore, task.id);
    if (blocked) {
      return reply.status(409).send({ message: blocked });
    }

    if (isActiveTaskStatus(task.status) && !allowParallelAsk) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    if (allowParallelAsk && !(await deps.scheduler.hasExecutionCapacity())) {
      return reply.status(409).send({ message: "No agent capacity is available for a parallel ask right now." });
    }

    const accepted = await deps.scheduler.triggerAction(task.id, parsed.data.action);
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
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

    const blocked = await getMutationBlockedReason(deps.taskStore, task.id);
    if (blocked) {
      return reply.status(409).send({ message: blocked });
    }

    if (isActiveTaskStatus(task.status)) {
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

    if (isQueuedTaskStatus(task.status) || isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Task state cannot be changed while the task is queued or running" });
    }

    if (task.status === parsed.data.status) {
      return reply.send(await withBranchSyncCounts(deps.spawner, task));
    }

    const updated = await deps.taskStore.setStatus(task.id, parsed.data.status, {
      enqueued: false,
      errorMessage: null
    });
    if (!updated) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return reply.send(await withBranchSyncCounts(deps.spawner, updated));
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

    const allowParallelAsk = action === "ask" && (task.status === "building" || task.status === "asking");

    // comments are treated as read-only messages; ask can also run in parallel with another ask/build.
    if (action !== "comment" && isActiveTaskStatus(task.status) && !allowParallelAsk) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    if (allowParallelAsk && !(await deps.scheduler.hasExecutionCapacity())) {
      return reply.status(409).send({ message: "No agent capacity is available for a parallel ask right now." });
    }

    if (action !== "comment") {
      const blocked = await getMutationBlockedReason(deps.taskStore, task.id);
      if (blocked) {
        return reply.status(409).send({ message: blocked });
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

    const blocked = await getMutationBlockedReason(deps.taskStore, task.id);
    if (blocked) {
      return reply.status(409).send({ message: blocked });
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

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const blockedPush = await getMutationBlockedReason(deps.taskStore, task.id);
    if (blockedPush) {
      return reply.status(409).send({ message: blockedPush });
    }

    const parsed = pushTaskBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const pushed = await deps.spawner.pushTaskBranch(task, {
      commitMessage: parsed.data.commitMessage
    });
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

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const blockedPull = await getMutationBlockedReason(deps.taskStore, task.id);
    if (blockedPull) {
      return reply.status(409).send({ message: blockedPull });
    }

    const pulled = await deps.spawner.pullTaskBranch(task);
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

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
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

    const merged = await deps.spawner.mergeTaskBranch(task, parsed.data.targetBranch, {
      commitMessage: parsed.data.commitMessage
    });
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
      (task.status === "in_review" || task.status === "awaiting_review" || task.status === "open" || task.status === "done" || task.status === "failed");
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
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: "Task is already archived" });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be archived" });
    }

    await deps.spawner.cleanupTaskArtifacts(task);
    await deps.taskQueueStore.removeTask(task.id);
    await deps.taskStore.archiveTask(task.id);
    await deps.taskStore.appendLog(task.id, "Task archived by user.");
    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:delete"]) }, async (request, reply) => {
    const task = await getAccessibleTask(request, reply, deps.taskStore, request.params.id);
    if (!task) {
      return;
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be deleted" });
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
