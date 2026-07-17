import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HostexecSettings } from "@verft/shared-types";
import { env } from "../config/env.js";
import { buildDockerWorkspaceMountArgs } from "./docker-workspace-mounts.js";
import { normalizeHostCommands } from "./hostexec-config.js";
import {
  discoverHostexecEndpoint,
  HOSTEXEC_SHARED_CONTAINER_NETWORK_DEFAULT_URLS
} from "./hostexec-discovery.js";

export const HOSTEXEC_CONTAINER_BIN_PATH = "/hostexec/bin";
export const HOSTEXEC_PROXY_BIN = "/usr/local/bin/hostexec-proxy.mjs";
export const HOSTEXEC_SHELL_ENV_PATH = `${HOSTEXEC_CONTAINER_BIN_PATH}/.hostexec-shell-env`;
const DEFAULT_RUNTIME_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export interface HostexecRuntimeConfig {
  enabled: boolean;
  commands: string[];
  envEntries: Array<[string, string]>;
  mountArgs: string[];
  dockerArgs: string[];
  message: string | null;
}

function buildHostexecDockerArgs(sharedNetworkWithCurrentContainer: boolean): string[] {
  return sharedNetworkWithCurrentContainer ? [] : ["--add-host", "host.docker.internal:host-gateway"];
}

function buildHostexecShim(command: string): string {
  return `#!/usr/bin/env sh\nexec node ${HOSTEXEC_PROXY_BIN} ${JSON.stringify(command)} "$@"\n`;
}

function buildHostexecShellEnv(): string {
  return [
    `case ":$PATH:" in`,
    `  *":${HOSTEXEC_CONTAINER_BIN_PATH}:"*) ;;`,
    `  *) export PATH="${HOSTEXEC_CONTAINER_BIN_PATH}:$PATH" ;;`,
    "esac",
    ""
  ].join("\n");
}

export async function buildHostexecRuntimeConfig(options: {
  settings: HostexecSettings;
  repositoryCommands: string[];
  payloadDir: string;
  taskId: string;
  repoId: string;
  containerWorkspacePath: string;
  hostWorkspacePath: string;
  sharedNetworkWithCurrentContainer?: boolean;
}): Promise<HostexecRuntimeConfig> {
  const repositoryCommands = normalizeHostCommands(options.repositoryCommands);
  if (repositoryCommands.length === 0) {
    return {
      enabled: false,
      commands: [],
      envEntries: [],
      mountArgs: [],
      dockerArgs: [],
      message: null
    };
  }

  const sharedNetworkWithCurrentContainer = options.sharedNetworkWithCurrentContainer === true;
  const discovery = await discoverHostexecEndpoint(options.settings, {
    defaultUrls: sharedNetworkWithCurrentContainer ? HOSTEXEC_SHARED_CONTAINER_NETWORK_DEFAULT_URLS : undefined
  });
  if (!discovery.endpoint) {
    return {
      enabled: false,
      commands: [],
      envEntries: [],
      mountArgs: [],
      dockerArgs: [],
      message: discovery.message
    };
  }

  const { capabilities } = discovery.endpoint;
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
  await Promise.all([
    writeFile(path.join(shimDir, ".hostexec-shell-env"), buildHostexecShellEnv(), "utf8"),
    ...commands.map(async (command) => {
      const shimPath = path.join(shimDir, command);
      await writeFile(shimPath, buildHostexecShim(command), "utf8");
      await chmod(shimPath, 0o755);
    })
  ]);

  const payloadRelativeShimDir = path.relative(env.RUNTIME_PAYLOAD_ROOT, shimDir);
  return {
    enabled: true,
    commands,
    mountArgs: buildDockerWorkspaceMountArgs({
      sourceRoot: env.RUNTIME_PAYLOAD_VOLUME,
      sourceRelativePath: payloadRelativeShimDir,
      targetPath: HOSTEXEC_CONTAINER_BIN_PATH,
      mode: "ro"
    }),
    dockerArgs: buildHostexecDockerArgs(sharedNetworkWithCurrentContainer),
    envEntries: [
      ["HOSTEXEC_URL", discovery.endpoint.url],
      ...(discovery.endpoint.token ? [["HOSTEXEC_TOKEN", discovery.endpoint.token] as [string, string]] : []),
      ["HOSTEXEC_TASK_ID", options.taskId],
      ["HOSTEXEC_REPO_ID", options.repoId],
      ["HOSTEXEC_WORKSPACE_ROOT", options.containerWorkspacePath],
      ["HOSTEXEC_HOST_WORKSPACE_ROOT", options.hostWorkspacePath],
      ["HOSTEXEC_BIN_PATH", HOSTEXEC_CONTAINER_BIN_PATH],
      ["BASH_ENV", HOSTEXEC_SHELL_ENV_PATH],
      ["PATH", `${HOSTEXEC_CONTAINER_BIN_PATH}:${DEFAULT_RUNTIME_PATH}`]
    ],
    message: `Hostexec mounted ${commands.length} command${commands.length === 1 ? "" : "s"}.`
  };
}
