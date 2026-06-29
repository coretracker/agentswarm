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
});
