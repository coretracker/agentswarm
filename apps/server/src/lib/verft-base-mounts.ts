import path from "node:path";
import { env } from "../config/env.js";

export const VERFT_BASE_CONTAINER_ROOT = "/verft-base";

function trimPath(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function evaluateVerftBaseStateSource(input: {
  volume: string;
  hostRoot?: string;
  codexHostPath?: string;
  claudeHostPath?: string;
}):
  | { type: "volume"; name: string }
  | { type: "host"; root: string; codexPath: string; claudePath: string } {
  const hostRoot = trimPath(input.hostRoot);
  const codexPath = trimPath(input.codexHostPath) ?? (hostRoot ? path.join(hostRoot, ".codex") : null);
  const claudePath = trimPath(input.claudeHostPath) ?? (hostRoot ? path.join(hostRoot, ".claude") : null);

  if (codexPath && claudePath) {
    return {
      type: "host",
      root: hostRoot ?? "",
      codexPath,
      claudePath
    };
  }

  return { type: "volume", name: input.volume };
}

export function resolveVerftBaseStateSource():
  | { type: "volume"; name: string }
  | { type: "host"; root: string; codexPath: string; claudePath: string } {
  return evaluateVerftBaseStateSource({
    volume: env.VERFT_BASE_VOLUME,
    hostRoot: env.VERFT_AI_STATE_HOST_ROOT,
    codexHostPath: env.VERFT_CODEX_STATE_HOST_PATH,
    claudeHostPath: env.VERFT_CLAUDE_STATE_HOST_PATH
  });
}

export function buildVerftBaseMountArgsForSource(
  source: ReturnType<typeof resolveVerftBaseStateSource>,
  mode: "ro" | "rw" = "rw"
): string[] {
  if (source.type === "host") {
    return [
      "-v",
      `${source.codexPath}:${VERFT_BASE_CONTAINER_ROOT}/codex:${mode}`,
      "-v",
      `${source.claudePath}:${VERFT_BASE_CONTAINER_ROOT}/claude:${mode}`
    ];
  }

  return ["-v", `${source.name}:${VERFT_BASE_CONTAINER_ROOT}:${mode}`];
}

export function buildVerftBaseVolumeMountArgs(mode: "ro" | "rw" = "rw"): string[] {
  return buildVerftBaseMountArgsForSource(resolveVerftBaseStateSource(), mode);
}

export function buildVerftBaseEnvArgs(): string[] {
  return ["-e", `VERFT_BASE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`, "-e", `VERFT_AI_STATE_ROOT=${VERFT_BASE_CONTAINER_ROOT}`];
}
