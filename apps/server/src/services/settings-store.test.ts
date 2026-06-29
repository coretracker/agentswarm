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
}

const createCredentialStore = (credentials: RuntimeCredentials): CredentialStore => ({
  async getCredentials() {
    return credentials;
  },
  async getCredentialStatus(): Promise<CredentialStatus> {
    return {
      githubTokenConfigured: Boolean(credentials.githubToken),
      openaiApiKeyConfigured: Boolean(credentials.openaiApiKey),
      codexAuthJsonConfigured: Boolean(credentials.codexAuthJson),
      anthropicApiKeyConfigured: Boolean(credentials.anthropicApiKey)
    };
  },
  async updateCredentials() {
    return this.getCredentialStatus();
  }
});

describe("RedisSettingsStore runtime credentials", () => {
  it("uses global Codex credentials regardless of user id or legacy profile source", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        codexAuthJson: "{\"system\":true}"
      })
    );

    const userOneCredentials = await settingsStore.getRuntimeCredentials("user-1", "auto");
    const userTwoCredentials = await settingsStore.getRuntimeCredentials("user-2", "profile");

    assert.equal(userOneCredentials.codexAuthJson, "{\"system\":true}");
    assert.equal(userTwoCredentials.codexAuthJson, "{\"system\":true}");
  });

  it("returns system git author settings with runtime credentials", async () => {
    const settingsStore = new RedisSettingsStore(
      new FakeRedis() as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        codexAuthJson: null
      })
    );

    await settingsStore.updateSettings({
      gitAuthorName: "AgentSwarm",
      gitAuthorEmail: "agentswarm@example.com"
    });

    const credentials = await settingsStore.getRuntimeCredentials("user-1", "auto");

    assert.equal(credentials.gitAuthorName, "AgentSwarm");
    assert.equal(credentials.gitAuthorEmail, "agentswarm@example.com");
  });
});
