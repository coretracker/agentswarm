import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RepositoryStore } from "../services/repository-store.js";

const createRepositorySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  plansDir: z.string().min(1).optional(),
  rules: z.string().max(12000).optional()
});

const updateRepositorySchema = createRepositorySchema.partial();

export const registerRepositoryRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
  }
): void => {
  app.get("/repositories", async () => deps.repositoryStore.listRepositories());

  app.post("/repositories", async (request, reply) => {
    const parsed = createRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const repository = await deps.repositoryStore.createRepository(parsed.data);
    return reply.status(201).send(repository);
  });

  app.patch<{ Params: { id: string } }>("/repositories/:id", async (request, reply) => {
    const parsed = updateRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const updated = await deps.repositoryStore.updateRepository(request.params.id, parsed.data);
    if (!updated) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>("/repositories/:id", async (request, reply) => {
    const deleted = await deps.repositoryStore.deleteRepository(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.status(204).send();
  });
};
