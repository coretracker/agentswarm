import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderProfile } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { codexReasoningEffortForProfile } from "../lib/provider-config.js";
import type { SettingsRuntimeCredentials } from "./settings-store.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_MAX_CHARS = 12_000;
const CODEX_UTILITY_DIR_NAME = "codex-utility";

export class CodexUtilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexUtilityUnavailableError";
  }
}

export class CodexUtilityError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502
  ) {
    super(message);
    this.name = "CodexUtilityError";
  }
}

const codexUtilityScript = `
set -eu
mkdir -p "$HOME/.codex"
cat > "$HOME/.codex/config.toml" <<'EOF'
sandbox_mode = "read-only"
approval_policy = "never"

[notice]
hide_rate_limit_model_nudge = true
hide_gpt5_1_migration_prompt = true
"hide_gpt-5.1-codex-max_migration_prompt" = true
EOF
if [ -n "\${CODEX_AUTH_JSON_B64:-}" ]; then
  printf %s "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json"
elif [ -n "\${OPENAI_API_KEY:-}" ]; then
  printf %s "$OPENAI_API_KEY" | codex login --with-api-key -c cli_auth_credentials_store=file
else
  echo "Codex credentials are not configured." >&2
  exit 64
fi
codex exec \\
  --ephemeral \\
  --skip-git-repo-check \\
  --ignore-rules \\
  --sandbox read-only \\
  -C "$CODEX_UTILITY_WORKDIR" \\
  -m "$CODEX_MODEL" \\
  -c cli_auth_credentials_store=file \\
  -c "model_reasoning_effort=\\"$CODEX_REASONING_EFFORT\\"" \\
  -o "$CODEX_UTILITY_WORKDIR/output.txt" \\
  - < "$CODEX_UTILITY_WORKDIR/prompt.txt"
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

export async function executeCodexUtility(input: {
  prompt: string;
  model: string;
  providerProfile: ProviderProfile;
  credentials: SettingsRuntimeCredentials;
  timeoutMs?: number;
  outputMaxChars?: number;
}): Promise<string> {
  const image = env.CODEX_INTERACTIVE_IMAGE?.trim();
  if (!image) {
    throw new CodexUtilityUnavailableError("Codex utility runner is not configured (set CODEX_INTERACTIVE_IMAGE).");
  }
  if (!input.credentials.openaiApiKey && !input.credentials.codexAuthJson) {
    throw new CodexUtilityUnavailableError("Codex credentials are not configured.");
  }

  const tempDir = path.join(env.RUNTIME_PAYLOAD_ROOT, CODEX_UTILITY_DIR_NAME, randomUUID());
  await mkdir(tempDir, { recursive: true });
  await writeFile(path.join(tempDir, "prompt.txt"), input.prompt, "utf8");

  const args = [
    "run",
    "--rm",
    "-e",
    "HOME=/root",
    "-e",
    `CODEX_MODEL=${input.model}`,
    "-e",
    `CODEX_REASONING_EFFORT=${codexReasoningEffortForProfile(input.providerProfile)}`,
    "-e",
    `CODEX_UTILITY_WORKDIR=${tempDir}`,
    ...(input.credentials.openaiApiKey ? ["-e", `OPENAI_API_KEY=${input.credentials.openaiApiKey}`] : []),
    ...(input.credentials.codexAuthJson
      ? ["-e", `CODEX_AUTH_JSON_B64=${Buffer.from(input.credentials.codexAuthJson, "utf8").toString("base64")}`]
      : []),
    ...(input.credentials.openaiBaseUrl ? ["-e", `OPENAI_BASE_URL=${input.credentials.openaiBaseUrl}`] : []),
    "-v",
    `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
    "-w",
    tempDir,
    image,
    "sh",
    "-lc",
    codexUtilityScript
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
        reject(new CodexUtilityError("Codex utility run timed out.", 504));
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
        reject(new CodexUtilityUnavailableError(`Failed to start Codex utility runner: ${error.message}`));
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
          reject(new CodexUtilityUnavailableError(details || "Codex utility runner Docker image is unavailable."));
          return;
        }
        reject(new CodexUtilityError(details || `Codex utility run failed with exit code ${code ?? "unknown"}.`));
      });
    });

    const output = (await readFile(path.join(tempDir, "output.txt"), "utf8")).trim();
    if (!output) {
      throw new CodexUtilityError("Codex utility run returned empty output.");
    }
    return output.slice(0, input.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
