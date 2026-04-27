import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
const configuredStatePath = process.env.TASK_PROVIDER_STATE_PATH?.trim();
const configuredHomeDir = process.env.TASK_PROVIDER_HOME?.trim();
const codexDir = configuredStatePath && configuredStatePath.length > 0 ? configuredStatePath : path.join("/root", ".codex");
const homeDir = configuredHomeDir && configuredHomeDir.length > 0 ? configuredHomeDir : path.dirname(codexDir);
const lastMessageFile = path.join(path.dirname(manifest.resultJsonPath), "codex-last-message.txt");
const sessionIdFile = path.join(codexDir, "agentswarm-session-id.txt");

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSessionId = (value) => typeof value === "string" && SESSION_ID_PATTERN.test(value.trim());

const readPersistedSessionId = async () => {
  const raw = await readFile(sessionIdFile, "utf8").catch(() => "");
  const candidate = raw.trim();
  return isSessionId(candidate) ? candidate : null;
};

const writePersistedSessionId = async (sessionId) => {
  if (!isSessionId(sessionId)) {
    return;
  }

  await writeFile(sessionIdFile, `${sessionId.trim()}\n`, "utf8");
};

const listRolloutFiles = async (sessionsRoot) => {
  const pending = [sessionsRoot];
  const files = [];

  while (pending.length > 0) {
    const currentDir = pending.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
};

const sessionIdFromRolloutFileName = (rolloutPath) => {
  const match = path.basename(rolloutPath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? null;
};

const inferSessionIdFromRolloutFiles = async () => {
  const sessionsRoot = path.join(codexDir, "sessions");
  const rolloutFiles = await listRolloutFiles(sessionsRoot);
  if (rolloutFiles.length === 0) {
    return null;
  }

  const withMtime = await Promise.all(
    rolloutFiles.map(async (rolloutPath) => ({
      rolloutPath,
      mtimeMs: (await stat(rolloutPath).catch(() => null))?.mtimeMs ?? 0
    }))
  );
  withMtime.sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const { rolloutPath } of withMtime) {
    const candidate = sessionIdFromRolloutFileName(rolloutPath);
    if (isSessionId(candidate)) {
      return candidate;
    }
  }

  return null;
};

const extractSessionIdFromJsonEvent = (event) => {
  if (!event || typeof event !== "object") {
    return null;
  }

  const directFields = [event.session_id, event.sessionId, event.thread_id, event.threadId];
  for (const value of directFields) {
    if (isSessionId(value)) {
      return value.trim();
    }
  }

  if (event.type === "session_meta" && event.payload && typeof event.payload === "object" && isSessionId(event.payload.id)) {
    return event.payload.id.trim();
  }

  return null;
};

const extractSessionIdFromOutputLine = (line) => {
  if (!line || !line.trim().startsWith("{")) {
    return null;
  }

  try {
    return extractSessionIdFromJsonEvent(JSON.parse(line));
  } catch {
    return null;
  }
};

await mkdir(homeDir, { recursive: true });
await mkdir(codexDir, { recursive: true });
await mkdir(path.dirname(manifest.resultJsonPath), { recursive: true });
await writeFile(path.join(codexDir, "config.toml"), providerConfig, "utf8");
console.log("[runtime] wrote Codex config");

if (openAiBaseUrl) {
  process.env.OPENAI_BASE_URL = openAiBaseUrl;
}
process.env.OPENAI_API_KEY = openAiApiKey;
process.env.GIT_OPTIONAL_LOCKS = "0";
process.env.HOME = homeDir;

const buildPrompt = () => {
  const rawContent = typeof manifest.content === "string" && manifest.content.trim().length > 0
    ? manifest.content.trim()
    : (typeof manifest.prompt === "string" ? manifest.prompt.trim() : "");
  const attachments = Array.isArray(manifest.attachments)
    ? manifest.attachments.filter(
        (attachment) =>
          attachment &&
          typeof attachment === "object" &&
          typeof attachment.name === "string" &&
          typeof attachment.absolutePath === "string" &&
          attachment.name.trim().length > 0 &&
          attachment.absolutePath.trim().length > 0
      )
    : [];

  if (rawContent.length === 0) {
    throw new Error("Task prompt is empty");
  }

  const promptSections = [];
  if (attachments.length > 0) {
    promptSections.push(
      "Reference Images:",
      ...attachments.map((attachment) => `- ${attachment.absolutePath.trim()} (${attachment.name.trim()})`),
      ""
    );
  }
  promptSections.push("Current user request:", "", rawContent);
  const promptBody = promptSections.join("\n");

  if (manifest.action === "ask") {
    return (
      "You are in read-only mode. Answer the user's question using only read-only operations: read files, list directories, search. Do not edit, write, or modify any files. Do not run commands that change the repository.\n\n" +
      promptBody
    );
  }

  return promptBody;
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
const persistedSessionId = await readPersistedSessionId();
let resolvedSessionId = persistedSessionId;

console.log(
  `[runtime] running codex action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}${isAsk ? " (read-only instruction)" : ""} session=${persistedSessionId ?? "new"}`
);
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
if (persistedSessionId) {
  args.push("resume", persistedSessionId);
}
for (const attachment of Array.isArray(manifest.attachments) ? manifest.attachments : []) {
  if (typeof attachment?.absolutePath === "string" && attachment.absolutePath.trim().length > 0) {
    args.push("--image", attachment.absolutePath.trim());
  }
}
if (persistedSessionId) {
  args.push(prompt);
} else {
  args.push("--", prompt);
}

const execProc = spawn("codex", args, { env: process.env, cwd: manifest.workspacePath, stdio: ["ignore", "pipe", "pipe"] });
let stdoutBuffer = "";
let stderrBuffer = "";

execProc.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdoutBuffer += text;
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() ?? "";
  for (const line of lines) {
    const candidate = extractSessionIdFromOutputLine(line);
    if (candidate) {
      resolvedSessionId = candidate;
    }
  }
  process.stdout.write(chunk);
});
execProc.stderr.on("data", (chunk) => {
  stderrBuffer += chunk.toString();
  process.stderr.write(chunk);
});
await new Promise((resolve, reject) => {
  execProc.on("error", reject);
  execProc.on("close", (code) => {
    const trailingSessionId = extractSessionIdFromOutputLine(stdoutBuffer);
    if (trailingSessionId) {
      resolvedSessionId = trailingSessionId;
    }

    if (code === 0) {
      resolve();
      return;
    }

    const stderrTail = stderrBuffer.trim();
    reject(new Error(`codex exited with code ${code ?? "unknown"}${stderrTail ? `: ${stderrTail}` : ""}`));
  });
});

if (!resolvedSessionId) {
  resolvedSessionId = await inferSessionIdFromRolloutFiles();
}
if (resolvedSessionId) {
  await writePersistedSessionId(resolvedSessionId);
  console.log(`[runtime] codex session_id=${resolvedSessionId}`);
}

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
      changedFiles: [],
      metadata: {
        provider: manifest.provider,
        action: manifest.action,
        ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {})
      }
    },
    null,
    2
  ),
  "utf8"
);

console.log("[runtime] completed");
