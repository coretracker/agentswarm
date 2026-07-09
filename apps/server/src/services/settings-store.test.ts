import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RedisSettingsStore } from "./settings-store.js";
import type { CredentialStatus, CredentialStore, RuntimeCredentials } from "./credential-store.js";

class FakeRedis {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }
}

const createCredentialStore = (credentials: RuntimeCredentials): CredentialStore => ({
  async getCredentials() {
    return credentials;
  },
  async getCredentialStatus(): Promise<CredentialStatus> {
    return {
      githubTokenConfigured: Boolean(credentials.githubToken),
      openaiApiKeyConfigured: Boolean(credentials.openaiApiKey),
      anthropicApiKeyConfigured: Boolean(credentials.anthropicApiKey),
      slackSigningSecretConfigured: Boolean(credentials.slackSigningSecret),
      slackBotTokenConfigured: Boolean(credentials.slackBotToken)
    };
  },
  async updateCredentials() {
    return this.getCredentialStatus();
  }
});

describe("RedisSettingsStore runtime credentials", () => {
  it("persists and normalizes global harness guidance", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    const settings = await settingsStore.updateSettings({
      harnessWhatExists: "  Shared CI platform.  ",
      harnessAllowedActions: "   ",
      harnessNotAllowedActions: "Never publish secrets."
    });

    assert.equal(settings.harnessWhatExists, "Shared CI platform.");
    assert.equal(settings.harnessAllowedActions, null);
    assert.equal(settings.harnessNotAllowedActions, "Never publish secrets.");
  });

  it("uses global API credentials regardless of user id or legacy profile source", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: "sk-system",
        anthropicApiKey: "anthropic-system",
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    const userOneCredentials = await settingsStore.getRuntimeCredentials("user-1", "auto");
    const userTwoCredentials = await settingsStore.getRuntimeCredentials("user-2", "profile");

    assert.equal(userOneCredentials.openaiApiKey, "sk-system");
    assert.equal(userTwoCredentials.anthropicApiKey, "anthropic-system");
  });

  it("returns system git author settings with runtime credentials", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    await settingsStore.updateSettings({
      gitAuthorName: "Verft",
      gitAuthorEmail: "verft@example.com"
    });

    const credentials = await settingsStore.getRuntimeCredentials("user-1", "auto");

    assert.equal(credentials.gitAuthorName, "Verft");
    assert.equal(credentials.gitAuthorEmail, "verft@example.com");
  });

  it("returns provider base URL overrides with runtime credentials", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    await settingsStore.updateSettings({
      openaiBaseUrl: " https://openai.example.test ",
      anthropicBaseUrl: " https://anthropic.example.test "
    });

    const credentials = await settingsStore.getRuntimeCredentials("user-1", "auto");

    assert.equal(credentials.openaiBaseUrl, "https://openai.example.test");
    assert.equal(credentials.anthropicBaseUrl, "https://anthropic.example.test");
  });

  it("persists normalized hostexec connection settings", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    const settings = await settingsStore.updateSettings({
      hostexec: {
        enabled: true,
        url: " http://host.docker.internal:38128/ ",
        bearerTokenEnvVar: " HOSTEXEC_TOKEN "
      }
    });

    assert.deepEqual(settings.hostexec, {
      enabled: true,
      url: "http://host.docker.internal:38128",
      bearerTokenEnvVar: "HOSTEXEC_TOKEN"
    });

    const reset = await settingsStore.updateSettings({ hostexec: null });
    assert.deepEqual(reset.hostexec, {
      enabled: false,
      url: null,
      bearerTokenEnvVar: null
    });
  });

  it("does not expose legacy global MCP servers", async () => {
    const redis = new FakeRedis();
    redis.seed("verft:settings", {
      defaultProvider: "codex",
      maxAgents: 2,
      branchPrefix: "verft",
      workspaceProvisioningMode: "clone_only",
      gitUsername: "x-access-token",
      mcpServers: [
        {
          name: "legacy",
          enabled: true,
          transport: "http",
          url: "https://example.com/mcp"
        }
      ]
    });
    const settingsStore = new RedisSettingsStore(
      redis as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    const settings = await settingsStore.getSettings();

    assert.equal(Object.prototype.hasOwnProperty.call(settings, "mcpServers"), false);
  });

});
