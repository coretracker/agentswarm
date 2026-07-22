import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { AuthSessionUser } from "@verft/shared-types";

import { registerMcpRoutes } from "./server.js";

const createTestApp = (overrides: { authenticateBearerToken?: () => Promise<unknown> } = {}) => {
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, {
    auth: {
      authenticateBearerToken: overrides.authenticateBearerToken ?? (async () => null)
    },
    repositoryStore: {},
    settingsStore: {},
    taskStore: {},
    taskQueueStore: {},
    scheduler: {},
    spawner: {}
  } as never);
  return app;
};

const user: AuthSessionUser = {
  id: "user-1",
  name: "User",
  email: "user@example.com",
  githubUsername: null,
  defaultProvider: null,
  defaultModel: null,
  defaultProviderProfile: null,
  active: true,
  roles: [],
  repositoryIds: [],
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scopes: ["task:ask"],
  allowedProviders: [],
  allowedModels: [],
  allowedEfforts: []
};

const authContext = (runtimeContext: unknown = null) => ({
  user,
  scopes: new Set(user.scopes),
  sessionToken: "",
  expiresAt: "2026-01-01T00:00:00.000Z",
  personalAccessTokenRuntimeContext: runtimeContext,
  session: {
    user,
    expiresAt: "2026-01-01T00:00:00.000Z"
  }
});

describe("MCP server route", () => {
  it("accepts initialized notifications without returning a JSON-RPC error", async () => {
    let authCalls = 0;
    const app = createTestApp({
      authenticateBearerToken: async () => {
        authCalls += 1;
        return null;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        method: "notifications/initialized"
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.body, "");
    assert.equal(authCalls, 0);
  });

  it("lists MCP tools for an authenticated request", async () => {
    const normalApp = createTestApp({
      authenticateBearerToken: async () => authContext()
    });
    const normalResponse = await normalApp.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer token" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      }
    });
    assert.equal(normalResponse.statusCode, 200);
    const normalPayload = normalResponse.json();
    assert.ok(Array.isArray(normalPayload.result.tools));
  });
});
