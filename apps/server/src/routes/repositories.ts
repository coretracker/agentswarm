import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import { sendHttpError } from "../lib/http-error.js";
import { canUserAccessRepository, isAdminUser } from "../lib/task-ownership.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { UserStore } from "../services/user-store.js";

const REPOSITORY_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_ENV_VAR_MAX_COUNT = 250;
const REPOSITORY_ENV_VAR_KEY_MAX_LENGTH = 128;
const REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH = 8192;

const repositoryEnvVarsSchema = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .min(1)
        .max(REPOSITORY_ENV_VAR_KEY_MAX_LENGTH)
        .regex(REPOSITORY_ENV_VAR_KEY_PATTERN, "Variable names must match /^[A-Za-z_][A-Za-z0-9_]*$/."),
      value: z.string().max(REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH)
    })
  )
  .max(REPOSITORY_ENV_VAR_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const key = entries[index]?.key;
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate variable name: ${key}`
        });
      } else {
        seen.add(key);
      }
    }
  });

const createRepositorySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  envVars: repositoryEnvVarsSchema.optional(),
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
    userStore: UserStore;
  }
): void => {
  app.get("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:list"]) }, async (request) => {
    const repositories = await deps.repositoryStore.listRepositories();
    return repositories.filter((repository) => canUserAccessRepository(request.auth?.user, repository.id));
  });

  app.post("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:create"]) }, async (request, reply) => {
    const parsed = createRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const repository = await deps.repositoryStore.createRepository(parsed.data);
      const authUser = request.auth?.user;
      if (authUser && !isAdminUser(authUser)) {
        const creator = await deps.userStore.getUser(authUser.id);
        if (creator) {
          const resolvedRepositoryIds = await Promise.all(
            creator.repositoryIds.map(async (repositoryId) =>
              (await deps.repositoryStore.getRepository(repositoryId)) ? repositoryId : null
            )
          );
          const nextRepositoryIds = resolvedRepositoryIds.filter((repositoryId): repositoryId is string => Boolean(repositoryId));
          if (!nextRepositoryIds.includes(repository.id)) {
            nextRepositoryIds.push(repository.id);
          }
          await deps.userStore.updateUser(creator.id, {
            repositoryIds: nextRepositoryIds
          });
        }
      }
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
      const current = await deps.repositoryStore.getRepository(request.params.id);
      if (!current || !canUserAccessRepository(request.auth?.user, request.params.id)) {
        return reply.status(404).send({ message: "Repository not found" });
      }

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
    const current = await deps.repositoryStore.getRepository(request.params.id);
    if (!current || !canUserAccessRepository(request.auth?.user, request.params.id)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const deleted = await deps.repositoryStore.deleteRepository(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.status(204).send();
  });
};
