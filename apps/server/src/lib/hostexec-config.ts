import type { HostexecSettings } from "@agentswarm/shared-types";

export const HOSTEXEC_COMMAND_MAX_COUNT = 80;
export const HOSTEXEC_COMMAND_MAX_LENGTH = 120;
export const HOSTEXEC_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const HOSTEXEC_TOKEN_ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const defaultHostexecSettings: HostexecSettings = {
  enabled: false,
  url: null,
  bearerTokenEnvVar: null
};

export function normalizeHostexecSettings(value: Partial<HostexecSettings> | null | undefined): HostexecSettings {
  const url = typeof value?.url === "string" && value.url.trim().length > 0 ? value.url.trim().replace(/\/+$/, "") : null;
  const bearerTokenEnvVar =
    typeof value?.bearerTokenEnvVar === "string" &&
    HOSTEXEC_TOKEN_ENV_VAR_PATTERN.test(value.bearerTokenEnvVar.trim())
      ? value.bearerTokenEnvVar.trim()
      : null;

  return {
    enabled: value?.enabled === true && Boolean(url),
    url,
    bearerTokenEnvVar
  };
}

export function normalizeHostCommandName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > HOSTEXEC_COMMAND_MAX_LENGTH ||
    !HOSTEXEC_COMMAND_NAME_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeHostCommands(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeHostCommandName(entry);
    const comparable = normalized?.toLowerCase();
    if (!normalized || !comparable || seen.has(comparable)) {
      continue;
    }
    commands.push(normalized);
    seen.add(comparable);
    if (commands.length >= HOSTEXEC_COMMAND_MAX_COUNT) {
      break;
    }
  }
  return commands;
}
