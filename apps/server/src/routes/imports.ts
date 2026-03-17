import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { TaskStore } from "../services/task-store.js";
import { GitHubImportError, type GitHubImportService } from "../services/github-import-service.js";

const issueImportSchema = z.object({
  repoId: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
  includeComments: z.boolean().optional(),
  taskType: z.enum(["plan", "build", "ask"]).optional(),
  title: z.string().trim().optional(),
  provider: z.enum(["codex", "claude"]).optional(),
  providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
  modelOverride: z.string().trim().min(1).optional(),
  baseBranch: z.string().trim().min(1).optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional()
});

const pullRequestImportSchema = z.object({
  repoId: z.string().min(1),
  pullRequestNumber: z.coerce.number().int().positive(),
  title: z.string().trim().optional(),
  provider: z.enum(["codex", "claude"]).optional(),
  providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
  modelOverride: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional()
});

export const registerImportRoutes = (
  app: FastifyInstance,
  deps: {
    githubImportService: GitHubImportService;
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    auth: AuthService;
  }
): void => {
  app.get<{ Querystring: { repoId: string } }>("/imports/github/issues", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repoId = String(request.query.repoId ?? "").trim();
    if (!repoId) {
      return reply.status(400).send({ message: "repoId is required" });
    }

    try {
      const repository = await deps.repositoryStore.getRepository(repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const issues = await deps.githubImportService.listOpenIssues(repository);
      return reply.send(issues);
    } catch (error) {
      if (error instanceof GitHubImportError) {
        return reply.status(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });

  app.get<{ Querystring: { repoId: string } }>("/imports/github/pull-requests", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repoId = String(request.query.repoId ?? "").trim();
    if (!repoId) {
      return reply.status(400).send({ message: "repoId is required" });
    }

    try {
      const repository = await deps.repositoryStore.getRepository(repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const pullRequests = await deps.githubImportService.listOpenPullRequests(repository);
      return reply.send(pullRequests);
    } catch (error) {
      if (error instanceof GitHubImportError) {
        return reply.status(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });

  app.get<{ Querystring: { repoId: string } }>("/imports/github/branches", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repoId = String(request.query.repoId ?? "").trim();
    if (!repoId) {
      return reply.status(400).send({ message: "repoId is required" });
    }

    try {
      const repository = await deps.repositoryStore.getRepository(repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const branches = await deps.githubImportService.listBranches(repository);
      return reply.send(branches);
    } catch (error) {
      if (error instanceof GitHubImportError) {
        return reply.status(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });

  app.post("/imports/issue", { preHandler: deps.auth.requireAllScopes(["task:create", "repo:read"]) }, async (request, reply) => {
    const parsed = issueImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const taskInput = await deps.githubImportService.buildTaskInputFromIssue(repository, parsed.data);
      const task = await deps.taskStore.createTask(taskInput, repository);
      const initialAction = task.lastAction ?? "plan";
      const accepted = await deps.scheduler.triggerAction(task.id, initialAction);
      if (!accepted) {
        return reply.status(409).send({ message: "Imported task execution could not be started" });
      }

      const refreshed = await deps.taskStore.getTask(task.id);
      return reply.status(201).send(refreshed);
    } catch (error) {
      if (error instanceof GitHubImportError) {
        return reply.status(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });

  app.post("/imports/pull-request", { preHandler: deps.auth.requireAllScopes(["task:create", "repo:read"]) }, async (request, reply) => {
    const parsed = pullRequestImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const repository = await deps.repositoryStore.getRepository(parsed.data.repoId);
      if (!repository) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      const taskInput = await deps.githubImportService.buildTaskInputFromPullRequest(repository, parsed.data);
      const task = await deps.taskStore.createTask(taskInput, repository);
      const initialAction = task.lastAction ?? "plan";
      const accepted = await deps.scheduler.triggerAction(task.id, initialAction);
      if (!accepted) {
        return reply.status(409).send({ message: "Imported task execution could not be started" });
      }

      const refreshed = await deps.taskStore.getTask(task.id);
      return reply.status(201).send(refreshed);
    } catch (error) {
      if (error instanceof GitHubImportError) {
        return reply.status(error.statusCode).send({ message: error.message });
      }

      throw error;
    }
  });
};
