import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProvider, McpServerConfig, ProviderProfile } from "@agentswarm/shared-types";
import {
  claudeMaxTurnsForProfile,
  codexReasoningEffortForProfile,
  defaultModelForProvider
} from "../lib/provider-config.js";
import type { RuntimeCredentials } from "../services/credential-store.js";

const tomlString = (value: string): string => JSON.stringify(value);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

const serializeCodexMcpConfig = (servers: McpServerConfig[]): string => {
  const enabledServers = servers.filter((server) => server.enabled);
  if (enabledServers.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const server of enabledServers) {
    lines.push(`[mcp_servers.${server.name}]`);
    if (server.transport === "http") {
      if (!server.url) {
        continue;
      }
      lines.push(`url = ${tomlString(server.url)}`);
      if (server.bearerTokenEnvVar) {
        lines.push(`bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar)}`);
      }
    } else {
      if (!server.command) {
        continue;
      }
      lines.push(`command = ${tomlString(server.command)}`);
      if ((server.args ?? []).length > 0) {
        lines.push(`args = [${(server.args ?? []).map(tomlString).join(", ")}]`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

const serializeClaudeMcpConfig = (servers: McpServerConfig[]): string => {
  const enabledServers = servers.filter((server) => server.enabled);
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const server of enabledServers) {
    if (server.transport === "http") {
      if (!server.url) {
        continue;
      }

      mcpServers[server.name] = {
        type: "http",
        url: server.url,
        ...(server.bearerTokenEnvVar
          ? {
              headers: {
                Authorization: `Bearer \${${server.bearerTokenEnvVar}}`
              }
            }
          : {})
      };
      continue;
    }

    if (!server.command) {
      continue;
    }

    mcpServers[server.name] = {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      env: {}
    };
  }

  return JSON.stringify({ mcpServers }, null, 2);
};

export interface ProviderRuntimeDefinition {
  provider: AgentProvider;
  image: string;
  context: string;
  configFileName: string;
  getMissingCredentialMessage(credentials: RuntimeCredentials): string | null;
  getRuntimeEnv(credentials: RuntimeCredentials & { openaiBaseUrl: string | null }): Record<string, string | undefined>;
  getProviderConfig(servers: McpServerConfig[]): string;
  getResolvedModel(modelOverride: string | null, profile: ProviderProfile): string | null;
  getResolvedProfileSettings(profile: ProviderProfile): { reasoningEffort?: string; maxTurns?: number };
}

export const providerRuntimeDefinitions: Record<AgentProvider, ProviderRuntimeDefinition> = {
  codex: {
    provider: "codex",
    image: "agentswarm-agent-runtime-codex:latest",
    context: path.join(repoRoot, "agent-runtime-codex"),
    configFileName: "codex-config.toml",
    getMissingCredentialMessage: (credentials) =>
      credentials.openaiApiKey ? null : "OpenAI API key is not configured in Settings.",
    getRuntimeEnv: (credentials) => ({
      OPENAI_API_KEY: credentials.openaiApiKey ?? undefined,
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
    getResolvedProfileSettings: (profile) => ({
      maxTurns: claudeMaxTurnsForProfile(profile)
    })
  }
};

export const getProviderRuntimeDefinition = (provider: AgentProvider): ProviderRuntimeDefinition =>
  providerRuntimeDefinitions[provider];
