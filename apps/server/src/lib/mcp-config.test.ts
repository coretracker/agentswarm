import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectMcpServerEnvEntries,
  serializeClaudeMcpConfig,
  serializeCodexMcpConfig
} from "./mcp-config.js";

describe("serializeCodexMcpConfig", () => {
  it("serializes enabled http and stdio servers", () => {
    const config = serializeCodexMcpConfig([
      {
        name: "memory",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-memory"]
      },
      {
        name: "remote",
        enabled: true,
        transport: "http",
        url: "https://example.com/mcp",
        bearerTokenEnvVar: "MCP_TOKEN"
      },
      {
        name: "disabled",
        enabled: false,
        transport: "stdio",
        command: "ignored"
      }
    ]);

    assert.match(config, /\[mcp_servers\.memory\]/);
    assert.match(config, /command = "npx"/);
    assert.match(config, /args = \["-y", "mcp-memory"\]/);
    assert.match(config, /\[mcp_servers\.remote\]/);
    assert.match(config, /url = "https:\/\/example\.com\/mcp"/);
    assert.match(config, /bearer_token_env_var = "MCP_TOKEN"/);
    assert.doesNotMatch(config, /disabled/);
  });
});

describe("serializeClaudeMcpConfig", () => {
  it("serializes enabled servers into Claude mcpServers", () => {
    const config = serializeClaudeMcpConfig([
      {
        name: "memory",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", "mcp-memory"]
      },
      {
        name: "remote",
        enabled: true,
        transport: "http",
        url: "https://example.com/mcp",
        bearerTokenEnvVar: "MCP_TOKEN"
      }
    ]);

    assert.equal(
      config,
      JSON.stringify(
        {
          mcpServers: {
            memory: {
              type: "stdio",
              command: "npx",
              args: ["-y", "mcp-memory"],
              env: {}
            },
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer ${MCP_TOKEN}"
              }
            }
          }
        },
        null,
        2
      )
    );
  });
});

describe("collectMcpServerEnvEntries", () => {
  it("collects bearer token env vars for enabled servers only", () => {
    const envEntries = collectMcpServerEnvEntries(
      [
        {
          name: "memory",
          enabled: true,
          transport: "http",
          url: "https://example.com/mcp",
          bearerTokenEnvVar: "MCP_TOKEN"
        },
        {
          name: "disabled",
          enabled: false,
          transport: "http",
          url: "https://example.com/disabled",
          bearerTokenEnvVar: "DISABLED_TOKEN"
        },
        {
          name: "stdio",
          enabled: true,
          transport: "stdio",
          command: "npx"
        }
      ],
      {
        MCP_TOKEN: "secret",
        DISABLED_TOKEN: "nope"
      }
    );

    assert.deepEqual(envEntries, [["MCP_TOKEN", "secret"]]);
  });
});
