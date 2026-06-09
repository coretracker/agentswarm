import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProvider, McpServerConfig, ProviderProfile } from "@agentswarm/shared-types";
import {
  claudeModelSupportsThinkingBudget,
  claudeThinkingBudgetTokensForProfile,
  codexReasoningEffortForProfile,
  defaultModelForProvider
} from "../lib/provider-config.js";
import { serializeClaudeMcpConfig, serializeCodexMcpConfig } from "../lib/mcp-config.js";
import type { RuntimeCredentials } from "../services/credential-store.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

export interface ProviderRuntimeDefinition {
  provider: AgentProvider;
  image: string;
  context: string;
  configFileName: string;
  getMissingCredentialMessage(credentials: RuntimeCredentials): string | null;
  getRuntimeEnv(credentials: RuntimeCredentials & { openaiBaseUrl: string | null }): Record<string, string | undefined>;
  getProviderConfig(servers: McpServerConfig[]): string;
  getResolvedModel(modelOverride: string | null, profile: ProviderProfile): string | null;
  getResolvedProfileSettings(
    profile: ProviderProfile,
    resolvedModel: string | null
  ): { reasoningEffort?: string; thinkingBudgetTokens?: number | undefined };
}

export const providerRuntimeDefinitions: Record<AgentProvider, ProviderRuntimeDefinition> = {
  codex: {
    provider: "codex",
    image: "agentswarm-agent-runtime-codex:latest",
    context: path.join(repoRoot, "agent-runtime-codex"),
    configFileName: "codex-config.toml",
    getMissingCredentialMessage: (credentials) =>
      credentials.openaiApiKey || credentials.codexAuthJson ? null : "OpenAI API key or Codex auth.json is not configured.",
    getRuntimeEnv: (credentials) => ({
      OPENAI_API_KEY: credentials.openaiApiKey ?? undefined,
      CODEX_AUTH_JSON_B64: credentials.codexAuthJson
        ? Buffer.from(credentials.codexAuthJson, "utf8").toString("base64")
        : undefined,
      OPENAI_BASE_URL: credentials.openaiBaseUrl ?? undefined
    }),
    getProviderConfig: serializeCodexMcpConfig,
    getResolvedModel: (modelOverride, profile) => modelOverride ?? defaultModelForProvider("codex", profile),
    getResolvedProfileSettings: (profile) => ({
      reasoningEffort: codexReasoningEffortForProfile(profile)
    })
  },
  claude: {
    provider: "claude",
    image: "agentswarm-agent-runtime-claude:latest",
    context: path.join(repoRoot, "agent-runtime-claude"),
    configFileName: "claude-mcp.json",
    getMissingCredentialMessage: (credentials) =>
      credentials.anthropicApiKey ? null : "Anthropic API key is not configured in Settings.",
    getRuntimeEnv: (credentials) => ({
      ANTHROPIC_API_KEY: credentials.anthropicApiKey ?? undefined
    }),
    getProviderConfig: serializeClaudeMcpConfig,
    getResolvedModel: (modelOverride, profile) => modelOverride ?? defaultModelForProvider("claude", profile),
    getResolvedProfileSettings: (profile, resolvedModel) => ({
      thinkingBudgetTokens: claudeModelSupportsThinkingBudget(resolvedModel)
        ? claudeThinkingBudgetTokensForProfile(profile)
        : undefined
    })
  }
};

export const getProviderRuntimeDefinition = (provider: AgentProvider): ProviderRuntimeDefinition =>
  providerRuntimeDefinitions[provider];
