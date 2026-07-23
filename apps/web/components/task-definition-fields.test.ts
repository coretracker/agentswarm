import assert from "node:assert/strict";
import { test } from "node:test";
import type { Repository, SystemSettings } from "@verft/shared-types";
import { getTaskDefinitionInitialValues } from "./task-definition-fields";

const settings: SystemSettings = {
  defaultProvider: "codex",
  defaultAutoApplyCheckpoints: false,
  maxAgents: 3,
  archivedTaskAutoDeleteEnabled: true,
  archivedTaskAutoDeleteDays: 7,
  branchPrefix: "verft/",
  workspaceProvisioningMode: "clone_only",
  gitUsername: "verft",
  gitAuthorName: null,
  gitAuthorEmail: null,
  hostexec: { enabled: false, url: null, bearerTokenEnvVar: null },
  openaiBaseUrl: null,
  anthropicBaseUrl: null,
  githubTokenConfigured: false,
  openaiApiKeyConfigured: true,
  anthropicApiKeyConfigured: true,
  slackSigningSecretConfigured: false,
  slackBotTokenConfigured: false,
  codexDefaultModel: "gpt-5.5",
  codexModels: [],
  codexDefaultEffort: "medium",
  claudeDefaultModel: "claude-opus-4-8",
  claudeModels: [],
  claudeDefaultEffort: "high"
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
      branchStrategy: "feature_branch"
    }
  );
});
