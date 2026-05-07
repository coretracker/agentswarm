import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { CredentialStore } from "../services/credential-store.js";
import type { SessionStore } from "../services/session-store.js";
import type { UserStore } from "../services/user-store.js";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const responsePreferenceSchema = z
  .object({
    audience: z.enum(["technical", "non_technical", "mixed"]).optional(),
    explanationDepth: z.enum(["one_line", "brief", "standard", "detailed", "deep_dive"]).optional(),
    jargonLevel: z.enum(["avoid", "balanced", "expert"]).optional(),
    codePreference: z.enum(["only_when_needed", "prefer_examples", "avoid_code"]).optional(),
    clarifyBehavior: z.enum(["ask_when_ambiguous", "make_reasonable_assumptions"]).optional(),
    formattingStyle: z.enum(["direct", "teaching", "executive", "step_by_step", "checklist", "qa", "problem_solution"]).optional(),
    extraInstructions: z.string().trim().max(2000).optional()
  });

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).optional(),
  codexAuthJson: z.string().min(1).optional(),
  clearCodexAuthJson: z.boolean().optional(),
  agentResponsePreference: responsePreferenceSchema.optional()
});

export const registerAuthRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    userStore: UserStore;
    sessionStore: SessionStore;
    credentialStore: CredentialStore;
  }
): void => {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const user = await deps.userStore.authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ message: "Invalid email or password" });
    }

    const session = await deps.sessionStore.createSession(user.id);
    deps.auth.setSessionCookie(reply, session.token, session.expiresAt);
    return reply.send(await deps.auth.buildSessionResponse(user.id, session.expiresAt));
  });

  app.post("/auth/logout", async (request, reply) => {
    await deps.auth.clearSessionFromRequest(request);
    deps.auth.clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/auth/session", { preHandler: deps.auth.requireAuth() }, async (request) => request.auth!.session);

  app.get("/auth/profile", { preHandler: deps.auth.requireAuth() }, async (request) => {
    const authUser = request.auth!.user;
    return {
      name: authUser.name,
      email: authUser.email,
      agentResponsePreference: authUser.agentResponsePreference,
      codexAuthJsonConfigured: await deps.credentialStore.hasCodexAuthJsonForUser(authUser.id)
    };
  });

  app.patch("/auth/profile", { preHandler: deps.auth.requireAuth() }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const userId = request.auth!.user.id;
    if (parsed.data.name !== undefined || parsed.data.agentResponsePreference !== undefined) {
      const updated = await deps.userStore.updateUser(userId, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.agentResponsePreference !== undefined ? { agentResponsePreference: parsed.data.agentResponsePreference } : {})
      });
      if (!updated) {
        return reply.status(404).send({ message: "User not found" });
      }
    }

    if (parsed.data.codexAuthJson !== undefined || parsed.data.clearCodexAuthJson) {
      if (parsed.data.clearCodexAuthJson) {
        await deps.credentialStore.setCodexAuthJsonForUser(userId, null);
      } else {
        const raw = parsed.data.codexAuthJson ?? "";
        try {
          const parsedJson = JSON.parse(raw) as unknown;
          if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
            return reply.status(400).send({ message: "Codex auth.json must be a JSON object" });
          }
        } catch {
          return reply.status(400).send({ message: "Codex auth.json must be valid JSON" });
        }
        await deps.credentialStore.setCodexAuthJsonForUser(userId, raw);
      }
    }

    const refreshedUser = await deps.userStore.getAuthSessionUser(userId);
    if (!refreshedUser) {
      return reply.status(404).send({ message: "User not found" });
    }

    return reply.send({
      name: refreshedUser.name,
      email: refreshedUser.email,
      agentResponsePreference: refreshedUser.agentResponsePreference,
      codexAuthJsonConfigured: await deps.credentialStore.hasCodexAuthJsonForUser(userId)
    });
  });
};
