import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { IntegrationRuleStore } from "../services/integration-rule-store.js";
import type { WebhookInboxStore } from "../services/webhook-inbox-store.js";

const filterConditionSchema = z.object({
  source: z.enum(["header", "body"]),
  field: z.string().trim().min(1),
  op: z.enum(["equals", "contains", "exists", "regex"]),
  value: z.string().optional()
});

const filterSchema = z.object({
  conditions: z.array(filterConditionSchema).min(1).max(20)
});

const mappingSchema = z.object({
  title: z.string().trim().optional(),
  instructions: z.string().trim().optional(),
  branch: z.string().trim().optional()
});

const executionSchema = z
  .object({
    provider: z.enum(["codex", "claude"]).optional(),
    model: z.string().trim().optional(),
    providerProfile: z.enum(["low", "medium", "high", "max"]).optional()
  })
  .nullable()
  .optional();

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional(),
  filter: filterSchema,
  mapping: mappingSchema,
  execution: executionSchema,
  correlationField: z.string().trim().nullable().optional(),
  taskOwnerUserId: z.string().trim().nullable().optional()
});

const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  filter: filterSchema.optional(),
  mapping: mappingSchema.optional(),
  execution: executionSchema,
  correlationField: z.string().trim().nullable().optional(),
  taskOwnerUserId: z.string().trim().nullable().optional()
});

export const registerIntegrationManagementRoutes = (
  app: FastifyInstance,
  deps: {
    integrationRuleStore: IntegrationRuleStore;
    webhookInboxStore: WebhookInboxStore;
    auth: AuthService;
  }
): void => {
  // --- Integration Rules ---

  app.get<{ Params: { repositoryId: string } }>(
    "/repositories/:repositoryId/integration-rules",
    { preHandler: deps.auth.requireAllScopes(["repo:read"]) },
    async (request) => {
      return deps.integrationRuleStore.listRules(request.params.repositoryId);
    }
  );

  app.post<{ Params: { repositoryId: string } }>(
    "/repositories/:repositoryId/integration-rules",
    { preHandler: deps.auth.requireAllScopes(["repo:edit"]) },
    async (request, reply) => {
      const input = createRuleSchema.parse(request.body);
      const rule = await deps.integrationRuleStore.createRule(request.params.repositoryId, input);
      return reply.status(201).send(rule);
    }
  );

  app.patch<{ Params: { repositoryId: string; ruleId: string } }>(
    "/repositories/:repositoryId/integration-rules/:ruleId",
    { preHandler: deps.auth.requireAllScopes(["repo:edit"]) },
    async (request, reply) => {
      const input = updateRuleSchema.parse(request.body);
      const rule = await deps.integrationRuleStore.updateRule(request.params.ruleId, input);
      if (!rule) {
        return reply.status(404).send({ message: "Integration rule not found" });
      }
      return rule;
    }
  );

  app.delete<{ Params: { repositoryId: string; ruleId: string } }>(
    "/repositories/:repositoryId/integration-rules/:ruleId",
    { preHandler: deps.auth.requireAllScopes(["repo:edit"]) },
    async (request, reply) => {
      await deps.integrationRuleStore.deleteRule(request.params.ruleId);
      return reply.status(204).send();
    }
  );

  // --- Webhook Inbox ---

  app.get<{ Params: { repositoryId: string }; Querystring: { matched?: string; limit?: string } }>(
    "/repositories/:repositoryId/webhook-inbox",
    { preHandler: deps.auth.requireAllScopes(["repo:read"]) },
    async (request) => {
      const matched =
        request.query.matched === "true" ? true : request.query.matched === "false" ? false : undefined;
      const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;
      return deps.webhookInboxStore.listEntries(request.params.repositoryId, {
        matched,
        limit: limit && Number.isFinite(limit) ? limit : undefined
      });
    }
  );

  app.get<{ Params: { repositoryId: string; entryId: string } }>(
    "/repositories/:repositoryId/webhook-inbox/:entryId",
    { preHandler: deps.auth.requireAllScopes(["repo:read"]) },
    async (request, reply) => {
      const entry = await deps.webhookInboxStore.getEntry(request.params.entryId);
      if (!entry) {
        return reply.status(404).send({ message: "Webhook inbox entry not found" });
      }
      return entry;
    }
  );

  app.delete<{ Params: { repositoryId: string; entryId: string } }>(
    "/repositories/:repositoryId/webhook-inbox/:entryId",
    { preHandler: deps.auth.requireAllScopes(["repo:edit"]) },
    async (request, reply) => {
      await deps.webhookInboxStore.deleteEntry(request.params.entryId);
      return reply.status(204).send();
    }
  );
};
