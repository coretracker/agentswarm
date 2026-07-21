import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "../config/env.js";

export const VERFT_BASE_CONTAINER_ROOT = "/verft-base";

type MountMode = "ro" | "rw";

export type VerftBaseStateSource =
  | { type: "volume"; name: string }
  | {
      type: "host";
      root: string;
      volume: string;
      codexPath: string | null;
      claudePath: string | null;
      claudeConfigPath: string | null;
    };

function trimPath(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function evaluateVerftBaseStateSource(input: {
  volume: string;
  hostRoot?: string;
  codexHostPath?: string;
  claudeHostPath?: string;
  claudeConfigHostPath?: string;
  pathExists?: (candidate: string) => boolean;
}): VerftBaseStateSource {
  const hostRoot = trimPath(input.hostRoot);
  const codexPath = trimPath(input.codexHostPath) ?? (hostRoot ? path.join(hostRoot, ".codex") : null);
  const claudePath = trimPath(input.claudeHostPath) ?? (hostRoot ? path.join(hostRoot, ".claude") : null);
  const configuredClaudeConfigPath = trimPath(input.claudeConfigHostPath);
  const inferredClaudeConfigPath =
    configuredClaudeConfigPath ?? (claudePath ? path.join(path.dirname(claudePath), ".claude.json") : null);
  const pathExists = input.pathExists ?? (() => false);
  const claudeConfigPath =
    inferredClaudeConfigPath && pathExists(inferredClaudeConfigPath) ? inferredClaudeConfigPath : null;

  if (codexPath || claudePath || claudeConfigPath) {
    return {
      type: "host",
      root: hostRoot ?? "",
      volume: input.volume,
      codexPath,
      claudePath,
      claudeConfigPath
    };
  }

  return { type: "volume", name: input.volume };
}

export function resolveVerftBaseStateSource(): VerftBaseStateSource {
  return evaluateVerftBaseStateSource({
    volume: env.VERFT_BASE_VOLUME,
    hostRoot: env.VERFT_AI_STATE_HOST_ROOT,
    codexHostPath: env.VERFT_CODEX_STATE_HOST_PATH,
    claudeHostPath: env.VERFT_CLAUDE_STATE_HOST_PATH,
    claudeConfigHostPath: env.VERFT_CLAUDE_CONFIG_HOST_PATH,
    pathExists: existsSync
  });
}

export function buildVerftBaseMountArgsForSource(source: VerftBaseStateSource, mode: MountMode = "ro"): string[] {
  if (source.type === "volume") {
    return ["-v", `${source.name}:${VERFT_BASE_CONTAINER_ROOT}:${mode}`];
  }

  return [
    "-v",
    `${source.volume}:${VERFT_BASE_CONTAINER_ROOT}:${mode}`,
    ...(source.codexPath ? ["-v", `${source.codexPath}:${VERFT_BASE_CONTAINER_ROOT}/codex:${mode}`] : []),
    ...(source.claudePath ? ["-v", `${source.claudePath}:${VERFT_BASE_CONTAINER_ROOT}/claude:${mode}`] : []),
    ...(source.claudeConfigPath
      ? ["-v", `${source.claudeConfigPath}:${VERFT_BASE_CONTAINER_ROOT}/claude/.claude.json:${mode}`]
      : [])
  ];
}

export function buildVerftBaseVolumeMountArgs(mode: MountMode = "ro"): string[] {
  return buildVerftBaseMountArgsForSource(resolveVerftBaseStateSource(), mode);
}

export function buildVerftBaseEnvArgs(): string[] {
  const source = resolveVerftBaseStateSource();
  return [
    "-e",
    `VERFT_BASE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`,
    "-e",
    `VERFT_AI_STATE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`,
    "-e",
    `VERFT_BASE_SOURCE=${source.type === "host" ? "host" : "volume"}`
  ];
}
