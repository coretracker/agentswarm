import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { GitHubImportService } from "../services/github-import-service.js";
import { GitHubImportError } from "../services/github-import-service.js";
import type { PresetStore } from "../services/preset-store.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { TaskStore } from "../services/task-store.js";

const presetSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("blank"),
    title: z.string().trim().min(1),
    repoId: z.string().min(1),
    requirements: z.string().trim().min(1),
    taskType: z.enum(["plan", "build", "review", "ask"]),
    provider: z.enum(["codex", "claude"]),
    model: z.string().trim().min(1),
    providerProfile: z.enum(["low", "medium", "high", "max"]),
    baseBranch: z.string().trim().min(1),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"])
  }),
  z.object({
    sourceType: z.literal("issue"),
    title: z.string().trim().optional(),
    repoId: z.string().min(1),
    issueNumber: z.coerce.number().int().positive(),
    includeComments: z.boolean(),
    taskType: z.enum(["plan", "build", "ask"]),
    provider: z.enum(["codex", "claude"]),
    model: z.string().trim().min(1),
    providerProfile: z.enum(["low", "medium", "high", "max"]),
    baseBranch: z.string().trim().min(1),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"])
  }),
  z.object({
    sourceType: z.literal("pull_request"),
    title: z.string().trim().optional(),
    repoId: z.string().min(1),
    pullRequestNumber: z.coerce.number().int().positive(),
    provider: z.enum(["codex", "claude"]),
    model: z.string().trim().min(1),
    providerProfile: z.enum(["low", "medium", "high", "max"])
  })
]);

export const registerPresetRoutes = (
  app: FastifyInstance,
  deps: {
    presetStore: PresetStore;
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    githubImportService: GitHubImportService;
    auth: AuthService;
  }
): void => {
  app.get("/presets", { preHandler: deps.auth.requireAllScopes(["preset:list"]) }, async () => deps.presetStore.listPresets());

  app.get<{ Params: { id: string } }>("/presets/:id", { preHandler: deps.auth.requireAllScopes(["preset:read"]) }, async (request, reply) => {
    const preset = await deps.presetStore.getPreset(request.params.id);
    if (!preset) {
      return reply.status(404).send({ message: "Preset not found" });
    }

    return reply.send(preset);
  });

  app.post("/presets", { preHandler: deps.auth.requireAllScopes(["preset:create"]) }, async (request, reply) => {
    const parsed = presetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const preset = await deps.presetStore.createPreset(parsed.data, repository);
    return reply.status(201).send(preset);
  });

  app.patch<{ Params: { id: string } }>("/presets/:id", { preHandler: deps.auth.requireAllScopes(["preset:edit"]) }, async (request, reply) => {
    const parsed = presetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const preset = await deps.presetStore.updatePreset(request.params.id, parsed.data, repository);
    if (!preset) {
      return reply.status(404).send({ message: "Preset not found" });
    }

    return reply.send(preset);
  });

  app.delete<{ Params: { id: string } }>("/presets/:id", { preHandler: deps.auth.requireAllScopes(["preset:delete"]) }, async (request, reply) => {
    const deleted = await deps.presetStore.deletePreset(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Preset not found" });
    }

    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/presets/:id/spawn",
    { preHandler: deps.auth.requireAllScopes(["preset:read", "task:create"]) },
    async (request, reply) => {
      const preset = await deps.presetStore.getPreset(request.params.id);
      if (!preset) {
        return reply.status(404).send({ message: "Preset not found" });
      }

      const repository = await deps.repositoryStore.getRepository(preset.definition.repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      try {
        const task =
          preset.definition.sourceType === "issue"
            ? await deps.taskStore.createTask(
                await deps.githubImportService.buildTaskInputFromIssue(repository, {
                  repoId: preset.definition.repoId,
                  issueNumber: preset.definition.issueNumber,
                  includeComments: preset.definition.includeComments,
                  taskType: preset.definition.taskType,
                  title: preset.definition.title,
                  provider: preset.definition.provider,
                  providerProfile: preset.definition.providerProfile,
                  model: preset.definition.model,
                  baseBranch: preset.definition.baseBranch,
                  branchStrategy: preset.definition.branchStrategy
                }),
                repository
              )
            : preset.definition.sourceType === "pull_request"
              ? await deps.taskStore.createTask(
                  await deps.githubImportService.buildTaskInputFromPullRequest(repository, {
                    repoId: preset.definition.repoId,
                    pullRequestNumber: preset.definition.pullRequestNumber,
                    title: preset.definition.title,
                    provider: preset.definition.provider,
                    providerProfile: preset.definition.providerProfile,
                    model: preset.definition.model
                  }),
                  repository
                )
              : await deps.taskStore.createTask(
                  {
                    title: preset.definition.title,
                    repoId: preset.definition.repoId,
                    requirements: preset.definition.requirements,
                    taskType: preset.definition.taskType,
                    provider: preset.definition.provider,
                    providerProfile: preset.definition.providerProfile,
                    model: preset.definition.model,
                    baseBranch: preset.definition.baseBranch,
                    branchStrategy: preset.definition.branchStrategy
                  },
                  repository
                );

        const accepted = await deps.scheduler.triggerAction(task.id, task.lastAction ?? "plan");
        if (!accepted) {
          return reply.status(409).send({ message: "Task execution could not be started" });
        }

        const refreshed = await deps.taskStore.getTask(task.id);
        return reply.status(201).send(refreshed);
      } catch (error) {
        if (error instanceof GitHubImportError) {
          return reply.status(error.statusCode).send({ message: error.message });
        }

        throw error;
      }
    }
  );
};
