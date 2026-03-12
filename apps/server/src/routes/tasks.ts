import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { isActiveTaskStatus, type Task, type TaskAction, type TaskType } from "@agentswarm/shared-types";
import type { SchedulerService } from "../services/scheduler.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { TaskStore } from "../services/task-store.js";

const createTaskSchema = z.object({
  title: z.string().min(1),
  repoId: z.string().min(1),
  requirements: z.string().min(1),
  taskType: z.enum(["plan", "review", "ask"]).optional(),
  provider: z.enum(["codex", "claude"]).optional(),
  providerProfile: z.enum(["quick", "balanced", "deep", "super_deep", "unlimited"]).optional(),
  modelOverride: z.string().trim().min(1).optional(),
  baseBranch: z.string().min(1).optional(),
  skipPlan: z.boolean().optional(),
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

const getInitialAction = (task: Pick<Task, "taskType" | "planningMode" | "planMarkdown">): TaskAction => {
  if (task.taskType === "review") {
    return "review";
  }

  if (task.taskType === "ask") {
    return "ask";
  }

  return task.planMarkdown || task.planningMode === "direct-build" ? "build" : "plan";
};

const allowedActionsByTaskType: Record<TaskType, TaskAction[]> = {
  plan: ["plan", "build", "iterate"],
  review: ["review"],
  ask: ["ask"]
};

export const registerTaskRoutes = (
  app: FastifyInstance,
  deps: {
    taskStore: TaskStore;
    repositoryStore: RepositoryStore;
    scheduler: SchedulerService;
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

  app.post<{ Params: { id: string } }>("/tasks/:id/accept", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (task.status !== "review" && task.status !== "answered") {
      return reply.status(409).send({ message: "Only completed task results can be accepted" });
    }

    const accepted = await deps.taskStore.setStatus(task.id, "accepted", {
      errorMessage: null,
      enqueued: false
    });
    await deps.taskStore.appendLog(task.id, "Task result manually accepted by user.");
    return reply.send(accepted);
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    if (isActiveTaskStatus(task.status)) {
      return reply.status(409).send({ message: "Active tasks cannot be deleted" });
    }

    await deps.taskStore.deleteTask(task.id);
    return reply.status(204).send();
  });

  // Backward compatibility: /run maps to build.
  app.post<{ Params: { id: string } }>("/tasks/:id/run", async (request, reply) => {
    const task = await deps.taskStore.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ message: "Task not found" });
    }

    const accepted = await deps.scheduler.triggerAction(task.id, getInitialAction(task));
    if (!accepted) {
      return reply.status(409).send({ message: "Task is already running" });
    }

    const refreshed = await deps.taskStore.getTask(task.id);
    return reply.send(refreshed);
  });
};
