import type { TaskStartMode } from "@agentswarm/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { GitHubImportService } from "../services/github-import-service.js";
import { GitHubImportError } from "../services/github-import-service.js";
import type { PresetStore } from "../services/preset-store.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { applyTaskStartMode } from "../lib/task-start-mode.js";
import { requireTaskCapabilityAccess, requireTaskExecutionConfigAccess } from "../lib/task-capability-access.js";
import { withBranchSyncCounts } from "./tasks.js";

const presetSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("blank"),
    title: z.string().trim().min(1),
    repoId: z.string().min(1),
    prompt: z.string().trim().min(1),
    taskType: z.enum(["build", "ask"]),
    provider: z.enum(["codex", "claude"]),
    model: z.string().trim().min(1),
    providerProfile: z.enum(["low", "medium", "high", "max"]),
    baseBranch: z.string().trim().min(1),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"]),
    startMode: z.enum(["run_now", "prepare_workspace", "idle"]).optional()
  }),
  z.object({
    sourceType: z.literal("issue"),
    title: z.string().trim().optional(),
    repoId: z.string().min(1),
    issueNumber: z.coerce.number().int().positive(),
    includeComments: z.boolean(),
    taskType: z.enum(["build", "ask"]),
    provider: z.enum(["codex", "claude"]),
    model: z.string().trim().min(1),
    providerProfile: z.enum(["low", "medium", "high", "max"]),
    baseBranch: z.string().trim().min(1),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"]),
    startMode: z.enum(["run_now", "prepare_workspace", "idle"]).optional()
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

const spawnPresetInputSchema = z.object({
  baseBranch: z.string().trim().min(1).optional()
});

export const registerPresetRoutes = (
  app: FastifyInstance,
  deps: {
    presetStore: PresetStore;
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
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

    if (
      !requireTaskCapabilityAccess(request, reply, {
        taskType: parsed.data.sourceType === "pull_request" ? "build" : parsed.data.taskType,
        startMode: parsed.data.sourceType === "pull_request" ? "run_now" : parsed.data.startMode
      })
    ) {
      return;
    }
    if (
      !requireTaskExecutionConfigAccess(request, reply, {
        provider: parsed.data.provider,
        providerProfile: parsed.data.providerProfile,
        model: parsed.data.model
      })
    ) {
      return;
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

    if (
      !requireTaskCapabilityAccess(request, reply, {
        taskType: parsed.data.sourceType === "pull_request" ? "build" : parsed.data.taskType,
        startMode: parsed.data.sourceType === "pull_request" ? "run_now" : parsed.data.startMode
      })
    ) {
      return;
    }
    if (
      !requireTaskExecutionConfigAccess(request, reply, {
        provider: parsed.data.provider,
        providerProfile: parsed.data.providerProfile,
        model: parsed.data.model
      })
    ) {
      return;
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
      const parsedSpawnInput = spawnPresetInputSchema.safeParse(request.body ?? {});
      if (!parsedSpawnInput.success) {
        return reply.status(400).send({ message: parsedSpawnInput.error.message });
      }

      const preset = await deps.presetStore.getPreset(request.params.id);
      if (!preset) {
        return reply.status(404).send({ message: "Preset not found" });
      }

      const repository = await deps.repositoryStore.getRepository(preset.definition.repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const overrideBaseBranch = parsedSpawnInput.data.baseBranch;
      const capabilityInput =
        preset.definition.sourceType === "pull_request"
          ? { taskType: "build" as const, startMode: "run_now" as const }
          : { taskType: preset.definition.taskType, startMode: preset.definition.startMode };
      if (!requireTaskCapabilityAccess(request, reply, capabilityInput)) {
        return;
      }
      if (
        !requireTaskExecutionConfigAccess(request, reply, {
          provider: preset.definition.provider,
          providerProfile: preset.definition.providerProfile,
          model: preset.definition.model
        })
      ) {
        return;
      }

      try {
        let task;
        let startMode: TaskStartMode = "run_now";

        if (preset.definition.sourceType === "issue") {
          const rawInput = await deps.githubImportService.buildTaskInputFromIssue(repository, {
            repoId: preset.definition.repoId,
            issueNumber: preset.definition.issueNumber,
            includeComments: preset.definition.includeComments,
            taskType: preset.definition.taskType,
            title: preset.definition.title,
            provider: preset.definition.provider,
            providerProfile: preset.definition.providerProfile,
            model: preset.definition.model,
            baseBranch: overrideBaseBranch ?? preset.definition.baseBranch,
            branchStrategy: preset.definition.branchStrategy,
            startMode: preset.definition.startMode
          });
          const { startMode: sm, ...createFields } = rawInput;
          startMode = sm ?? "run_now";
          task = await deps.taskStore.createTask({ ...createFields, startMode }, repository, request.auth!.user.id);
        } else if (preset.definition.sourceType === "pull_request") {
          task = await deps.taskStore.createTask(
            await deps.githubImportService.buildTaskInputFromPullRequest(repository, {
              repoId: preset.definition.repoId,
              pullRequestNumber: preset.definition.pullRequestNumber,
              title: preset.definition.title,
              provider: preset.definition.provider,
              providerProfile: preset.definition.providerProfile,
              model: preset.definition.model
            }),
            repository,
            request.auth!.user.id
          );
          startMode = "run_now";
        } else {
          startMode = preset.definition.startMode ?? "run_now";
          task = await deps.taskStore.createTask(
            {
              title: preset.definition.title,
              repoId: preset.definition.repoId,
              prompt: preset.definition.prompt,
              taskType: preset.definition.taskType,
              provider: preset.definition.provider,
              providerProfile: preset.definition.providerProfile,
              model: preset.definition.model,
              baseBranch: overrideBaseBranch ?? preset.definition.baseBranch,
              branchStrategy: preset.definition.branchStrategy,
              startMode: preset.definition.startMode ?? "run_now"
            },
            repository,
            request.auth!.user.id
          );
        }

        try {
          const result = await applyTaskStartMode(task, startMode, {
            taskStore: deps.taskStore,
            scheduler: deps.scheduler,
            spawner: deps.spawner
          });
          return reply.status(201).send(await withBranchSyncCounts(deps.spawner, result));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Preset spawn follow-up failed";
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
      } catch (error) {
        if (error instanceof GitHubImportError) {
          return reply.status(error.statusCode).send({ message: error.message });
        }

        throw error;
      }
    }
  );
};
