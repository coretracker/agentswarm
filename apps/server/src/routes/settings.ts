import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AgentProvider, HostexecAvailability, HostexecSettings } from "@verft/shared-types";
import { CODEX_MODELS, CLAUDE_MODELS } from "@verft/shared-types";
import type { AuthService } from "../lib/auth.js";
import { discoverHostexecEndpoint } from "../lib/hostexec-discovery.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";

interface ProviderModelEntry {
  label: string;
  value: string;
}

const normalizeMcpServerNameForComparison = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

function providerModelsUrl(baseUrl: string | null, defaultBaseUrl: string): string {
  const base = (baseUrl?.replace(/\/$/, "") ?? defaultBaseUrl);
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/models`;
}

async function fetchOpenAiModels(apiKey: string, baseUrl: string | null): Promise<ProviderModelEntry[]> {
  const response = await fetch(providerModelsUrl(baseUrl, "https://api.openai.com"), {
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

async function fetchAnthropicModels(apiKey: string, baseUrl: string | null): Promise<ProviderModelEntry[]> {
  const response = await fetch(providerModelsUrl(baseUrl, "https://api.anthropic.com"), {
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

const providerProfileEnum = z.enum(["low", "medium", "high", "max"]);
const providerModelSchema = z.object({
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(160)
});
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
    bearerTokenEnvVar: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Bearer token env var must be a valid environment variable name")
      .nullable()
      .optional(),
    bearerToken: z.string().trim().min(1).max(4096).optional(),
    clearBearerToken: z.boolean().optional()
  })
]);
const mcpServersSchema = z
  .array(mcpServerSchema)
  .max(25)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const normalized = normalizeMcpServerNameForComparison(entries[index]?.name ?? "");
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "name"],
          message: `Duplicate MCP server name: ${entries[index]?.name}`
        });
      } else {
        seen.add(normalized);
      }
    }
  });
const hostexecSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    url: z.string().trim().url().nullable().optional(),
    bearerTokenEnvVar: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Bearer token env var must be a valid environment variable name")
      .nullable()
      .optional()
  })
  .nullable()
  .optional();

const updateSettingsSchema = z.object({
  defaultProvider: z.enum(["codex", "claude"]).optional(),
  defaultAutoApplyCheckpoints: z.boolean().optional(),
  maxAgents: z.coerce.number().int().min(1).max(20).optional(),
  archivedTaskAutoDeleteEnabled: z.boolean().optional(),
  archivedTaskAutoDeleteDays: z.coerce.number().int().min(1).max(3650).optional(),
  branchPrefix: z.string().trim().min(1).max(80).optional(),
  workspaceProvisioningMode: z.enum(["clone_only", "hybrid"]).optional(),
  gitUsername: z.string().trim().min(1).max(120).optional(),
  gitAuthorName: z.string().trim().min(1).max(120).nullable().optional(),
  gitAuthorEmail: z.string().trim().email().nullable().optional(),
  hostexec: hostexecSettingsSchema,
  openaiBaseUrl: z.string().trim().url().nullable().optional(),
  anthropicBaseUrl: z.string().trim().url().nullable().optional(),
  harnessWhatExists: z.string().trim().max(8000).nullable().optional(),
  harnessAllowedActions: z.string().trim().max(8000).nullable().optional(),
  harnessNotAllowedActions: z.string().trim().max(8000).nullable().optional(),
  harnessHowToWork: z.string().trim().max(8000).nullable().optional(),
  harnessDefinitionOfDone: z.string().trim().max(8000).nullable().optional(),
  harnessEvidenceExpectations: z.string().trim().max(8000).nullable().optional(),
  codexDefaultModel: z.string().trim().min(1).max(120).optional(),
  codexModels: z.array(providerModelSchema).max(500).optional(),
  codexDefaultEffort: providerProfileEnum.optional(),
  claudeDefaultModel: z.string().trim().min(1).max(120).optional(),
  claudeModels: z.array(providerModelSchema).max(500).optional(),
  claudeDefaultEffort: providerProfileEnum.optional()
});

const updateCredentialsSchema = z.object({
  githubToken: z.string().trim().min(1).optional(),
  openaiApiKey: z.string().trim().min(1).optional(),
  anthropicApiKey: z.string().trim().min(1).optional(),
  slackSigningSecret: z.string().trim().min(1).optional(),
  slackBotToken: z.string().trim().min(1).optional(),
  clearGithubToken: z.boolean().optional(),
  clearOpenAiApiKey: z.boolean().optional(),
  clearAnthropicApiKey: z.boolean().optional(),
  clearSlackSigningSecret: z.boolean().optional(),
  clearSlackBotToken: z.boolean().optional()
});

async function checkHostexecAvailability(settings: HostexecSettings): Promise<HostexecAvailability> {
  const discovery = await discoverHostexecEndpoint(settings);
  const endpoint = discovery.endpoint;
  if (!endpoint) {
    return {
      available: false,
      enabled: discovery.enabled,
      url: discovery.configuredUrl,
      detected: false,
      allowAll: false,
      commands: [],
      message: discovery.message
    };
  }

  const { allowAll, commands } = endpoint.capabilities;
  return {
    available: true,
    enabled: discovery.enabled,
    url: endpoint.url,
    detected: endpoint.detected,
    allowAll,
    commands,
    message: allowAll
      ? "Hostexec daemon detected and allows repository Host Commands."
      : commands.length > 0
        ? `Hostexec daemon detected with ${commands.length} daemon command(s).`
        : "Hostexec daemon detected."
  };
}

export const registerSettingsRoutes = (
  app: FastifyInstance,
  deps: {
    settingsStore: SettingsStore;
    scheduler: SchedulerService;
    auth: AuthService;
  }
): void => {
  app.get("/settings", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async () => deps.settingsStore.getSettings());

  app.get("/settings/hostexec/check", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async () => {
    const settings = await deps.settingsStore.getSettings();
    return checkHostexecAvailability(settings.hostexec);
  });

  app.get("/settings/models", { preHandler: deps.auth.requireAllScopes(["settings:read"]) }, async (request, reply) => {
    const providerParam = (request.query as Record<string, string>).provider as AgentProvider | undefined;
    const provider = providerParam === "claude" ? "claude" : "codex";
    const refresh = (request.query as Record<string, string | undefined>).refresh === "1";

    const settings = await deps.settingsStore.getSettings();
    const configured = provider === "claude" ? settings.claudeModels : settings.codexModels;
    const fallback = provider === "claude" ? [...CLAUDE_MODELS] : [...CODEX_MODELS];

    if (!refresh) {
      return reply.send({ models: configured.length > 0 ? configured : fallback, source: configured.length > 0 ? "cache" : "fallback" });
    }

    const credentials = await deps.settingsStore.getRuntimeCredentials();

    try {
      if (provider === "claude") {
        if (!credentials.anthropicApiKey) {
          return reply.send({ models: configured.length > 0 ? configured : fallback, source: configured.length > 0 ? "cache" : "fallback" });
        }
        const models = await fetchAnthropicModels(credentials.anthropicApiKey, settings.anthropicBaseUrl);
        return reply.send({ models, source: "api" });
      }

      if (!credentials.openaiApiKey) {
        return reply.send({ models: configured.length > 0 ? configured : fallback, source: configured.length > 0 ? "cache" : "fallback" });
      }
      const models = await fetchOpenAiModels(credentials.openaiApiKey, settings.openaiBaseUrl);
      return reply.send({ models, source: "api" });
    } catch {
      return reply.send({ models: configured.length > 0 ? configured : fallback, source: configured.length > 0 ? "cache" : "fallback" });
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
