import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisRepositoryStore } from "./repository-store.js";

class FakeRedis {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  async sadd(key: string, value: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const previousSize = set.size;
    set.add(value);
    this.sets.set(key, set);
    return set.size - previousSize;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  multi() {
    const operations: Array<() => Promise<unknown>> = [];
    const chain = {
      set: (key: string, value: string) => {
        operations.push(() => this.set(key, value));
        return chain;
      },
      sadd: (key: string, value: string) => {
        operations.push(() => this.sadd(key, value));
        return chain;
      },
      exec: async () => Promise.all(operations.map((operation) => operation()))
    };
    return chain;
  }

  pipeline() {
    return this.multi();
  }
}

describe("RedisRepositoryStore MCP servers", () => {
  it("persists nullable repository default agent settings", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      defaultProvider: "claude",
      defaultModel: "  claude-sonnet-4-6  ",
      defaultProviderProfile: "max"
    });

    assert.equal(created.defaultProvider, "claude");
    assert.equal(created.defaultModel, "claude-sonnet-4-6");
    assert.equal(created.defaultProviderProfile, "max");

    const updated = await store.updateRepository(created.id, {
      defaultProvider: null,
      defaultModel: "   ",
      defaultProviderProfile: null
    });

    assert.equal(updated?.defaultProvider, null);
    assert.equal(updated?.defaultModel, null);
    assert.equal(updated?.defaultProviderProfile, null);
  });

  it("persists and normalizes repository MCP servers", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      mcpServers: [
        {
          name: "GitHub Tools",
          enabled: true,
          transport: "http",
          url: "https://api.githubcopilot.com/mcp",
          bearerTokenEnvVar: "GITHUB_MCP_TOKEN"
        },
        {
          name: "GitHub Tools",
          enabled: true,
          transport: "stdio",
          command: "ignored"
        },
        {
          name: "memory",
          enabled: false,
          transport: "stdio",
          command: "npx",
          args: ["", "-y", "mcp-memory"]
        }
      ]
    });

    assert.deepEqual(
      created.mcpServers.map((server) => server.name),
      ["github-tools", "memory"]
    );
    assert.deepEqual(await store.getRepositoryMcpServers(created.id), created.mcpServers);
    assert.deepEqual(await store.getRepositorySlackAgentMcpServers(created.id), []);

    const updated = await store.updateRepository(created.id, {
      mcpServers: [
        {
          name: "remote",
          enabled: true,
          transport: "http",
          url: "https://example.com/mcp",
          bearerTokenEnvVar: "BAD-NAME"
        }
      ]
    });

    assert.deepEqual(updated?.mcpServers, [
      {
        name: "remote",
        enabled: true,
        transport: "http",
        url: "https://example.com/mcp",
        bearerTokenEnvVar: null
      }
    ]);
  });

  it("persists and normalizes Slack agent MCP servers separately", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      mcpServers: [
        {
          name: "repo-tools",
          enabled: true,
          transport: "stdio",
          command: "repo-mcp"
        }
      ],
      slackAgentMcpServers: [
        {
          name: "GitHub",
          enabled: true,
          transport: "http",
          url: "https://example.com/github-mcp",
          bearerTokenEnvVar: "GITHUB_TOKEN"
        },
        {
          name: "GitHub",
          enabled: true,
          transport: "stdio",
          command: "ignored"
        }
      ]
    });

    assert.deepEqual(
      created.mcpServers.map((server) => server.name),
      ["repo-tools"]
    );
    assert.deepEqual(created.slackAgentMcpServers, [
      {
        name: "github",
        enabled: true,
        transport: "http",
        url: "https://example.com/github-mcp",
        bearerTokenEnvVar: "GITHUB_TOKEN"
      }
    ]);
    assert.deepEqual(await store.getRepositorySlackAgentMcpServers(created.id), created.slackAgentMcpServers);

    const updated = await store.updateRepository(created.id, {
      slackAgentMcpServers: [
        {
          name: "memory",
          enabled: false,
          transport: "stdio",
          command: "npx",
          args: ["-y", "mcp-memory"]
        }
      ]
    });

    assert.deepEqual(updated?.mcpServers, created.mcpServers);
    assert.deepEqual(updated?.slackAgentMcpServers, [
      {
        name: "memory",
        enabled: false,
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-memory"]
      }
    ]);
  });

  it("persists and normalizes repository host commands", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      hostCommands: ["xcodebuild", "XCODEBUILD", "gradlew", "../bad", "tool.name"]
    });

    assert.deepEqual(created.hostCommands, ["xcodebuild", "gradlew", "tool.name"]);
    assert.deepEqual(await store.getRepositoryHostCommands(created.id), created.hostCommands);

    const updated = await store.updateRepository(created.id, {
      hostCommands: ["security", "bad/name", "codesign"]
    });

    assert.deepEqual(updated?.hostCommands, ["security", "codesign"]);
  });

  it("persists repository harness guidance and normalizes empty updates to null", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      harnessWhatExists: "  apps/server and apps/web  ",
      harnessAllowedActions: "Only edit TypeScript and docs.",
      harnessHowToWork: "Use harness scripts first.",
      harnessDefinitionOfDone: "check.sh and test.sh pass.",
      harnessEvidenceExpectations: "Include commands and outcomes."
    });

    assert.equal(created.harnessWhatExists, "apps/server and apps/web");
    assert.equal(created.harnessAllowedActions, "Only edit TypeScript and docs.");
    assert.equal(created.harnessHowToWork, "Use harness scripts first.");
    assert.equal(created.harnessDefinitionOfDone, "check.sh and test.sh pass.");
    assert.equal(created.harnessEvidenceExpectations, "Include commands and outcomes.");

    const updated = await store.updateRepository(created.id, {
      harnessAllowedActions: "   ",
      harnessHowToWork: null,
      harnessDefinitionOfDone: "  Run targeted tests and pr-ready.sh. "
    });

    assert.equal(updated?.harnessWhatExists, "apps/server and apps/web");
    assert.equal(updated?.harnessAllowedActions, null);
    assert.equal(updated?.harnessHowToWork, null);
    assert.equal(updated?.harnessDefinitionOfDone, "Run targeted tests and pr-ready.sh.");
    assert.equal(updated?.harnessEvidenceExpectations, "Include commands and outcomes.");
  });

  it("stores Slack credentials internally and exposes only configured flags", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git",
      slackBotToken: "  xoxb-token  ",
      slackSigningSecret: "  signing-secret  "
    });

    assert.equal(created.slackBotTokenConfigured, true);
    assert.equal(created.slackSigningSecretConfigured, true);
    const integration = await store.getRepositorySlackIntegration(created.id);
    assert.equal(integration?.botToken, "xoxb-token");
    assert.equal(integration?.signingSecret, "signing-secret");

    const cleared = await store.updateRepository(created.id, {
      clearSlackBotToken: true,
      clearSlackSigningSecret: true
    });

    assert.equal(cleared?.slackBotTokenConfigured, false);
    assert.equal(cleared?.slackSigningSecretConfigured, false);
    assert.equal(await store.getRepositorySlackIntegration(created.id), null);
  });

  it("records the latest Slack event status", async () => {
    const store = new RedisRepositoryStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never
    );

    const created = await store.createRepository({
      name: "Repo",
      url: "https://github.com/acme/repo.git"
    });

    const receivedAt = "2026-07-01T12:00:00.000Z";
    const updated = await store.recordSlackEventResult(created.id, {
      status: "ignored",
      receivedAt,
      eventType: "message.im",
      errorMessage: "unmatched_user"
    });

    assert.equal(updated?.slackLastEventAt, receivedAt);
    assert.equal(updated?.slackLastEventStatus, "ignored");
    assert.equal(updated?.slackLastEventType, "message.im");
    assert.equal(updated?.slackLastEventError, "unmatched_user");
  });
});
