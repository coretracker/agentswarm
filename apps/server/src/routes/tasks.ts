import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { isActiveTaskStatus, type Task, type TaskAction } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import type { AuthService } from "../lib/auth.js";
import { resolveLocalPlanRevisionPath } from "../lib/plan-path.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { RepositoryStore } from "../services/repository-store.js";
import { getTaskInteractiveTerminalStatus } from "../lib/task-interactive-terminal.js";
import { applyTaskStartMode, getTriggerActionForNewTask } from "../lib/task-start-mode.js";
import { executeOpenAiDiffAssist } from "../services/openai-diff-assist-service.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { buildExecutionSummaryFromPrompt, classifyTaskComplexity } from "../lib/task-intelligence.js";

const taskStartModeSchema = z.enum(["run_now", "prepare_workspace", "idle"]);

const createTaskSchema = z
  .object({
    title: z.string().min(1),
    repoId: z.string().min(1),
    prompt: z.string().default(""),
    startMode: taskStartModeSchema.optional().default("run_now"),
    taskType: z.enum(["build", "ask"]).optional(),
    provider: z.enum(["codex", "claude"]).optional(),
    providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
    modelOverride: z.string().trim().min(1).optional(),
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
  action: z.enum(["build", "ask"]),
  iterateInput: z.string().optional()
});

const updateTaskConfigSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  providerProfile: z.enum(["low", "medium", "high", "max"]),
  modelOverride: z.string().trim().nullable().optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional()
});

const updateTaskPinSchema = z.object({
  pinned: z.boolean()
});

const updateTaskTitleSchema = z.object({
  title: z.string().trim().min(1).max(500)
});

const updateTaskPlanSchema = z.object({
  planMarkdown: z.string().trim().min(1)
});

const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1),
  action: z.enum(["build", "ask", "comment"]).optional()
});

const pushTaskBodySchema = z.object({
  commitMessage: z.string().max(8000).optional()
});

