import path from "node:path";

import { env } from "../config/env.js";

const AGENT_HOME = "/home/agent";

function trimPath(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function mountReadOnly(source: string, target: string): string[] {
  return ["--mount", `type=bind,src=${source},dst=${target},readonly`];
}

export function resolveHostProviderStatePaths(input: {
  hostRoot?: string | null;
  codexHostPath?: string | null;
  claudeHostPath?: string | null;
  claudeConfigHostPath?: string | null;
}): { codexPath: string | null; claudePath: string | null; claudeConfigPath: string | null } {
  const hostRoot = trimPath(input.hostRoot);
  const codexPath = trimPath(input.codexHostPath) ?? (hostRoot ? path.join(hostRoot, ".codex") : null);
  const claudePath = trimPath(input.claudeHostPath) ?? (hostRoot ? path.join(hostRoot, ".claude") : null);
  const claudeConfigPath =
    trimPath(input.claudeConfigHostPath) ?? (hostRoot ? path.join(hostRoot, ".claude.json") : null);

  return { codexPath, claudePath, claudeConfigPath };
}

export function buildHostProviderStateMountArgsForPaths(input: {
  codexPath: string | null;
  claudePath: string | null;
  claudeConfigPath: string | null;
}): string[] {
  return [
    ...(input.codexPath ? mountReadOnly(input.codexPath, path.join(AGENT_HOME, ".codex")) : []),
    ...(input.claudePath ? mountReadOnly(input.claudePath, path.join(AGENT_HOME, ".claude")) : []),
    ...(input.claudeConfigPath ? mountReadOnly(input.claudeConfigPath, path.join(AGENT_HOME, ".claude.json")) : [])
  ];
}

export function buildHostProviderStateMountArgs(): string[] {
  return buildHostProviderStateMountArgsForPaths(
    resolveHostProviderStatePaths({
      hostRoot: env.VERFT_AI_STATE_HOST_ROOT,
      codexHostPath: env.VERFT_CODEX_STATE_HOST_PATH,
      claudeHostPath: env.VERFT_CLAUDE_STATE_HOST_PATH,
      claudeConfigHostPath: env.VERFT_CLAUDE_CONFIG_HOST_PATH
    })
  );
}
