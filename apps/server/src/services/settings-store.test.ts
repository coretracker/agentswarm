import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresSettingsStore, RedisSettingsStore } from "./settings-store.js";
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

  it("defaults archived task auto-delete to seven days and persists overrides", async () => {
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

    const initial = await settingsStore.getSettings();
    assert.equal(initial.archivedTaskAutoDeleteEnabled, true);
    assert.equal(initial.archivedTaskAutoDeleteDays, 7);

    const updated = await settingsStore.updateSettings({
      archivedTaskAutoDeleteEnabled: false,
      archivedTaskAutoDeleteDays: 30
    });
    assert.equal(updated.archivedTaskAutoDeleteEnabled, false);
    assert.equal(updated.archivedTaskAutoDeleteDays, 30);
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

    const userOneCredentials = await settingsStore.getRuntimeCredentials();
    const userTwoCredentials = await settingsStore.getRuntimeCredentials();

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

    const credentials = await settingsStore.getRuntimeCredentials();

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

    const credentials = await settingsStore.getRuntimeCredentials();

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

describe("PostgresSettingsStore", () => {
  it("initializes every system settings column and reads global harness guidance", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const pool = {
      async query(sql: string, values: unknown[] = []) {
        queries.push({ sql, values });
        if (sql.includes("FROM system_settings")) {
          return {
            rows: [
              {
                archived_task_auto_delete_enabled: false,
                archived_task_auto_delete_days: 14,
                harness_what_exists: "Shared CI platform.",
                harness_allowed_actions: "Run repository tests.",
                harness_not_allowed_actions: "Do not publish.",
                harness_how_to_work: "Work incrementally.",
                harness_definition_of_done: "CI passes.",
                harness_evidence_expectations: "Report test results."
              }
            ]
          };
        }
        return { rows: [] };
      }
    };
    const store = new PostgresSettingsStore(
      pool as never,
      { publish: async () => undefined } as never,
      createCredentialStore({
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackSigningSecret: null,
        slackBotToken: null
      })
    );

    const settings = await store.getSettings();

    assert.equal(queries[0]?.values.length, 27);
    assert.match(queries[0]?.sql ?? "", /VALUES \(1, \$1,.*\$27::jsonb\)/s);
    for (const column of [
      "archived_task_auto_delete_enabled",
      "archived_task_auto_delete_days",
      "harness_what_exists",
      "harness_allowed_actions",
      "harness_not_allowed_actions",
      "harness_how_to_work",
      "harness_definition_of_done",
      "harness_evidence_expectations"
    ]) {
      assert.match(queries[1]?.sql ?? "", new RegExp(`\\b${column}\\b`));
    }
    assert.equal(settings.archivedTaskAutoDeleteEnabled, false);
    assert.equal(settings.archivedTaskAutoDeleteDays, 14);
    assert.equal(settings.harnessWhatExists, "Shared CI platform.");
    assert.equal(settings.harnessAllowedActions, "Run repository tests.");
    assert.equal(settings.harnessNotAllowedActions, "Do not publish.");
    assert.equal(settings.harnessHowToWork, "Work incrementally.");
    assert.equal(settings.harnessDefinitionOfDone, "CI passes.");
    assert.equal(settings.harnessEvidenceExpectations, "Report test results.");
  });
});