const openAiDiffAssistSchema = z.object({
  mode: z.enum(["read", "readwrite"]),
  model: z.string().trim().min(1).max(256),
  providerProfile: z.enum(["low", "medium", "high", "max"]),
  userPrompt: z.string().max(16_000).default(""),
  filePath: z.string().trim().min(1).max(4096),
  selectedSnippet: z.string().max(48_000)
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
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  if (task.taskType === "build" || task.taskType === "plan") {
    return "build";
  }

  if (task.branchDiff?.trim() || task.status === "review" || task.lastAction === "build") {
    return "build";
  }

  return "build";
};

export const registerTaskRoutes = (
  app: FastifyInstance,
  deps: {
    taskStore: TaskStore;
    repositoryStore: RepositoryStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
    settingsStore: SettingsStore;
    auth: AuthService;
  }
): void => {
  app.get("/tasks", { preHandler: deps.auth.requireAllScopes(["task:list"]) }, async () => deps.taskStore.listTasks());

  app.get<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return withBranchSyncCounts(deps.spawner, task);
  });

  app.get<{ Params: { id: string } }>(
    "/tasks/:id/interactive-terminal/status",
    { preHandler: deps.auth.requireAllScopes(["task:edit"]) },
    async (request, reply) => {
      const status = await getTaskInteractiveTerminalStatus(
        deps.taskStore,
        deps.settingsStore,
        request.params.id,
      );
      return reply.send(status);
    },
  );

  app.get<{ Params: { id: string } }>("/tasks/:id/messages", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return deps.taskStore.listMessages(task.id);
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/runs", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return deps.taskStore.listRuns(task.id);
  });

  app.get<{ Params: { id: string }; Querystring: { base?: string; kind?: string } }>(
    "/tasks/:id/live-diff",
    { preHandler: deps.auth.requireAllScopes(["task:read"]) },
    async (request, reply) => {
      const task = await deps.taskStore.getTask(request.params.id);
      if (!task) {
        return reply.status(404).send({ message: "Task not found" });
      }

      const rawBase = request.query.base;
      const base = typeof rawBase === "string" ? rawBase.trim() : "";
      const rawKind = request.query.kind;
      const diffKind = rawKind === "working" ? "working" : "compare";

      return deps.spawner.getLiveTaskDiff(task, {
        ...(base ? { compareBaseRef: base } : {}),
        diffKind
      });
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

      if (parsed.data.mode === "readwrite" && !auth.scopes.has("task:edit")) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const task = await deps.taskStore.getTask(request.params.id);
      if (!task) {
        return reply.status(404).send({ message: "Task not found" });
      }

      if (task.status === "archived") {
        return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
      }

      if (parsed.data.mode === "readwrite" && isActiveTaskStatus(task.status)) {
        return reply.status(409).send({ message: "Cannot apply OpenAI edits while the task is running." });
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials();
      const settings = await deps.settingsStore.getSettings();
      if (!credentials.openaiApiKey) {
        return reply.status(400).send({ message: "OpenAI API key is not configured in Settings." });
      }

      try {
        const result = await executeOpenAiDiffAssist({
          mode: parsed.data.mode,
          taskId: task.id,
          model: parsed.data.model,
          providerProfile: parsed.data.providerProfile,
          userPrompt: parsed.data.userPrompt,
          filePath: parsed.data.filePath,
          selectedSnippet: parsed.data.selectedSnippet,
          openaiApiKey: credentials.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl,
          agentRules: settings.agentRules
        });

        if (result.mode === "readwrite") {
          await deps.taskStore.appendLog(task.id, `OpenAI diff assist wrote file: ${result.appliedRelativePath}`);
        }

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
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const { startMode, ...createPayload } = parsed.data;
    const task = await deps.taskStore.createTask(
      {
        ...createPayload,
        prompt: createPayload.prompt.trim(),
        startMode
      },
      repository
    );
    try {
      const result = await applyTaskStartMode(task, startMode, {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler,
        spawner: deps.spawner
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

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const accepted = await deps.scheduler.triggerAction(
      task.id,
      parsed.data.action,
      parsed.data.iterateInput?.trim() || undefined
    );
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
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

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const updated = await deps.taskStore.patchTask(task.id, {
      provider: parsed.data.provider,
      providerProfile: parsed.data.providerProfile,
      modelOverride: parsed.data.modelOverride?.trim() || null,
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

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
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

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
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

  app.patch<{ Params: { id: string } }>("/tasks/:id/plan", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateTaskPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (task.taskType !== "plan") {
      return reply.status(409).send({ message: "Only plan tasks support manual plan editing" });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be edited" });
    }

    await deps.spawner.cleanupTaskArtifacts(task, { preservePlanFile: true });

    const planPath = resolveLocalPlanRevisionPath(task, env.LOCAL_PLANS_ROOT, `manual-${Date.now()}`);
    await mkdir(env.LOCAL_PLANS_ROOT, { recursive: true });
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, `${parsed.data.planMarkdown}\n`, "utf8");

    const updated = await deps.taskStore.saveManualPlanEdit(task.id, planPath, parsed.data.planMarkdown);
    const manualRun = await deps.taskStore.createRun(task.id, {
      action: "plan",
      provider: task.provider,
      providerProfile: task.providerProfile,
      modelOverride: task.modelOverride,
      branchName: task.branchName ?? task.baseBranch
    });
    if (manualRun) {
      await deps.taskStore.updateRun(manualRun.id, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        summary: parsed.data.planMarkdown
      });
      await deps.taskStore.patchTask(task.id, { currentPlanRunId: manualRun.id });
    }
    await deps.taskStore.appendLog(task.id, "Plan manually edited by user.");
    return reply.send((await deps.taskStore.getTask(task.id)) ?? updated);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/messages", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = createTaskMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const action = parsed.data.action ?? getChatActionForTask(task);

    // comments are treated as read-only messages; other actions can always run
    if (action !== "comment" && isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    await deps.taskStore.appendMessage(task.id, {
      role: "user",
      action,
      content: parsed.data.content
    });

    if (action === "comment") {
      const refreshed = await deps.taskStore.getTask(task.id);
      return reply.send(refreshed);
    }

    const accepted = await deps.scheduler.triggerAction(task.id, action, parsed.data.content);
    if (!accepted) {
      return reply.status(409).send({ message: "Task execution could not be started" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.post<{ Params: { id: string; runId: string } }>("/tasks/:id/build-from-run/:runId", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (task.taskType !== "plan") {
      return reply.status(409).send({ message: "Only plan tasks can build from a specific plan run" });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    if (task.builtPlanRunIds.includes(request.params.runId)) {
      return reply.status(409).send({ message: "This plan has already been built" });
    }

    const run = await deps.taskStore.getRun(request.params.runId);
    if (!run || run.taskId !== task.id) {
      return reply.status(404).send({ message: "Plan run not found" });
    }

    if (run.action !== "plan" && run.action !== "iterate") {
      return reply.status(409).send({ message: "Only plan history entries can be built" });
    }

    const planMarkdown = run.summary?.trim();
    if (!planMarkdown) {
      return reply.status(409).send({ message: "Selected plan has no markdown summary to build from" });
    }

    const selectedPlanPath = resolveLocalPlanRevisionPath(task, env.LOCAL_PLANS_ROOT, `${run.action}-${run.startedAt.replace(/[:.]/g, "-")}`);
    await mkdir(path.dirname(selectedPlanPath), { recursive: true });
    await writeFile(selectedPlanPath, `${planMarkdown}\n`, "utf8");
    await deps.taskStore.updatePlanArtifacts(task.id, selectedPlanPath, planMarkdown);
    await deps.taskStore.patchTask(task.id, { currentPlanRunId: run.id });

    const accepted = await deps.scheduler.triggerAction(task.id, "build");
    if (!accepted) {
      return reply.status(409).send({ message: "Task execution could not be started" });
    }

    return reply.send(await deps.taskStore.getTask(task.id));
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/push-preview", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
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
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const parsed = pushTaskBodySchema.safeParse((request.body as unknown) ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const pushed = await deps.spawner.pushTaskBranch(task, {
      commitMessage: parsed.data.commitMessage
    });
    return reply.send(await withBranchSyncCounts(deps.spawner, pushed));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/pull", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const pulled = await deps.spawner.pullTaskBranch(task);
    return reply.send(await withBranchSyncCounts(deps.spawner, pulled));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/merge", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
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

    if (!task.repoDefaultBranch) {
      return reply.status(409).send({ message: "Repository default branch is not configured for this task" });
    }

    if (task.branchName === task.repoDefaultBranch) {
      return reply.status(409).send({ message: "Task branch cannot merge into itself" });
    }

    const merged = await deps.spawner.mergeTaskBranch(task);
    await deps.taskStore.archiveTask(merged.id);
    await deps.taskStore.appendLog(merged.id, "Task archived after merge.");
    const refreshed = await deps.taskStore.getTask(merged.id);
    return reply.send(await withBranchSyncCounts(deps.spawner, refreshed ?? merged));
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/accept", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const canAcceptImplementationFailure = (task.taskType === "plan" || task.taskType === "build") && task.status === "failed";
    if (task.status !== "review" && task.status !== "answered" && !canAcceptImplementationFailure) {
      return reply.status(409).send({ message: "Only completed task results can be accepted" });
    }

    if (task.taskType === "plan" || task.taskType === "build") {
      const accepted = await deps.spawner.publishAcceptedTask(task);
      return reply.send(accepted);
    }

    const accepted = await deps.taskStore.setStatus(task.id, "accepted", {
      errorMessage: null,
      enqueued: false
    });
    await deps.taskStore.appendLog(task.id, "Task result manually accepted by user.");
    return reply.send(accepted);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/archive", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: "Task is already archived" });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be archived" });
    }

    await deps.spawner.cleanupTaskArtifacts(task, { preservePlanFile: true });
    await deps.taskStore.archiveTask(task.id);
    await deps.taskStore.appendLog(task.id, "Task archived by user.");
    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", { preHandler: deps.auth.requireAllScopes(["task:delete"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be deleted" });
    }

    await deps.spawner.cleanupTaskArtifacts(task);
    await deps.taskStore.deleteTask(task.id);
    return reply.status(204).send();
  });

  // Backward compatibility: /run maps to build.
  app.post<{ Params: { id: string } }>("/tasks/:id/run", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const accepted = await deps.scheduler.triggerAction(task.id, getTriggerActionForNewTask(task));
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });
};
