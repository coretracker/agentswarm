import assert from "node:assert/strict";
import { test } from "node:test";
import type { Repository, SystemSettings } from "@verft/shared-types";
import { getTaskDefinitionInitialValues, hasClaudeTaskCredentials } from "./task-definition-fields";

const settings: SystemSettings = {
  defaultProvider: "codex",
  maxAgents: 3,
  branchPrefix: "verft/",
  workspaceProvisioningMode: "clone_only",
  gitUsername: "verft",
  gitAuthorName: null,
  gitAuthorEmail: null,
  hostexec: { enabled: false, url: null, bearerTokenEnvVar: null },
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  taskPromptMagicModel: "gpt-5.5",
  taskPromptMagicTemplate: "",
  githubTokenConfigured: false,
  openaiApiKeyConfigured: true,
  anthropicApiKeyConfigured: true,
  codexDefaultModel: "gpt-5.5",
  codexModels: [],
  codexDefaultEffort: "medium",
  claudeDefaultModel: "claude-opus-4-8",
  claudeModels: [],
  claudeDefaultEffort: "high",
  responsePreferencePresets: []
};

const repository: Repository = {
  id: "repo-1",
  name: "Repo",
  url: "https://github.com/example/repo.git",
  defaultBranch: "main",
  defaultProvider: "claude",
  defaultModel: "claude-sonnet-4-6",
  defaultProviderProfile: "max",
  envVars: [],
  mcpServers: [],
  hostCommands: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

test("getTaskDefinitionInitialValues uses user defaults before repository and system defaults", () => {
  assert.deepEqual(
    getTaskDefinitionInitialValues(settings, repository, {
      defaultProvider: "codex",
      defaultModel: "gpt-5.4",
      defaultProviderProfile: "high"
    }),
    {
      taskType: "build",
      provider: "codex",
      model: "gpt-5.4",
      providerProfile: "high",
      codexCredentialSource: "auto",
      branchStrategy: "feature_branch"
    }
  );
});

test("getTaskDefinitionInitialValues uses repository defaults before system defaults", () => {
  assert.deepEqual(getTaskDefinitionInitialValues(settings, repository), {
    taskType: "build",
    provider: "claude",
    model: "claude-sonnet-4-6",
    providerProfile: "max",
    codexCredentialSource: "auto",
    branchStrategy: "feature_branch"
  });
});

test("getTaskDefinitionInitialValues falls back to system defaults when repository defaults are null", () => {
  assert.deepEqual(
    getTaskDefinitionInitialValues(settings, {
      ...repository,
      defaultProvider: null,
      defaultModel: null,
      defaultProviderProfile: null
    }),
    {
      taskType: "build",
      provider: "codex",
      model: "gpt-5.5",
      providerProfile: "medium",
      codexCredentialSource: "auto",
      branchStrategy: "feature_branch"
    }
  );
});

test("hasClaudeTaskCredentials accepts Anthropic API key or Claude base credentials", () => {
  assert.equal(hasClaudeTaskCredentials({ anthropicApiKeyConfigured: true }, null), true);
  assert.equal(
    hasClaudeTaskCredentials(
      { anthropicApiKeyConfigured: false },
      { files: { "claude/.credentials.json": true } }
    ),
    true
  );
  assert.equal(
    hasClaudeTaskCredentials(
      { anthropicApiKeyConfigured: false },
      { files: { "claude/.credentials.json": false } }
    ),
    false
  );
});
