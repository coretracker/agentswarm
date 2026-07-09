import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { AssistantSessionStore } from "../services/assistant-session-store.js";
import type { SlackIdentityStore } from "../services/slack-identity-store.js";
import { z } from "zod";
import { sendHttpError } from "../lib/http-error.js";

const slackIdentitySchema = z.object({
  slackTeamId: z.string().trim().nullable(),
  slackUserId: z.string().trim().nullable()
});

export const registerAssistantSessionRoutes = (
  app: FastifyInstance,
  deps: { auth: AuthService; assistantSessionStore: AssistantSessionStore; slackIdentityStore: SlackIdentityStore }
): void => {
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
      return reply.send(cleared);
    }
  );
};
