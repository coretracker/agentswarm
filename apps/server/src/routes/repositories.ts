import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../lib/auth.js";
import { canUserAccessRepository } from "../lib/repository-access.js";
import { sendHttpError } from "../lib/http-error.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { UserStore } from "../services/user-store.js";
import { isAdminUser } from "../lib/task-ownership.js";

const createRepositorySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  userIds: z.array(z.string().trim().min(1)).optional(),
  webhookUrl: z.string().trim().url().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookSecret: z.string().trim().min(1).optional()
});

const updateRepositorySchema = createRepositorySchema.partial().extend({
  clearWebhookSecret: z.boolean().optional()
});

export const registerRepositoryRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    userStore: UserStore;
    auth: AuthService;
  }
): void => {
  const getAccessibleRepository = async (
    request: FastifyRequest,
    reply: FastifyReply,
    repositoryId: string
  ) => {
    const repository = await deps.repositoryStore.getRepository(repositoryId);
    if (!repository || !canUserAccessRepository(request.auth?.user, repository)) {
      await reply.status(404).send({ message: "Repository not found" });
      return null;
    }

    return repository;
  };

  app.get(
    "/repositories",
    { preHandler: deps.auth.requireAllScopes(["repo:list"]) },
    async (request) => deps.repositoryStore.listRepositoriesForUser(request.auth?.user)
  );

  app.post("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:create"]) }, async (request, reply) => {
    const parsed = createRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      if (parsed.data.userIds !== undefined && !request.auth!.scopes.has("user:list")) {
        return reply.status(403).send({ message: "Managing repository access requires user:list" });
      }

      const normalizedUserIds = await deps.userStore.normalizeUserIds(parsed.data.userIds);
      const creatorId = request.auth!.user.id;
      const userIds =
        isAdminUser(request.auth?.user) || normalizedUserIds.includes(creatorId)
          ? normalizedUserIds
          : [...normalizedUserIds, creatorId];
      const repository = await deps.repositoryStore.createRepository({ ...parsed.data, userIds });
      return reply.status(201).send(repository);
    } catch (error) {
      const sent = sendHttpError(reply, error);
      if (sent) {
        return sent;
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/repositories/:id", { preHandler: deps.auth.requireAllScopes(["repo:edit"]) }, async (request, reply) => {
    const parsed = updateRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const current = await getAccessibleRepository(request, reply, request.params.id);
      if (!current) {
        return;
      }

      if (parsed.data.userIds !== undefined && !request.auth!.scopes.has("user:list")) {
        return reply.status(403).send({ message: "Managing repository access requires user:list" });
      }

      const userIds = parsed.data.userIds === undefined ? undefined : await deps.userStore.normalizeUserIds(parsed.data.userIds);
      const updated = await deps.repositoryStore.updateRepository(current.id, { ...parsed.data, userIds });
      if (!updated) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      return reply.send(updated);
    } catch (error) {
      const sent = sendHttpError(reply, error);
      if (sent) {
        return sent;
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/repositories/:id", { preHandler: deps.auth.requireAllScopes(["repo:delete"]) }, async (request, reply) => {
    const current = await getAccessibleRepository(request, reply, request.params.id);
    if (!current) {
      return;
    }

    const deleted = await deps.repositoryStore.deleteRepository(current.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.status(204).send();
  });
};
