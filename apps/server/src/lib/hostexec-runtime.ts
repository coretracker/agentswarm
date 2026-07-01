import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HostexecSettings } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { buildDockerWorkspaceMountArgs } from "./docker-workspace-mounts.js";
import { normalizeHostCommands, normalizeHostexecSettings } from "./hostexec-config.js";

export const HOSTEXEC_CONTAINER_BIN_PATH = "/hostexec/bin";
export const HOSTEXEC_PROXY_BIN = "/usr/local/bin/hostexec-proxy.mjs";
const HOSTEXEC_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export interface HostexecRuntimeConfig {
  enabled: boolean;
  commands: string[];
  envEntries: Array<[string, string]>;
  mountArgs: string[];
  dockerArgs: string[];
  message: string | null;
}

interface HostexecCapabilities {
  allowAll: boolean;
  commands: string[];
}

function parseHostexecCapabilities(raw: string): HostexecCapabilities {
  if (!raw.trim()) {
    return { allowAll: false, commands: [] };
  }
  const parsed = JSON.parse(raw) as unknown;
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    allowAll: record.allowAll === true,
    commands: normalizeHostCommands(record.commands)
  };
}

async function fetchHostexecCapabilities(settings: HostexecSettings): Promise<HostexecCapabilities> {
  const token =
    settings.bearerTokenEnvVar && process.env[settings.bearerTokenEnvVar]
      ? process.env[settings.bearerTokenEnvVar]
      : null;
  if (settings.bearerTokenEnvVar && !token) {
    throw new Error(`Hostexec token env var is not set: ${settings.bearerTokenEnvVar}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOSTEXEC_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${settings.url}/capabilities`, {
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

function buildHostexecDockerArgs(): string[] {
  return ["--add-host", "host.docker.internal:host-gateway"];
}

function buildHostexecShim(command: string): string {
  return `#!/usr/bin/env sh\nexec node ${HOSTEXEC_PROXY_BIN} ${JSON.stringify(command)} "$@"\n`;
}

export async function buildHostexecRuntimeConfig(options: {
  settings: HostexecSettings;
  repositoryCommands: string[];
  payloadDir: string;
  taskId: string;
  repoId: string;
  containerWorkspacePath: string;
  hostWorkspacePath: string;
}): Promise<HostexecRuntimeConfig> {
  const settings = normalizeHostexecSettings(options.settings);
  const repositoryCommands = normalizeHostCommands(options.repositoryCommands);
  if (!settings.enabled || !settings.url || repositoryCommands.length === 0) {
    return {
      enabled: false,
      commands: [],
      envEntries: [],
      mountArgs: [],
      dockerArgs: [],
      message: null
    };
  }

  const capabilities = await fetchHostexecCapabilities(settings);
  const daemonCommandsByName = new Map(capabilities.commands.map((command) => [command.toLowerCase(), command]));
  const commands = capabilities.allowAll
    ? repositoryCommands
    : repositoryCommands.filter((command) => daemonCommandsByName.has(command.toLowerCase()));
  if (commands.length === 0) {
    return {
      enabled: false,
      commands: [],
      envEntries: [],
      mountArgs: [],
      dockerArgs: [],
      message: "Hostexec is enabled, but none of this repository's host commands are allowed by the daemon."
    };
  }

  const shimDir = path.join(options.payloadDir, "hostexec-bin");
  await mkdir(shimDir, { recursive: true });
  await Promise.all(
    commands.map(async (command) => {
      const shimPath = path.join(shimDir, command);
      await writeFile(shimPath, buildHostexecShim(command), "utf8");
      await chmod(shimPath, 0o755);
    })
  );

  const payloadRelativeShimDir = path.relative(env.RUNTIME_PAYLOAD_ROOT, shimDir);
  const token =
    settings.bearerTokenEnvVar && process.env[settings.bearerTokenEnvVar]
      ? process.env[settings.bearerTokenEnvVar]
      : "";
  return {
    enabled: true,
    commands,
    mountArgs: buildDockerWorkspaceMountArgs({
      sourceRoot: env.RUNTIME_PAYLOAD_VOLUME,
      sourceRelativePath: payloadRelativeShimDir,
      targetPath: HOSTEXEC_CONTAINER_BIN_PATH,
      mode: "ro"
    }),
    dockerArgs: buildHostexecDockerArgs(),
    envEntries: [
      ["HOSTEXEC_URL", settings.url],
      ...(token ? [["HOSTEXEC_TOKEN", token] as [string, string]] : []),
      ["HOSTEXEC_TASK_ID", options.taskId],
      ["HOSTEXEC_REPO_ID", options.repoId],
      ["HOSTEXEC_WORKSPACE_ROOT", options.containerWorkspacePath],
      ["HOSTEXEC_HOST_WORKSPACE_ROOT", options.hostWorkspacePath],
      ["HOSTEXEC_BIN_PATH", HOSTEXEC_CONTAINER_BIN_PATH],
      ["PATH", `${HOSTEXEC_CONTAINER_BIN_PATH}:${DEFAULT_RUNTIME_PATH}`]
    ],
    message: `Hostexec mounted ${commands.length} command${commands.length === 1 ? "" : "s"}.`
  };
}
