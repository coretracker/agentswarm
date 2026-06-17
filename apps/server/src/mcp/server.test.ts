import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";

import { registerMcpRoutes } from "./server.js";

const createTestApp = (overrides: { authenticateBearerToken?: () => Promise<unknown> } = {}) => {
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, {
    auth: {
      authenticateBearerToken: overrides.authenticateBearerToken ?? (async () => null)
    },
    githubImportService: {},
    repositoryStore: {},
    settingsStore: {},
    taskStore: {},
    taskQueueStore: {},
    scheduler: {},
    spawner: {}
  } as never);
  return app;
};

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
});
