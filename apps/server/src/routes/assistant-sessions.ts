import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { AssistantSessionStore } from "../services/assistant-session-store.js";
import type { SlackIdentityStore } from "../services/slack-identity-store.js";
import type { AssistantPolicyStore } from "../services/assistant-policy-store.js";
import type { AssistantRuntimeService } from "../services/assistant-runtime-service.js";
import { z } from "zod";
import { sendHttpError } from "../lib/http-error.js";
import { ALL_PERMISSION_SCOPES, type PermissionScope } from "@verft/shared-types";

const slackIdentitySchema = z.object({
  slackTeamId: z.string().trim().nullable(),
  slackUserId: z.string().trim().nullable()
});
const permissionScopes = new Set<string>(ALL_PERMISSION_SCOPES);
const assistantPolicySchema = z.object({
  enabled: z.boolean(),
  allowedProviders: z.array(z.enum(["codex", "claude"])).min(1),
  allowedModels: z.array(z.string().trim().min(1).max(200)).max(100),
  mcpScopes: z.array(z.string().refine((value) => permissionScopes.has(value), "Invalid permission scope")).min(1).max(50),
  maxConcurrentRuns: z.number().int().min(1).max(50),
  retentionDays: z.number().int().min(1).max(3650)
});

export const registerAssistantSessionRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    assistantSessionStore: AssistantSessionStore;
    slackIdentityStore: SlackIdentityStore;
    assistantPolicyStore: AssistantPolicyStore;
    assistantRuntimeService: AssistantRuntimeService;
  }
): void => {
  app.get(
    "/assistant/policy",
    { preHandler: deps.auth.requireAllScopes(["settings:read"]) },
    async () => deps.assistantPolicyStore.get()
  );

  app.get(
    "/assistant/admin/sessions",
    { preHandler: deps.auth.requireAllScopes(["settings:read"]) },
    async () => deps.assistantSessionStore.listAllSessions()
  );

  app.put(
    "/assistant/policy",
    { preHandler: deps.auth.requireAllScopes(["settings:edit"]) },
    async (request, reply) => {
      const parsed = assistantPolicySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
      return deps.assistantPolicyStore.update({
        ...parsed.data,
        mcpScopes: parsed.data.mcpScopes as PermissionScope[]
      });
    }
  );

  app.get(
    "/assistant/slack-identity",
    { preHandler: deps.auth.requireAuth() },
    async (request) => deps.slackIdentityStore.getForUser(request.auth!.user.id)
  );

  app.put(
    "/assistant/slack-identity",
    { preHandler: deps.auth.requireAuth() },
    async (request, reply) => {
      const parsed = slackIdentitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.message });
      }
      try {
        return await deps.slackIdentityStore.setForUser(
          request.auth!.user.id,
          parsed.data.slackTeamId,
          parsed.data.slackUserId
        );
      } catch (error) {
        const sent = sendHttpError(reply, error);
        if (sent) {
          return sent;
        }
        throw error;
      }
    }
  );

  app.get(
    "/assistant/sessions",
    { preHandler: deps.auth.requireAuth() },
    async (request) => deps.assistantSessionStore.listSessions(request.auth!.user.id)
  );

  app.get<{ Params: { id: string } }>(
    "/assistant/sessions/:id/events",
    { preHandler: deps.auth.requireAuth() },
    async (request) => deps.assistantSessionStore.listEvents(request.auth!.user.id, request.params.id)
  );

  app.delete(
    "/assistant/session",
    { preHandler: deps.auth.requireAuth() },
    async (request, reply) => {
      const cleared = await deps.assistantSessionStore.clearActiveSession(request.auth!.user.id);
      if (!cleared) {
        return reply.status(204).send();
      }
      await deps.assistantRuntimeService.clearSessionState(cleared.id);
      return reply.send(cleared);
    }
  );
};
