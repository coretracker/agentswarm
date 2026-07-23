import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { AuthSessionUser, CreateRepositoryInput, PermissionScope, Repository, User } from "@verft/shared-types";
import { registerRepositoryRoutes } from "./repositories.js";

const now = "2026-06-24T00:00:00.000Z";

const createUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "User One",
  email: "user-1@example.com",
  githubUsername: null,
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
  roles: [],
  repositoryIds: [],
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const createAuthUser = (overrides: Partial<AuthSessionUser> = {}): AuthSessionUser => ({
  ...createUser(overrides),
  scopes: ["repo:create"],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: [],
  ...overrides
});

const createRepository = (input: CreateRepositoryInput, overrides: Partial<Repository> = {}): Repository => ({
  id: "repo-1",
  name: input.name,
  url: input.url,
  defaultBranch: input.defaultBranch ?? "develop",
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  hostCommands: input.hostCommands ?? [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  githubPrWebhookSecretConfigured: false,
  githubIntegrationBotLogin: input.githubIntegrationBotLogin ?? null,
  githubPrAllowedUsers: input.githubPrAllowedUsers ?? [],
  githubPrRequireBotMention: input.githubPrRequireBotMention ?? true,
  githubPrAutoArchiveOnMerge: input.githubPrAutoArchiveOnMerge !== false,
  githubPrInitialInstructions: input.githubPrInitialInstructions ?? null,
  githubPrFeedbackInstructions: input.githubPrFeedbackInstructions ?? null,
  githubPrReviewInstructions: input.githubPrReviewInstructions ?? null,
  githubPrTaskOwnerUserId: input.githubPrTaskOwnerUserId ?? null,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const createTestApp = ({
  authUser,
  users
}: {
  authUser?: AuthSessionUser | null;
  users?: User[];
} = {}) => {
  const app = Fastify();
  const storedUsers = new Map((users ?? [createUser({ id: "user-1" })]).map((user) => [user.id, user]));
  const repositories = new Map<string, Repository>();
  const updateUserCalls: Array<{ userId: string; patch: Partial<User> }> = [];

  registerRepositoryRoutes(app, {
    auth: {
      requireAllScopes:
        (scopes: PermissionScope[]) =>
        async (request, reply): Promise<void> => {
          if (!authUser || !scopes.every((scope) => authUser.scopes.includes(scope))) {
            await reply.status(403).send({ message: "Forbidden" });
            return;
          }
          request.auth = {
            user: authUser,
            scopes: new Set(authUser.scopes),
            sessionToken: "test-session",
            expiresAt: now,
            session: { user: authUser, expiresAt: now }
          };
        },
      requireAuth: () => async () => undefined,
      authenticateCookieHeader: async () => null,
      authenticateBearerToken: async () => null,
      setSessionCookie: () => undefined,
      clearSessionCookie: () => undefined,
      clearSessionFromRequest: async () => undefined,
      buildSessionResponse: async () => ({ user: authUser!, expiresAt: now }),
      authorizeSocket: () => () => undefined,
      onSocketConnection: () => undefined,
      emitScopedRealtimeEvent: async () => undefined
    },
    repositoryStore: {
      createRepository: async (input: CreateRepositoryInput) => {
        const repository = createRepository(input);
        repositories.set(repository.id, repository);
        return repository;
      },
      getRepository: async (repositoryId: string) => repositories.get(repositoryId) ?? null,
      listRepositories: async () => Array.from(repositories.values()),
      getRepositoryRuntimeEnvEntries: async () => [],
      getRepositoryMcpServers: async () => [],
      getRepositoryHostCommands: async () => [],
      updateRepository: async () => null,
      getRepositoryWebhookTarget: async () => null,
      getRepositoryGitHubPrWebhookSecret: async () => null,
      getRepositoryInboundWebhookSecret: async () => null,
      getRepositoryInboundWebhookSignatureSecrets: async () => ({}),
      recordWebhookDeliveryResult: async () => null,
      deleteRepository: async () => false
    },
    userStore: {
      getUser: async (userId: string) => storedUsers.get(userId) ?? null,
      updateUser: async (userId: string, patch: Partial<User>) => {
        updateUserCalls.push({ userId, patch });
        const current = storedUsers.get(userId);
        if (!current) {
          return null;
        }
        const next = { ...current, ...patch };
        storedUsers.set(userId, next);
        return next;
      }
    } as never
  });

  return { app, updateUserCalls };
};

test("repository create allows the authenticated user as GitHub-created task owner", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app, updateUserCalls } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      githubPrTaskOwnerUserId: "user-1"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(JSON.parse(response.body).githubPrTaskOwnerUserId, "user-1");
  assert.deepEqual(updateUserCalls, [{ userId: "user-1", patch: { repositoryIds: ["repo-1"] } }]);

  await app.close();
});

test("repository create accepts disabled GitHub PR auto-archive setting", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      githubPrAutoArchiveOnMerge: false
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(JSON.parse(response.body).githubPrAutoArchiveOnMerge, false);

  await app.close();
});

test("repository create defaults GitHub PR auto-archive on", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(JSON.parse(response.body).githubPrAutoArchiveOnMerge, true);

  await app.close();
});

test("repository create defaults GitHub bot mention filtering on", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const defaultedResponse = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git"
    }
  });
  const disabledResponse = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo-2",
      url: "https://github.com/acme/repo-2.git",
      githubPrRequireBotMention: false
    }
  });

  assert.equal(defaultedResponse.statusCode, 201);
  assert.equal(JSON.parse(defaultedResponse.body).githubPrRequireBotMention, true);
  assert.equal(disabledResponse.statusCode, 201);
  assert.equal(JSON.parse(disabledResponse.body).githubPrRequireBotMention, false);

  await app.close();
});

test("repository create ignores repository MCP server payloads", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      mcpServers: [
        {
          name: "github",
          enabled: true,
          transport: "http",
          url: "https://api.githubcopilot.com/mcp",
          bearerTokenEnvVar: "GITHUB_MCP_TOKEN"
        }
      ]
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.body).mcpServers, []);

  await app.close();
});

test("repository create accepts blank inbound webhook header secrets", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      inboundWebhookSignatureHeaderSecrets: [
        { header: "x-linear-signature", secret: "" },
        { header: "x-hub-signature-256", secret: "" }
      ]
    }
  });

  assert.equal(response.statusCode, 201);

  await app.close();
});

test("repository create rejects a GitHub-created task owner who cannot already access the new repository", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app, updateUserCalls } = createTestApp({
    authUser,
    users: [createUser({ id: "user-1" }), createUser({ id: "user-2", email: "user-2@example.com" })]
  });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      githubPrTaskOwnerUserId: "user-2"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    message: "GitHub-created task owner must have access to this repository."
  });
  assert.deepEqual(updateUserCalls, []);

  await app.close();
});

test("repository create rejects duplicate GitHub allowed users", async () => {
  const authUser = createAuthUser({ id: "user-1" });
  const { app } = createTestApp({ authUser, users: [createUser({ id: "user-1" })] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories",
    payload: {
      name: "repo",
      url: "https://github.com/acme/repo.git",
      githubPrAllowedUsers: ["alice", "@Alice"]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).message, /Duplicate GitHub user/);

  await app.close();
});
