import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { PermissionScope, ProviderModelOption } from "@verft/shared-types";
import { CLAUDE_MODELS, CODEX_MODELS } from "@verft/shared-types";
import { registerSettingsRoutes } from "./settings.js";

const createTestApp = ({
  anthropicApiKey = null,
  claudeModels = []
}: {
  anthropicApiKey?: string | null;
  claudeModels?: ProviderModelOption[];
} = {}) => {
  const app = Fastify();

  registerSettingsRoutes(app, {
    auth: {
      requireAllScopes:
        (_scopes: PermissionScope[]) =>
        async (request): Promise<void> => {
          request.auth = {
            user: {
              id: "user-1",
              name: "User One",
              email: "user-1@example.com",
              githubUsername: null,
              defaultProvider: null,
              defaultModel: null,
              defaultProviderProfile: null,
              active: true,
              agentResponsePreference: {},
              roles: [],
              repositoryIds: [],
              scopes: ["settings:read"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: [],
              lastLoginAt: null,
              createdAt: "2026-07-08T00:00:00.000Z",
              updatedAt: "2026-07-08T00:00:00.000Z"
            },
            scopes: new Set(["settings:read"]),
            sessionToken: "test-session",
            expiresAt: "2026-07-08T00:00:00.000Z",
            session: { user: null as never, expiresAt: "2026-07-08T00:00:00.000Z" }
          };
        },
      requireAuth: () => async () => undefined,
      authenticateCookieHeader: async () => null,
      authenticateBearerToken: async () => null,
      setSessionCookie: () => undefined,
      clearSessionCookie: () => undefined,
      clearSessionFromRequest: async () => undefined,
      buildSessionResponse: async () => ({ user: null as never, expiresAt: "2026-07-08T00:00:00.000Z" }),
      authorizeSocket: () => () => undefined,
      onSocketConnection: () => undefined,
      emitScopedRealtimeEvent: async () => undefined
    },
    scheduler: {
      onSettingsChanged: async () => undefined
    } as never,
    settingsStore: {
      getSettings: async () => ({
        defaultProvider: "codex",
        maxAgents: 2,
        branchPrefix: "verft",
        workspaceProvisioningMode: "clone_only",
        gitUsername: "x-access-token",
        gitAuthorName: null,
        gitAuthorEmail: null,
        hostexec: { enabled: false, url: null, bearerTokenEnvVar: null },
        openaiBaseUrl: null,
        anthropicBaseUrl: null,
        taskPromptMagicModel: "gpt-5.5",
        taskPromptMagicTemplate: "template",
        codexDefaultModel: "gpt-5.5",
        codexModels: CODEX_MODELS,
        codexDefaultEffort: "high",
        claudeDefaultModel: "claude-opus-4-8",
        claudeModels,
        claudeDefaultEffort: "high",
        githubTokenConfigured: false,
        openaiApiKeyConfigured: false,
        anthropicApiKeyConfigured: Boolean(anthropicApiKey),
        responsePreferencePresets: []
      }),
      getRuntimeCredentials: async () => ({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey,
        openaiBaseUrl: null,
        anthropicBaseUrl: null,
        gitUsername: "x-access-token",
        gitAuthorName: null,
        gitAuthorEmail: null
      }),
      updateSettings: async () => null,
      updateCredentials: async () => null,
      getUserNotes: async () => ({ notes: "" }),
      updateUserNotes: async () => ({ notes: "" })
    } as never
  });

  return app;
};

test("settings models uses Claude fallback without refreshing provider API", async () => {
  const app = createTestApp({ anthropicApiKey: "sk-ant-test" });

  const response = await app.inject({
    method: "GET",
    url: "/settings/models?provider=claude"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { models: CLAUDE_MODELS, source: "fallback" });

  await app.close();
});

test("settings models surfaces Anthropic refresh failures", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
        request_id: "req_test"
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const app = createTestApp({ anthropicApiKey: "sk-ant-test" });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/settings/models?provider=claude&refresh=1"
    });

    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), { message: "Anthropic models API returned 401: invalid x-api-key" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/models");
    assert.equal((calls[0]?.init.headers as Record<string, string>)["anthropic-version"], "2023-06-01");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
