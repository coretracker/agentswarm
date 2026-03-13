import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { isActiveTaskStatus, type Task, type TaskAction, type TaskType } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { resolveLocalPlanRevisionPath } from "../lib/plan-path.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";

const createTaskSchema = z.object({
  title: z.string().min(1),
  repoId: z.string().min(1),
  requirements: z.string().min(1),
  taskType: z.enum(["plan", "build", "review", "ask"]).optional(),
  provider: z.enum(["codex", "claude"]).optional(),
  providerProfile: z.enum(["quick", "balanced", "deep", "super_deep", "unlimited"]).optional(),
  modelOverride: z.string().trim().min(1).optional(),
  baseBranch: z.string().min(1).optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional(),
  queueMode: z.enum(["manual", "auto"]).optional(),
  mode: z.enum(["manual", "auto"]).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional()
});

const triggerTaskActionSchema = z.object({
  action: z.enum(["plan", "build", "iterate", "review", "ask"]),
  iterateInput: z.string().optional()
});

const updateTaskConfigSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  providerProfile: z.enum(["quick", "balanced", "deep", "super_deep", "unlimited"]),
  modelOverride: z.string().trim().nullable().optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional()
});

const updateTaskPinSchema = z.object({
  pinned: z.boolean()
});

const updateTaskPlanSchema = z.object({
  planMarkdown: z.string().trim().min(1)
});

const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1),
  action: z.enum(["plan", "build", "review", "ask", "comment"]).optional()
});

const archivedTaskReadOnlyMessage = "Archived tasks are read-only";

const getInitialAction = (task: Pick<Task, "taskType" | "planningMode" | "planMarkdown">): TaskAction => {
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  if (task.taskType === "build") {
    return "build";
  }

  return task.planMarkdown || task.planningMode === "direct-build" ? "build" : "plan";
};

const allowedActionsByTaskType: Record<TaskType, TaskAction[]> = {
  plan: ["plan", "build", "iterate", "review", "ask"],
  build: ["plan", "build", "review", "ask"],
  review: ["review", "ask"],
  ask: ["ask", "review"]
};

const getChatActionForTask = (task: Task): TaskAction => {
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  if (task.taskType === "build") {
    return "build";
  }

  if (task.branchDiff?.trim() || task.status === "review" || task.lastAction === "build") {
    return "build";
  }

  return "plan";
};

export const registerTaskRoutes = (
  app: FastifyInstance,
  deps: {
    taskStore: TaskStore;
    repositoryStore: RepositoryStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
  }
): void => {
  app.get("/tasks", async () => deps.taskStore.listTasks());

  app.get<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return task;
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/messages", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return deps.taskStore.listMessages(task.id);
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/runs", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return deps.taskStore.listRuns(task.id);
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/live-diff", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    return deps.spawner.getLiveTaskDiff(task);
  });

  app.post("/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const task = await deps.taskStore.createTask(parsed.data, repository);
    const initialAction = getInitialAction(task);
    const accepted = await deps.scheduler.triggerAction(task.id, initialAction);
    if (!accepted) {
      return reply.status(409).send({ message: "Task execution could not be started" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.status(201).send(refreshed);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/actions", async (request, reply) => {
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

    if (!allowedActionsByTaskType[task.taskType].includes(parsed.data.action)) {
      return reply.status(409).send({ message: `Action ${parsed.data.action} is not supported for ${task.taskType} tasks` });
    }

    if (parsed.data.action === "iterate" && !(parsed.data.iterateInput ?? "").trim()) {
      return reply.status(400).send({ message: "iterateInput is required for iterate action" });
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

  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (request, reply) => {
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

  app.patch<{ Params: { id: string } }>("/tasks/:id/config", async (request, reply) => {
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

  app.patch<{ Params: { id: string } }>("/tasks/:id/pin", async (request, reply) => {
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

  app.patch<{ Params: { id: string } }>("/tasks/:id/plan", async (request, reply) => {
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

  app.post<{ Params: { id: string } }>("/tasks/:id/messages", async (request, reply) => {
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

    if (action !== "comment" && isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    if (action !== "comment" && !allowedActionsByTaskType[task.taskType].includes(action)) {
      return reply.status(409).send({ message: `Action ${action} is not supported for ${task.taskType} tasks` });
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

  app.post<{ Params: { id: string; runId: string } }>("/tasks/:id/build-from-run/:runId", async (request, reply) => {
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

  app.post<{ Params: { id: string } }>("/tasks/:id/accept", async (request, reply) => {
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

  app.post<{ Params: { id: string } }>("/tasks/:id/archive", async (request, reply) => {
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

    await deps.taskStore.archiveTask(task.id);
    await deps.taskStore.appendLog(task.id, "Task archived by user.");
    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
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
  app.post<{ Params: { id: string } }>("/tasks/:id/run", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status === "archived") {
      return reply.status(409).send({ message: archivedTaskReadOnlyMessage });
    }

    const accepted = await deps.scheduler.triggerAction(task.id, getInitialAction(task));
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });
};
