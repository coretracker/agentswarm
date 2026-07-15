import type { AgentProvider } from "@verft/shared-types";
import { DEPLOYMENT_ENVIRONMENT_LABEL, env } from "../config/env.js";

export type DockerSocketAccessDeniedReason = "feature_disabled" | "invalid_socket_path";

export interface DockerSocketAccessPolicy {
  enabled: boolean;
  deniedReason: DockerSocketAccessDeniedReason | null;
  appEnvironment: string;
  hostPath: string;
  containerPath: string;
}

interface DockerSocketAccessInput {
  enabled: boolean;
  appEnvironment: string;
  hostPath: string;
  containerPath: string;
}

const normalizeEnvironment = (value: string): string => value.trim().toLowerCase();

export function evaluateDockerSocketAccessPolicy(input: DockerSocketAccessInput): DockerSocketAccessPolicy {
  const appEnvironment = normalizeEnvironment(input.appEnvironment) || "local";
  const hostPath = input.hostPath.trim();
  const containerPath = input.containerPath.trim();

  if (!input.enabled) {
    return {
      enabled: false,
      deniedReason: "feature_disabled",
      appEnvironment,
      hostPath,
      containerPath
    };
  }

  if (!hostPath || !containerPath) {
    return {
      enabled: false,
      deniedReason: "invalid_socket_path",
      appEnvironment,
      hostPath,
      containerPath
    };
  }

  return {
    enabled: true,
    deniedReason: null,
    appEnvironment,
    hostPath,
    containerPath
  };
}

export function resolveDockerSocketAccessPolicy(provider: AgentProvider): DockerSocketAccessPolicy {
  const containerPath =
    provider === "claude" ? env.DOCKER_SOCKET_CONTAINER_PATH_CLAUDE : env.DOCKER_SOCKET_CONTAINER_PATH_CODEX;
  return evaluateDockerSocketAccessPolicy({
    enabled: env.DOCKER_SOCKET_ACCESS_ENABLED,
    appEnvironment: DEPLOYMENT_ENVIRONMENT_LABEL,
    hostPath: env.DOCKER_SOCKET_HOST_PATH,
    containerPath
  });
}

export function resolveDockerSocketMountArgs(policy: DockerSocketAccessPolicy): string[] {
  return policy.enabled ? ["-v", `${policy.hostPath}:${policy.containerPath}:rw`] : [];
}

export function resolveDockerSocketEnvEntries(policy: DockerSocketAccessPolicy): Array<[string, string]> {
  return policy.enabled ? [["DOCKER_HOST", `unix://${policy.containerPath}`]] : [];
}

export function resolveDockerSocketRunArgs(policy: DockerSocketAccessPolicy): string[] {
  return [
    ...resolveDockerSocketMountArgs(policy),
    ...resolveDockerSocketEnvEntries(policy).flatMap(([name, value]) => ["-e", `${name}=${value}`])
  ];
}
