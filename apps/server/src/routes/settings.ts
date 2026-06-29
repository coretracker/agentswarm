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
const responsePreferenceSchema = z
  .object({
    audience: z.enum(["technical", "non_technical", "mixed"]).optional(),
    explanationDepth: z.enum(["one_line", "brief", "standard", "detailed", "deep_dive"]).optional(),
    jargonLevel: z.enum(["avoid", "balanced", "expert"]).optional(),
    codePreference: z.enum(["only_when_needed", "prefer_examples", "avoid_code"]).optional(),
    clarifyBehavior: z.enum(["ask_when_ambiguous", "make_reasonable_assumptions"]).optional(),
    formattingStyle: z.enum(["direct", "teaching", "executive", "step_by_step", "checklist", "qa", "problem_solution"]).optional(),
    extraInstructions: z.string().trim().max(2000).optional()
  });
const responsePreferencePresetSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  preference: responsePreferenceSchema
});

const updateSettingsSchema = z.object({
  defaultProvider: z.enum(["codex", "claude"]).optional(),
  maxAgents: z.coerce.number().int().min(1).max(20).optional(),
  branchPrefix: z.string().trim().min(1).max(80).optional(),
  workspaceProvisioningMode: z.enum(["clone_only", "hybrid"]).optional(),
  gitUsername: z.string().trim().min(1).max(120).optional(),
  gitAuthorName: z.string().trim().min(1).max(120).nullable().optional(),
  gitAuthorEmail: z.string().trim().email().nullable().optional(),
  openaiBaseUrl: z.string().trim().url().nullable().optional(),
  anthropicBaseUrl: z.string().trim().url().nullable().optional(),
  taskPromptMagicModel: z.string().trim().min(1).max(120).optional(),
  taskPromptMagicTemplate: z.string().trim().min(1).max(12_000).optional(),
  codexDefaultModel: z.string().trim().min(1).max(120).optional(),
  codexModels: z.array(providerModelSchema).max(500).optional(),
  codexDefaultEffort: providerProfileEnum.optional(),
  claudeDefaultModel: z.string().trim().min(1).max(120).optional(),
  claudeModels: z.array(providerModelSchema).max(500).optional(),
  claudeDefaultEffort: providerProfileEnum.optional(),
  responsePreferencePresets: z.array(responsePreferencePresetSchema).max(50).optional()
});

const updateCredentialsSchema = z.object({
  githubToken: z.string().trim().min(1).optional(),
  openaiApiKey: z.string().trim().min(1).optional(),
  codexAuthJson: z.string().trim().min(1).optional(),
  anthropicApiKey: z.string().trim().min(1).optional(),
  clearGithubToken: z.boolean().optional(),
  clearOpenAiApiKey: z.boolean().optional(),
  clearCodexAuthJson: z.boolean().optional(),
  clearAnthropicApiKey: z.boolean().optional()
});

const updateUserNotesSchema = z.object({
  notes: z.string().max(200_000)
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

    if (parsed.data.codexAuthJson !== undefined && !parsed.data.clearCodexAuthJson) {
      try {
        const parsedJson = JSON.parse(parsed.data.codexAuthJson) as unknown;
        if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
          return reply.status(400).send({ message: "Codex auth.json must be a JSON object" });
        }
      } catch {
        return reply.status(400).send({ message: "Codex auth.json must be valid JSON" });
      }
    }

    const settings = await deps.settingsStore.updateCredentials(parsed.data);
    return reply.send(settings);
  });

  app.get("/settings/notes", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request) =>
    deps.settingsStore.getUserNotes(request.auth!.user.id)
  );

  app.patch("/settings/notes", { preHandler: deps.auth.requireAllScopes(["task:edit"]) }, async (request, reply) => {
    const parsed = updateUserNotesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const next = await deps.settingsStore.updateUserNotes(request.auth!.user.id, parsed.data.notes);
    return reply.send(next);
  });
};
