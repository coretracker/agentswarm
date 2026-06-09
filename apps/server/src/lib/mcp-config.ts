import type { McpServerConfig } from "@agentswarm/shared-types";

const tomlString = (value: string): string => JSON.stringify(value);
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const enabledMcpServers = (servers: McpServerConfig[]): McpServerConfig[] => servers.filter((server) => server.enabled);

const validEnvVarName = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || !ENV_VAR_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
};

export function serializeCodexMcpConfig(servers: McpServerConfig[]): string {
  const enabledServers = enabledMcpServers(servers);
  if (enabledServers.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const server of enabledServers) {
    if (server.transport === "http") {
      if (!server.url) {
        continue;
      }
      lines.push(`[mcp_servers.${server.name}]`);
      lines.push(`url = ${tomlString(server.url)}`);
      if (server.bearerTokenEnvVar) {
        lines.push(`bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar)}`);
      }
    } else {
      if (!server.command) {
        continue;
      }
      lines.push(`[mcp_servers.${server.name}]`);
      lines.push(`command = ${tomlString(server.command)}`);
      if ((server.args ?? []).length > 0) {
        lines.push(`args = [${(server.args ?? []).map(tomlString).join(", ")}]`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function serializeClaudeMcpConfig(servers: McpServerConfig[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const server of enabledMcpServers(servers)) {
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
}

export function collectMcpServerEnvEntries(
  servers: McpServerConfig[],
  runtimeEnv: NodeJS.ProcessEnv = process.env
): Array<[string, string]> {
  const envEntries: Array<[string, string]> = [];

  for (const server of enabledMcpServers(servers)) {
    const envVarName = server.bearerTokenEnvVar ? validEnvVarName(server.bearerTokenEnvVar) : null;
    if (!envVarName) {
      continue;
    }

    const value = runtimeEnv[envVarName];
    if (typeof value === "string" && value.length > 0) {
      envEntries.push([envVarName, value]);
    }
  }

  return envEntries;
}

export function collectMissingMcpServerBearerTokenEnvVars(
  servers: McpServerConfig[],
  runtimeEnv: NodeJS.ProcessEnv = process.env
): string[] {
  const missing = new Set<string>();

  for (const server of enabledMcpServers(servers)) {
    const envVarName = server.bearerTokenEnvVar ? validEnvVarName(server.bearerTokenEnvVar) : null;
    if (!envVarName) {
      continue;
    }

    const value = runtimeEnv[envVarName];
    if (typeof value !== "string" || value.length === 0) {
      missing.add(envVarName);
    }
  }

  return [...missing];
}
