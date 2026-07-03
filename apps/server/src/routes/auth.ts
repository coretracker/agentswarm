import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ALL_PERMISSION_SCOPES, type PermissionScope } from "@verft/shared-types";
import type { AuthService } from "../lib/auth.js";
import type { PersonalAccessTokenStore } from "../services/personal-access-token-store.js";
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

const nullableDefaultProviderSchema = z.enum(["codex", "claude"]).nullable().optional();
const nullableDefaultProviderProfileSchema = z.enum(["low", "medium", "high", "max"]).nullable().optional();

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).optional(),
  githubUsername: z.string().trim().max(80).nullable().optional(),
  slackUsername: z.string().trim().max(80).nullable().optional(),
  defaultProvider: nullableDefaultProviderSchema,
  defaultModel: z.string().trim().max(200).nullable().optional(),
  defaultProviderProfile: nullableDefaultProviderProfileSchema,
  agentResponsePreference: responsePreferenceSchema.optional()
});

const personalAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(ALL_PERMISSION_SCOPES as [PermissionScope, ...PermissionScope[]])).optional(),
  expiresAt: z.string().trim().min(1).nullable().optional()
});

export const registerAuthRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    userStore: UserStore;
    sessionStore: SessionStore;
    personalAccessTokenStore: PersonalAccessTokenStore;
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
      githubUsername: authUser.githubUsername,
      slackUsername: authUser.slackUsername,
      defaultProvider: authUser.defaultProvider,
      defaultModel: authUser.defaultModel,
      defaultProviderProfile: authUser.defaultProviderProfile,
      agentResponsePreference: authUser.agentResponsePreference
    };
  });

  app.get("/auth/personal-access-tokens", { preHandler: deps.auth.requireAuth() }, async (request) => {
    return deps.personalAccessTokenStore.listTokens(request.auth!.user.id);
  });

  app.post("/auth/personal-access-tokens", { preHandler: deps.auth.requireAuth() }, async (request, reply) => {
    const parsed = personalAccessTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const token = await deps.personalAccessTokenStore.createToken({
        userId: request.auth!.user.id,
        name: parsed.data.name,
        scopes: parsed.data.scopes,
        expiresAt: parsed.data.expiresAt ?? null
      });
      return reply.status(201).send(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Personal access token could not be created.";
      return reply.status(400).send({ message });
    }
  });

  app.delete<{ Params: { id: string } }>("/auth/personal-access-tokens/:id", { preHandler: deps.auth.requireAuth() }, async (request, reply) => {
    const token = await deps.personalAccessTokenStore.revokeToken(request.auth!.user.id, request.params.id);
    if (!token) {
      return reply.status(404).send({ message: "Personal access token not found" });
    }
    return reply.send(token);
  });

  app.patch("/auth/profile", { preHandler: deps.auth.requireAuth() }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const userId = request.auth!.user.id;
    if (
      parsed.data.name !== undefined ||
      parsed.data.githubUsername !== undefined ||
      parsed.data.slackUsername !== undefined ||
      parsed.data.defaultProvider !== undefined ||
      parsed.data.defaultModel !== undefined ||
      parsed.data.defaultProviderProfile !== undefined ||
      parsed.data.agentResponsePreference !== undefined
    ) {
      const updated = await deps.userStore.updateUser(userId, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.githubUsername !== undefined ? { githubUsername: parsed.data.githubUsername } : {}),
        ...(parsed.data.slackUsername !== undefined ? { slackUsername: parsed.data.slackUsername } : {}),
        ...(parsed.data.defaultProvider !== undefined ? { defaultProvider: parsed.data.defaultProvider } : {}),
        ...(parsed.data.defaultModel !== undefined ? { defaultModel: parsed.data.defaultModel } : {}),
        ...(parsed.data.defaultProviderProfile !== undefined ? { defaultProviderProfile: parsed.data.defaultProviderProfile } : {}),
        ...(parsed.data.agentResponsePreference !== undefined ? { agentResponsePreference: parsed.data.agentResponsePreference } : {})
      });
      if (!updated) {
        return reply.status(404).send({ message: "User not found" });
      }
    }

    const refreshedUser = await deps.userStore.getAuthSessionUser(userId);
    if (!refreshedUser) {
      return reply.status(404).send({ message: "User not found" });
    }

    return reply.send({
      name: refreshedUser.name,
      email: refreshedUser.email,
      githubUsername: refreshedUser.githubUsername,
      slackUsername: refreshedUser.slackUsername,
      defaultProvider: refreshedUser.defaultProvider,
      defaultModel: refreshedUser.defaultModel,
      defaultProviderProfile: refreshedUser.defaultProviderProfile,
      agentResponsePreference: refreshedUser.agentResponsePreference
    });
  });
};
