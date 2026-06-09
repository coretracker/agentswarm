import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { RepositoryStore } from "../services/repository-store.js";
import { GitHubImportError, type GitHubImportService } from "../services/github-import-service.js";
import { canUserAccessRepository } from "../lib/task-ownership.js";

export const registerImportRoutes = (
  app: FastifyInstance,
  deps: {
    githubImportService: GitHubImportService;
    repositoryStore: RepositoryStore;
    auth: AuthService;
  }
): void => {
  const getAccessibleRepository = async (
    repoId: string,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const repository = await deps.repositoryStore.getRepository(repoId);
    if (!repository || !canUserAccessRepository(request.auth?.user, repoId)) {
      await reply.status(404).send({ message: "Repository not found" });
      return null;
    }

    return repository;
  };

  app.get<{ Querystring: { repoId: string } }>("/imports/github/pull-requests", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repoId = String(request.query.repoId ?? "").trim();
    if (!repoId) {
      return reply.status(400).send({ message: "repoId is required" });
    }

    try {
      const repository = await getAccessibleRepository(repoId, request, reply);
      if (!repository) {
        return;
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
      const repository = await getAccessibleRepository(repoId, request, reply);
      if (!repository) {
        return;
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
};
