import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import { sendHttpError } from "../lib/http-error.js";
import type { RoleStore } from "../services/role-store.js";
import type { SessionStore } from "../services/session-store.js";
import type { UserStore } from "../services/user-store.js";

const responsePreferenceSchema = z
  .object({
    audience: z.enum(["technical", "non_technical", "mixed"]).optional(),
    explanationDepth: z.enum(["brief", "standard", "detailed"]).optional(),
    jargonLevel: z.enum(["avoid", "balanced", "expert"]).optional(),
    codePreference: z.enum(["only_when_needed", "prefer_examples", "avoid_code"]).optional(),
    clarifyBehavior: z.enum(["ask_when_ambiguous", "make_reasonable_assumptions"]).optional(),
    formattingStyle: z.enum(["direct", "teaching", "executive"]).optional(),
    extraInstructions: z.string().trim().max(2000).optional()
  });

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(1),
  active: z.boolean().optional(),
  roleIds: z.array(z.string().trim().min(1)).optional(),
  repositoryIds: z.array(z.string().trim().min(1)).optional(),
  agentResponsePreference: responsePreferenceSchema.optional()
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(1).optional(),
  active: z.boolean().optional(),
  roleIds: z.array(z.string().trim().min(1)).optional(),
  repositoryIds: z.array(z.string().trim().min(1)).optional(),
  agentResponsePreference: responsePreferenceSchema.optional()
});

export const registerUserRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    userStore: UserStore;
    roleStore: RoleStore;
    sessionStore: SessionStore;
  }
): void => {
  app.get("/users", { preHandler: deps.auth.requireAllScopes(["user:list"]) }, async () => deps.userStore.listUsers());

  app.get<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: deps.auth.requireAllScopes(["user:read"]) },
    async (request, reply) => {
      const user = await deps.userStore.getUser(request.params.id);
      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }

      return user;
    }
  );

  app.post(
    "/users",
    { preHandler: deps.auth.requireAllScopes(["user:create"]) },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      if (
        (parsed.data.roleIds !== undefined || parsed.data.repositoryIds !== undefined) &&
        !request.auth!.scopes.has("settings:edit")
      ) {
        return reply.status(403).send({ message: "Role or repository assignment requires settings:edit" });
      }

      try {
        const user = await deps.userStore.createUser(parsed.data);
        return reply.status(201).send(user);
      } catch (error) {
        const sent = sendHttpError(reply, error);
        if (sent) {
          return sent;
        }

        throw error;
      }
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: deps.auth.requireAllScopes(["user:edit"]) },
    async (request, reply) => {
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      if (
        (parsed.data.roleIds !== undefined || parsed.data.repositoryIds !== undefined) &&
        !request.auth!.scopes.has("settings:edit")
      ) {
        return reply.status(403).send({ message: "Role or repository assignment requires settings:edit" });
      }

      if (parsed.data.active === false && request.params.id === request.auth!.user.id) {
        return reply.status(409).send({ message: "You cannot disable your own account" });
      }

      try {
        const user = await deps.userStore.updateUser(request.params.id, parsed.data);
        if (!user) {
          return reply.status(404).send({ message: "User not found" });
        }

        if (
          parsed.data.active === false ||
          parsed.data.roleIds !== undefined ||
          parsed.data.repositoryIds !== undefined ||
          parsed.data.agentResponsePreference !== undefined
        ) {
          await deps.sessionStore.deleteSessionsForUser(user.id);
        }

        return reply.send(user);
      } catch (error) {
        const sent = sendHttpError(reply, error);
        if (sent) {
          return sent;
        }

        throw error;
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: deps.auth.requireAllScopes(["user:delete"]) },
    async (request, reply) => {
      if (request.params.id === request.auth!.user.id) {
        return reply.status(409).send({ message: "You cannot delete your own account" });
      }

      try {
        const deleted = await deps.userStore.deleteUser(request.params.id);
        if (!deleted) {
          return reply.status(404).send({ message: "User not found" });
        }

        await deps.sessionStore.deleteSessionsForUser(request.params.id);
        return reply.status(204).send();
      } catch (error) {
        const sent = sendHttpError(reply, error);
        if (sent) {
          return sent;
        }

        throw error;
      }
    }
  );
};
