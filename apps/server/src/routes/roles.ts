import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PermissionScope } from "@agentswarm/shared-types";
import type { AuthService } from "../lib/auth.js";
import { sendHttpError } from "../lib/http-error.js";
import type { RoleStore } from "../services/role-store.js";
import type { SessionStore } from "../services/session-store.js";
import type { UserStore } from "../services/user-store.js";

const permissionScopeSchema = z.custom<PermissionScope>((value) => typeof value === "string" && value.trim().length > 0, {
  message: "Invalid permission scope"
});

const createRoleSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  scopes: z.array(permissionScopeSchema).min(1),
  allowedProviders: z.array(z.enum(["codex", "claude"])).optional(),
  allowedModels: z.array(z.string().trim().min(1)).optional(),
  allowedEfforts: z.array(z.enum(["low", "medium", "high", "max"])).optional()
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  scopes: z.array(permissionScopeSchema).min(1).optional(),
  allowedProviders: z.array(z.enum(["codex", "claude"])).optional(),
  allowedModels: z.array(z.string().trim().min(1)).optional(),
  allowedEfforts: z.array(z.enum(["low", "medium", "high", "max"])).optional()
});

export const registerRoleRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    roleStore: RoleStore;
    userStore: UserStore;
    sessionStore: SessionStore;
  }
): void => {
  app.get("/roles", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async () => deps.roleStore.listRoles());

  app.get<{ Params: { id: string } }>(
    "/roles/:id",
    { preHandler: deps.auth.requireAllScopes(["settings:read"]) },
    async (request, reply) => {
      const role = await deps.roleStore.getRole(request.params.id);
      if (!role) {
        return reply.status(404).send({ message: "Role not found" });
      }

      return role;
    }
  );

  app.post(
    "/roles",
    { preHandler: deps.auth.requireAllScopes(["settings:edit"]) },
    async (request, reply) => {
      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      try {
        const role = await deps.roleStore.createRole(parsed.data);
        return reply.status(201).send(role);
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
    "/roles/:id",
    { preHandler: deps.auth.requireAllScopes(["settings:edit"]) },
    async (request, reply) => {
      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }

      const current = await deps.roleStore.getRole(request.params.id);
      if (!current) {
        return reply.status(404).send({ message: "Role not found" });
      }

      if (current.isSystem) {
        return reply.status(403).send({ message: "System roles are immutable" });
      }

      try {
        const role = await deps.roleStore.updateRole(request.params.id, parsed.data);
        if (!role) {
          return reply.status(404).send({ message: "Role not found" });
        }

        const affectedUserIds = await deps.userStore.listUserIdsByRoleId(role.id);
        await Promise.all(affectedUserIds.map((userId) => deps.sessionStore.deleteSessionsForUser(userId)));

        return reply.send(role);
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
    "/roles/:id",
    { preHandler: deps.auth.requireAllScopes(["settings:edit"]) },
    async (request, reply) => {
      const current = await deps.roleStore.getRole(request.params.id);
      if (!current) {
        return reply.status(404).send({ message: "Role not found" });
      }

      if (current.isSystem) {
        return reply.status(403).send({ message: "System roles cannot be deleted" });
      }

      if (await deps.userStore.hasUsersWithRole(request.params.id)) {
        return reply.status(409).send({ message: "Role is still assigned to one or more users" });
      }

      try {
        await deps.roleStore.deleteRole(request.params.id);
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
