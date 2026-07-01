import type { HostexecSettings } from "@agentswarm/shared-types";
import {
  normalizeHostexecCapabilities,
  normalizeHostexecSettings,
  type HostexecCapabilities
} from "./hostexec-config.js";

export const HOSTEXEC_DEFAULT_URLS = [
  "http://host.docker.internal:38128",
  "http://127.0.0.1:38128",
  "http://localhost:38128"
] as const;

const DEFAULT_HOSTEXEC_DISCOVERY_TIMEOUT_MS = 1_500;

export interface HostexecEndpoint {
  url: string;
  token: string | null;
  capabilities: HostexecCapabilities;
  detected: boolean;
}

export interface HostexecDiscoveryResult {
  endpoint: HostexecEndpoint | null;
  enabled: boolean;
  configuredUrl: string | null;
  message: string;
}

function parseHostexecCapabilities(raw: string): HostexecCapabilities {
  if (!raw.trim()) {
    return { allowAll: false, commands: [] };
  }
  return normalizeHostexecCapabilities(JSON.parse(raw) as unknown);
}

function buildCandidateUrls(configuredUrl: string | null): string[] {
  const urls = configuredUrl ? [configuredUrl, ...HOSTEXEC_DEFAULT_URLS] : [...HOSTEXEC_DEFAULT_URLS];
  const seen = new Set<string>();
  return urls.filter((url) => {
    const comparable = url.toLowerCase();
    if (seen.has(comparable)) {
      return false;
    }
    seen.add(comparable);
    return true;
  });
}

async function fetchHostexecCapabilities(url: string, token: string | null, timeoutMs: number): Promise<HostexecCapabilities> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/capabilities`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Hostexec returned HTTP ${response.status}`);
    }
    return parseHostexecCapabilities(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverHostexecEndpoint(
  settings: HostexecSettings,
  options: { timeoutMs?: number } = {}
): Promise<HostexecDiscoveryResult> {
  const normalized = normalizeHostexecSettings(settings);
  const token = normalized.bearerTokenEnvVar
    ? process.env[normalized.bearerTokenEnvVar]?.trim() || null
    : null;
  if (normalized.bearerTokenEnvVar && !token) {
    return {
      endpoint: null,
      enabled: normalized.enabled,
      configuredUrl: normalized.url,
      message: `Hostexec token env var is not set: ${normalized.bearerTokenEnvVar}`
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_HOSTEXEC_DISCOVERY_TIMEOUT_MS;
  let lastError: Error | null = null;
  for (const url of buildCandidateUrls(normalized.url)) {
    try {
      return {
        endpoint: {
          url,
          token,
          capabilities: await fetchHostexecCapabilities(url, token, timeoutMs),
          detected: url !== normalized.url
        },
        enabled: normalized.enabled,
        configuredUrl: normalized.url,
        message: "Hostexec daemon detected."
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Hostexec availability check failed.");
    }
  }

  return {
    endpoint: null,
    enabled: normalized.enabled,
    configuredUrl: normalized.url,
    message: lastError?.message ?? "Hostexec daemon not detected. Run npm run hostexec on the host."
  };
}
