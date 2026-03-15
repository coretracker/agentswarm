import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AgentProvider } from "@agentswarm/shared-types";
import { CODEX_MODELS, CLAUDE_MODELS } from "@agentswarm/shared-types";
import type { AuthService } from "../lib/auth.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";

interface ProviderModelEntry {
  label: string;
  value: string;
}

async function fetchOpenAiModels(apiKey: string, baseUrl: string | null): Promise<ProviderModelEntry[]> {
  const base = (baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com") + "/v1";
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!response.ok) {
    throw new Error(`OpenAI models API returned ${response.status}`);
  }

  const data = await response.json() as { data: Array<{ id: string }> };
  return data.data
    .map((m) => ({ label: m.id, value: m.id }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

async function fetchAnthropicModels(apiKey: string): Promise<ProviderModelEntry[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });

  if (!response.ok) {
    throw new Error(`Anthropic models API returned ${response.status}`);
  }

  const data = await response.json() as { data: Array<{ id: string; display_name: string }> };
  return data.data
    .map((m) => ({ label: m.display_name || m.id, value: m.id }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

const mcpServerSchema = z.discriminatedUnion("transport", [
  z.object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    transport: z.literal("stdio"),
    command: z.string().trim().min(1).max(300),
    args: z.array(z.string().trim().min(1).max(300)).max(40).optional()
  }),
  z.object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    transport: z.literal("http"),
    url: z.string().trim().url(),
    bearerTokenEnvVar: z.string().trim().min(1).max(120).nullable().optional()
  })
]);

const providerProfileEnum = z.enum(["quick", "balanced", "deep", "super_deep", "unlimited"]);

const updateSettingsSchema = z.object({
  defaultProvider: z.enum(["codex", "claude"]).optional(),
  maxAgents: z.coerce.number().int().min(1).max(20).optional(),
  branchPrefix: z.string().trim().min(1).max(80).optional(),
  gitUsername: z.string().trim().min(1).max(120).optional(),
  agentRules: z.string().max(12000).optional(),
  mcpServers: z.array(mcpServerSchema).max(25).optional(),
  openaiBaseUrl: z.string().trim().url().nullable().optional(),
  codexDefaultModel: z.string().trim().min(1).max(120).optional(),
  codexDefaultEffort: providerProfileEnum.optional(),
  claudeDefaultModel: z.string().trim().min(1).max(120).optional(),
  claudeDefaultEffort: providerProfileEnum.optional()
});

const updateCredentialsSchema = z.object({
  githubToken: z.string().trim().min(1).optional(),
  openaiApiKey: z.string().trim().min(1).optional(),
  anthropicApiKey: z.string().trim().min(1).optional(),
  clearGithubToken: z.boolean().optional(),
  clearOpenAiApiKey: z.boolean().optional(),
  clearAnthropicApiKey: z.boolean().optional()
});

export const registerSettingsRoutes = (
  app: FastifyInstance,
  deps: {
    settingsStore: SettingsStore;
    scheduler: SchedulerService;
    auth: AuthService;
  }
): void => {
  app.get("/settings", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async () => deps.settingsStore.getSettings());

  app.get("/settings/models", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async (request, reply) => {
    const providerParam = (request.query as Record<string, string>).provider as AgentProvider | undefined;
    const provider = providerParam === "claude" ? "claude" : "codex";

    const credentials = await deps.settingsStore.getRuntimeCredentials();
    const settings = await deps.settingsStore.getSettings();
    const fallback = provider === "claude" ? [...CLAUDE_MODELS] : [...CODEX_MODELS];

    try {
      if (provider === "claude") {
        if (!credentials.anthropicApiKey) {
          return reply.send({ models: fallback, source: "static" });
        }
        const models = await fetchAnthropicModels(credentials.anthropicApiKey);
        return reply.send({ models, source: "api" });
      }

      if (!credentials.openaiApiKey) {
        return reply.send({ models: fallback, source: "static" });
      }
      const models = await fetchOpenAiModels(credentials.openaiApiKey, settings.openaiBaseUrl);
      return reply.send({ models, source: "api" });
    } catch {
      return reply.send({ models: fallback, source: "static" });
    }
  });

  app.patch("/settings", { preHandler: deps.auth.requireAllScopes(["settings:edit"]) }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const settings = await deps.settingsStore.updateSettings(parsed.data);
    await deps.scheduler.onSettingsChanged();
    return reply.send(settings);
  });

  app.patch("/settings/credentials", { preHandler: deps.auth.requireAllScopes(["settings:edit"]) }, async (request, reply) => {
    const parsed = updateCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const settings = await deps.settingsStore.updateCredentials(parsed.data);
    return reply.send(settings);
  });
};
