import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import { sendHttpError } from "../lib/http-error.js";
import type { RepositoryStore } from "../services/repository-store.js";

const createRepositorySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
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
    auth: AuthService;
  }
): void => {
  app.get("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:list"]) }, async () => deps.repositoryStore.listRepositories());

  app.post("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:create"]) }, async (request, reply) => {
    const parsed = createRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const repository = await deps.repositoryStore.createRepository(parsed.data);
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
      const updated = await deps.repositoryStore.updateRepository(request.params.id, parsed.data);
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
    const deleted = await deps.repositoryStore.deleteRepository(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.status(204).send();
  });
};
