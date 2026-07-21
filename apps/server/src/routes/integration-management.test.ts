import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { IntegrationRule, PermissionScope, Repository } from "@verft/shared-types";
import { registerIntegrationManagementRoutes } from "./integration-management.js";

const now = "2026-07-21T00:00:00.000Z";

const createRepository = (id: string, name: string): Repository => ({
  id,
  name,
  url: `https://github.com/acme/${name}.git`,
  defaultBranch: "develop",
  envVars: [],
  envSecrets: [],
  mcpServers: [],
  hostCommands: [],
  webhookUrl: null,
  webhookEnabled: false,
  webhookSecretConfigured: false,
  githubPrWebhookSecretConfigured: false,
  inboundWebhookSecretConfigured: false,
  webhookLastAttemptAt: null,
  webhookLastStatus: null,
  webhookLastError: null,
  createdAt: now,
  updatedAt: now
});

const createRule = (id: string, repositoryId: string, name: string): IntegrationRule => ({
  id,
  repositoryId,
  name,
  enabled: true,
  filter: { conditions: [{ source: "body", field: "action", op: "equals", value: "opened" }] },
  mapping: { title: "{{body.issue.title}}" },
  execution: { provider: "codex", providerProfile: "high" },
  correlationField: "body.issue.id",
  taskOwnerUserId: "user-1",
  createdAt: now,
  updatedAt: now
});

const registerCopyIntegrationSetupTestApp = (options: { repositoryIds: string[] }) => {
  const app = Fastify();
  const repositories = new Map([
    ["source", createRepository("source", "source")],
    ["target", createRepository("target", "target")]
  ]);
  const secrets = new Map<string, string | null>([
    ["source", "source-secret"],
    ["target", null]
  ]);
  const rules = [
    createRule("source-rule", "source", "Source Rule"),
    createRule("target-rule", "target", "Target Rule")
  ];

  registerIntegrationManagementRoutes(app, {
    auth: {
      requireAllScopes:
        (scopes: PermissionScope[]) =>
        async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
          if (!scopes.includes("repo:edit")) {
            await reply.status(403).send({ message: "Forbidden" });
          }
          request.auth = {
            user: {
              id: "user-1",
              name: "User One",
              email: "user@example.com",
              githubUsername: null,
              defaultProvider: null,
              defaultModel: null,
              defaultProviderProfile: null,
              active: true,
              agentResponsePreference: {},
              roles: [],
              repositoryIds: options.repositoryIds,
              scopes: ["repo:edit"],
              allowedProviders: [],
              allowedModels: [],
              allowedEfforts: [],
              lastLoginAt: null,
              createdAt: now,
              updatedAt: now
            },
            scopes: new Set(["repo:edit"]),
            sessionToken: "test-session",
            expiresAt: now,
            session: { user: {} as never, expiresAt: now }
          };
        }
    } as never,
    repositoryStore: {
      getRepository: async (repositoryId: string) => repositories.get(repositoryId) ?? null,
      getRepositoryInboundWebhookSecret: async (repositoryId: string) => secrets.get(repositoryId) ?? null,
      updateRepository: async (repositoryId: string, input: { inboundWebhookSecret?: string; clearInboundWebhookSecret?: boolean }) => {
        const repository = repositories.get(repositoryId);
        if (!repository) {
          return null;
        }
        secrets.set(repositoryId, input.clearInboundWebhookSecret ? null : input.inboundWebhookSecret ?? secrets.get(repositoryId) ?? null);
        return { ...repository, inboundWebhookSecretConfigured: Boolean(secrets.get(repositoryId)) };
      }
    } as never,
    integrationRuleStore: {
      listRules: async (repositoryId: string) => rules.filter((rule) => rule.repositoryId === repositoryId),
      deleteRule: async (ruleId: string) => {
        const index = rules.findIndex((rule) => rule.id === ruleId);
        if (index < 0) {
          return false;
        }
        rules.splice(index, 1);
        return true;
      },
      createRule: async (repositoryId: string, input: Partial<IntegrationRule>) => {
        const rule = createRule(`copied-${rules.length + 1}`, repositoryId, input.name ?? "Copied Rule");
        rule.enabled = input.enabled ?? true;
        rule.filter = input.filter ?? rule.filter;
        rule.mapping = input.mapping ?? rule.mapping;
        rule.execution = input.execution ?? null;
        rule.correlationField = input.correlationField ?? null;
        rule.taskOwnerUserId = input.taskOwnerUserId ?? null;
        rules.push(rule);
        return rule;
      }
    } as never,
    webhookInboxStore: {} as never
  });

  return { app, secrets, rules };
};

test("copy integration setup replaces target rules and copies inbound secret", async () => {
  const { app, secrets, rules } = registerCopyIntegrationSetupTestApp({ repositoryIds: ["source", "target"] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories/target/integration-setup/copy",
    payload: {
      sourceRepositoryId: "source",
      copyRules: true,
      replaceRules: true,
      copyInboundWebhookSecret: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    rulesCopied: 1,
    rulesDeleted: 1,
    inboundWebhookSecretCopied: true,
    inboundWebhookSecretCleared: false
  });
  assert.equal(secrets.get("target"), "source-secret");
  assert.deepEqual(rules.filter((rule) => rule.repositoryId === "target").map((rule) => rule.name), ["Source Rule"]);

  await app.close();
});

test("copy integration setup rejects inaccessible source repositories", async () => {
  const { app, secrets, rules } = registerCopyIntegrationSetupTestApp({ repositoryIds: ["target"] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories/target/integration-setup/copy",
    payload: {
      sourceRepositoryId: "source",
      copyRules: true,
      replaceRules: true,
      copyInboundWebhookSecret: true
    }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(secrets.get("target"), null);
  assert.deepEqual(rules.filter((rule) => rule.repositoryId === "target").map((rule) => rule.name), ["Target Rule"]);

  await app.close();
});

test("copy integration setup rejects invalid copy options", async () => {
  const { app } = registerCopyIntegrationSetupTestApp({ repositoryIds: ["source", "target"] });

  const response = await app.inject({
    method: "POST",
    url: "/repositories/target/integration-setup/copy",
    payload: {
      sourceRepositoryId: "source",
      copyRules: false,
      copyInboundWebhookSecret: false
    }
  });

  assert.equal(response.statusCode, 400);

  await app.close();
});
