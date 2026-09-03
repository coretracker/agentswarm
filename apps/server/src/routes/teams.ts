import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import { sendHttpError } from "../lib/http-error.js";
import { TeamStore } from "../services/team-store.js";

const teamSchema = z.object({ name: z.string().trim().min(1).max(120) });
const updateTeamSchema = teamSchema.partial();

export const registerTeamRoutes = (app: FastifyInstance, deps: { auth: AuthService; teamStore: TeamStore }): void => {
  app.get("/teams", { preHandler: deps.auth.requireAuth() }, async (request, reply) => {
    if (!request.auth!.scopes.has("user:list") && !request.auth!.scopes.has("settings:read")) {
      return reply.status(403).send({ message: "Forbidden" });
    }
    return deps.teamStore.listTeams();
  });

  app.post("/teams", { preHandler: deps.auth.requireAllScopes(["settings:edit"]) }, async (request, reply) => {
    const parsed = teamSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
    try {
      return reply.status(201).send(await deps.teamStore.createTeam(parsed.data));
    } catch (error) {
      return sendHttpError(reply, error) ?? Promise.reject(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/teams/:id", { preHandler: deps.auth.requireAllScopes(["settings:edit"]) }, async (request, reply) => {
    const parsed = updateTeamSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
    try {
      const team = await deps.teamStore.updateTeam(request.params.id, parsed.data);
      return team ? reply.send(team) : reply.status(404).send({ message: "Team not found" });
    } catch (error) {
      return sendHttpError(reply, error) ?? Promise.reject(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/teams/:id", { preHandler: deps.auth.requireAllScopes(["settings:edit"]) }, async (request, reply) => {
    try {
      const deleted = await deps.teamStore.deleteTeam(request.params.id);
      return deleted ? reply.status(204).send() : reply.status(404).send({ message: "Team not found" });
    } catch (error) {
      return sendHttpError(reply, error) ?? Promise.reject(error);
    }
  });
};
