import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_RUNTIME_IMAGE, env } from "../config/env.js";
import { buildVerftBaseEnvArgs, buildVerftBaseVolumeMountArgs } from "../lib/verft-base-mounts.js";
import type { SettingsRuntimeCredentials } from "./settings-store.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_MAX_CHARS = 12_000;
const CLAUDE_UTILITY_DIR_NAME = "claude-utility";

export class ClaudeUtilityUnavailableError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ClaudeUtilityUnavailableError";
  }
}

export class ClaudeUtilityError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502
  ) {
    super(message);
    this.name = "ClaudeUtilityError";
  }
}

const claudeUtilityScript = `
set -eu
mkdir -p "$HOME/.claude"
[ -f "\${VERFT_BASE_ROOT:-/verft-base}/claude/.credentials.json" ] && cp "\${VERFT_BASE_ROOT:-/verft-base}/claude/.credentials.json" "$HOME/.claude/.credentials.json"
[ -f "\${VERFT_BASE_ROOT:-/verft-base}/claude/settings.json" ] && cp "\${VERFT_BASE_ROOT:-/verft-base}/claude/settings.json" "$HOME/.claude/settings.json"
[ -f "\${VERFT_BASE_ROOT:-/verft-base}/claude/.claude.json" ] && cp "\${VERFT_BASE_ROOT:-/verft-base}/claude/.claude.json" "$HOME/.claude.json"
if [ -z "\${ANTHROPIC_API_KEY:-}" ] && [ ! -f "$HOME/.claude/.credentials.json" ]; then
  echo "Anthropic API key or Claude credentials.json is not configured." >&2
  exit 64
fi
chown -R agent:agent "$HOME" "$CLAUDE_UTILITY_WORKDIR" 2>/dev/null || true
CLAUDE_REAL="$(command -v claude)"
su-exec agent:agent "$CLAUDE_REAL" \\
  -p "$(cat "$CLAUDE_UTILITY_WORKDIR/prompt.txt")" \\
  --output-format text \\
  --model "$CLAUDE_MODEL" \\
  > "$CLAUDE_UTILITY_WORKDIR/output.txt"
`;

const trimProcessOutput = (value: string, maxChars = 4000): string => {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
};

const isDockerRunnerUnavailable = (code: number | null, output: string): boolean => {
  const normalized = output.toLowerCase();
  return (
    code === 125 ||
    normalized.includes("cannot connect to the docker daemon") ||
    normalized.includes("unable to find image") ||
    normalized.includes("pull access denied") ||
    normalized.includes("no such image") ||
    normalized.includes("manifest unknown")
  );
};

export async function executeClaudeUtility(input: {
  prompt: string;
  model: string;
  credentials: SettingsRuntimeCredentials;
  timeoutMs?: number;
  outputMaxChars?: number;
}): Promise<string> {
  const tempDir = path.join(env.RUNTIME_PAYLOAD_ROOT, CLAUDE_UTILITY_DIR_NAME, randomUUID());
  await mkdir(tempDir, { recursive: true });
  await writeFile(path.join(tempDir, "prompt.txt"), input.prompt, "utf8");

  const args = [
    "run",
    "--rm",
    "-e",
    "HOME=/home/agent",
    "-e",
    `CLAUDE_MODEL=${input.model}`,
    "-e",
    `CLAUDE_UTILITY_WORKDIR=${tempDir}`,
    ...(input.credentials.anthropicApiKey ? ["-e", `ANTHROPIC_API_KEY=${input.credentials.anthropicApiKey}`] : []),
    ...(input.credentials.anthropicBaseUrl ? ["-e", `ANTHROPIC_BASE_URL=${input.credentials.anthropicBaseUrl}`] : []),
    ...buildVerftBaseEnvArgs(),
    "-v",
    `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
    ...buildVerftBaseVolumeMountArgs(),
    "-w",
    tempDir,
    AGENT_RUNTIME_IMAGE,
    "sh",
    "-lc",
    claudeUtilityScript
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        child.kill("SIGKILL");
        reject(new ClaudeUtilityError("Claude utility run timed out.", 504));
      }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new ClaudeUtilityUnavailableError(`Failed to start Claude utility runner: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        const details = trimProcessOutput(stderr || stdout);
        if (isDockerRunnerUnavailable(code, details)) {
          reject(new ClaudeUtilityUnavailableError(details || "Claude utility runner Docker image is unavailable."));
          return;
        }
        reject(new ClaudeUtilityError(details || `Claude utility run failed with exit code ${code ?? "unknown"}.`));
      });
    });

    const output = (await readFile(path.join(tempDir, "output.txt"), "utf8")).trim();
    if (!output) {
      throw new ClaudeUtilityError("Claude utility run returned empty output.");
    }
    return output.slice(0, input.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
