import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repository, SystemSettings } from "@agentswarm/shared-types";
import { resolveCreateTaskProviderConfig } from "./task-create-defaults.js";

const settings: SystemSettings = {
  defaultProvider: "codex",
  maxAgents: 3,
  branchPrefix: "agentswarm/",
  workspaceProvisioningMode: "clone_only",
  gitUsername: "agentswarm",
  gitAuthorName: null,
  gitAuthorEmail: null,
  hostexec: { enabled: false, url: null, bearerTokenEnvVar: null },
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  taskPromptMagicModel: "gpt-5.5",
  taskPromptMagicTemplate: "",
  githubTokenConfigured: false,
  openaiApiKeyConfigured: true,
  codexAuthJsonConfigured: false,
  anthropicApiKeyConfigured: true,
  codexDefaultModel: "gpt-5.5",
  codexModels: [],
  codexDefaultEffort: "medium",
  claudeDefaultModel: "claude-opus-4-8",
  claudeModels: [],
  claudeDefaultEffort: "high",
  slackAgentMcpServers: [],
  slackAssistantProvider: "codex",
  slackAssistantModel: "gpt-5.5",
  slackHarnessWhatExists: null,
  slackHarnessAllowedActions: null,
  slackHarnessHowToWork: null,
  slackHarnessDefinitionOfDone: null,
  slackHarnessEvidenceExpectations: null,
  slackBotTokenConfigured: false,
  slackSigningSecretConfigured: false,
  slackLastEventAt: null,
  slackLastEventStatus: null,
  slackLastEventType: null,
  slackLastEventError: null,
  responsePreferencePresets: []
};

const repository: Pick<Repository, "defaultProvider" | "defaultModel" | "defaultProviderProfile"> = {
  defaultProvider: "claude",
  defaultModel: "claude-sonnet-4-6",
  defaultProviderProfile: "max"
};

describe("resolveCreateTaskProviderConfig", () => {
  it("falls through task -> user -> repository -> system defaults", () => {
    assert.deepEqual(
      resolveCreateTaskProviderConfig({}, settings, repository, {
        defaultProvider: "codex",
        defaultModel: "gpt-5.4",
        defaultProviderProfile: "high"
      }),
      {
        provider: "codex",
        providerProfile: "high",
        modelOverride: "gpt-5.4"
      }
    );

    assert.deepEqual(resolveCreateTaskProviderConfig({}, settings, repository), {
      provider: "claude",
      providerProfile: "max",
      modelOverride: "claude-sonnet-4-6"
    });

    assert.deepEqual(resolveCreateTaskProviderConfig({}, settings, null), {
      provider: "codex",
      providerProfile: "medium",
      modelOverride: "gpt-5.5"
    });
  });

  it("preserves explicit task-level values over user and repository defaults", () => {
    assert.deepEqual(
      resolveCreateTaskProviderConfig(
        {
          provider: "codex",
          providerProfile: "high",
          modelOverride: "gpt-5.4"
        },
        settings,
        repository,
        {
          defaultProvider: "claude",
          defaultModel: "claude-haiku-4-5-20251001",
          defaultProviderProfile: "low"
        }
      ),
      {
        provider: "codex",
        providerProfile: "high",
        modelOverride: "gpt-5.4"
      }
    );
  });

  it("uses repository model/profile with system provider when repository provider is null", () => {
    assert.deepEqual(
      resolveCreateTaskProviderConfig(
        {},
        settings,
        {
          defaultProvider: null,
          defaultModel: "gpt-5.4-mini",
          defaultProviderProfile: "high"
        }
      ),
      {
        provider: "codex",
        providerProfile: "high",
        modelOverride: "gpt-5.4-mini"
      }
    );
  });

  it("falls through each null user preference to the next tier", () => {
    assert.deepEqual(
      resolveCreateTaskProviderConfig(
        {},
        settings,
        repository,
        {
          defaultProvider: null,
          defaultModel: null,
          defaultProviderProfile: null
        }
      ),
      {
        provider: "claude",
        providerProfile: "max",
        modelOverride: "claude-sonnet-4-6"
      }
    );
  });
});
