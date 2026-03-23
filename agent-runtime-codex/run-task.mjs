import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const manifestPath = process.env.TASK_MANIFEST_FILE;
const providerConfigPath = process.env.PROVIDER_CONFIG_FILE;
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = process.env.OPENAI_BASE_URL ?? "";

if (!manifestPath) {
  console.error("TASK_MANIFEST_FILE is required");
  process.exit(1);
}
if (!providerConfigPath) {
  console.error("PROVIDER_CONFIG_FILE is required");
  process.exit(1);
}
if (!openAiApiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const providerConfig = await readFile(providerConfigPath, "utf8").catch(() => "");
const homeDir = "/root";
const codexDir = path.join(homeDir, ".codex");
const lastMessageFile = path.join(path.dirname(manifest.resultJsonPath), "codex-last-message.txt");

await mkdir(codexDir, { recursive: true });
await mkdir(path.dirname(manifest.resultJsonPath), { recursive: true });
if (providerConfig.trim()) {
  await writeFile(path.join(codexDir, "config.toml"), providerConfig, "utf8");
  console.log("[runtime] wrote Codex config");
}

if (openAiBaseUrl) {
  process.env.OPENAI_BASE_URL = openAiBaseUrl;
}
process.env.OPENAI_API_KEY = openAiApiKey;
process.env.HOME = homeDir;

const extractReviewVerdict = (markdown) => {
  const match = markdown.match(/(?:^|\n)#{1,6}\s+Verdict\s*\n([\s\S]*?)(?=\n#{1,6}\s+|$)/i);
  const candidate = match?.[1]?.toLowerCase().replace(/[`*_]/g, "").trim() ?? "";
  if (candidate.includes("changes_requested") || candidate.includes("changes requested")) {
    return "changes_requested";
  }
  if (candidate.includes("approved") || candidate.includes("all good")) {
    return "approved";
  }
  return null;
};

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readTokenCount = (...values) => {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const toTokenUsage = (usage) => {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = readTokenCount(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens);
  const outputTokens = readTokenCount(usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.completionTokens);
  const totalTokens = readTokenCount(
    usage.total_tokens,
    usage.totalTokens,
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  );

  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }

  return {
    status: "available",
    inputTokens,
    outputTokens,
    totalTokens,
    note: null
  };
};

const findTokenUsage = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 5) {
    return null;
  }

  const directUsage = toTokenUsage(value);
  if (directUsage) {
    return directUsage;
  }

  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const entry of entries) {
    const nestedUsage = findTokenUsage(entry, depth + 1);
    if (nestedUsage) {
      return nestedUsage;
    }
  }

  return null;
};


const buildPrompt = () => {
  const rawInput = typeof manifest.iterationInput === "string" && manifest.iterationInput.length > 0
    ? manifest.iterationInput
    : (manifest.prompt ?? "");

  if (rawInput.length === 0) {
    throw new Error("Task prompt is empty");
  }

  if (manifest.action === "ask") {
    return (
      "You are in read-only mode. Answer the user's question using only read-only operations: read files, list directories, search. Do not edit, write, or modify any files. Do not run commands that change the repository.\n\n" +
      rawInput
    );
  }

  return rawInput;
};

await new Promise((resolve, reject) => {
  const proc = spawn("codex", ["login", "--with-api-key"], {
    env: process.env,
    cwd: manifest.workspacePath,
    stdio: ["pipe", "pipe", "pipe"]
  });
  proc.stdin.write(openAiApiKey);
  proc.stdin.end();
  proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
  proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  proc.on("error", reject);
  proc.on("close", (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`codex login exited with ${code ?? "unknown"}`));
  });
});

const prompt = buildPrompt();
const isAsk = manifest.action === "ask";

console.log(`[runtime] running codex action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}${isAsk ? " (read-only instruction)" : ""}`);
const args = [
  "exec",
  "--dangerously-bypass-approvals-and-sandbox",
  "-C",
  manifest.workspacePath,
  "--color",
  "never",
  "--json",
  "--output-last-message",
  lastMessageFile
];
if (manifest.resolvedModel) {
  args.push("-m", manifest.resolvedModel);
}
if (manifest.resolvedReasoningEffort) {
  args.push("-c", `model_reasoning_effort=\"${manifest.resolvedReasoningEffort}\"`);
}
args.push(prompt);

let latestTokenUsage = null;
const execProc = spawn("codex", args, { env: process.env, cwd: manifest.workspacePath, stdio: ["ignore", "pipe", "pipe"] });
let stdoutBuffer = "";

const processStdoutLine = (line) => {
  if (!line.trim()) {
    return;
  }

  const event = safeParseJson(line);
  if (!event) {
    return;
  }

  const tokenUsage = findTokenUsage(event);
  if (tokenUsage) {
    latestTokenUsage = tokenUsage;
    console.log(
      `[runtime] codex token usage input=${tokenUsage.inputTokens ?? "?"} output=${tokenUsage.outputTokens ?? "?"} total=${tokenUsage.totalTokens ?? "?"}`
    );
  }
};

execProc.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  stdoutBuffer += text;
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() ?? "";

  for (const line of lines) {
    processStdoutLine(line);
  }
});
execProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
await new Promise((resolve, reject) => {
  execProc.on("error", reject);
  execProc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`codex exited with code ${code ?? "unknown"}`))));
});
processStdoutLine(stdoutBuffer);

const summaryMarkdown = (await readFile(lastMessageFile, "utf8").catch(() => "")).trim();
if (!summaryMarkdown) {
  throw new Error("codex returned empty summary markdown");
}

await writeFile(manifest.resultMarkdownPath, `${summaryMarkdown}\n`, "utf8");
await writeFile(
  manifest.resultJsonPath,
  JSON.stringify(
    {
      taskType: manifest.taskType,
      status: "success",
      summaryMarkdown,
      reviewVerdict: manifest.action === "review" ? extractReviewVerdict(summaryMarkdown) : null,
      changedFiles: [],
      metadata: {
        provider: manifest.provider,
        action: manifest.action,
        tokenUsage: latestTokenUsage ?? {
          status: "unavailable",
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          note: "Codex CLI did not emit token usage in JSON output."
        }
      }
    },
    null,
    2
  ),
  "utf8"
);

console.log("[runtime] completed");
