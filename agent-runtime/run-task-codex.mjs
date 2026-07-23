import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const AGENT_IDENTITY = "agent:agent";
const AGENT_HOME = "/home/agent";
const manifestPath = process.env.TASK_MANIFEST_FILE;
const providerConfigPath = process.env.PROVIDER_CONFIG_FILE;
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = process.env.OPENAI_BASE_URL ?? "";

const fileExists = async (targetPath) => Boolean((await stat(targetPath).catch(() => null))?.isFile());

if (!manifestPath) {
  console.error("TASK_MANIFEST_FILE is required");
  process.exit(1);
}
if (!providerConfigPath) {
  console.error("PROVIDER_CONFIG_FILE is required");
  process.exit(1);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const configuredHomeDir = process.env.TASK_PROVIDER_HOME?.trim();
const homeDir = configuredHomeDir && configuredHomeDir.length > 0 ? configuredHomeDir : AGENT_HOME;
const codexDir = path.join(homeDir, ".codex");
const lastMessageFile = path.join(path.dirname(manifest.resultJsonPath), "codex-last-message.txt");
const sessionIdFile = path.join(codexDir, "verft-session-id.txt");
const rawEventsJsonlPath = typeof manifest.rawEventsJsonlPath === "string" && manifest.rawEventsJsonlPath.trim()
  ? manifest.rawEventsJsonlPath.trim()
  : path.join(path.dirname(manifest.resultJsonPath), "raw-events.jsonl");

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSessionId = (value) => typeof value === "string" && SESSION_ID_PATTERN.test(value.trim());

const preserveHostexecPath = () => {
  const hostexecBinPath = process.env.HOSTEXEC_BIN_PATH?.trim();
  if (!hostexecBinPath) {
    return;
  }

  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  if (pathEntries.includes(hostexecBinPath)) {
    return;
  }

  process.env.PATH = [hostexecBinPath, ...pathEntries].join(":");
};

const readPersistedSessionId = async () => {
  const raw = await readFile(sessionIdFile, "utf8").catch(() => "");
  const candidate = raw.trim();
  return isSessionId(candidate) ? candidate : null;
};

const writePersistedSessionId = async (sessionId) => {
  if (!isSessionId(sessionId)) {
    return;
  }

  await writeFile(sessionIdFile, `${sessionId.trim()}\n`, "utf8").catch(() => undefined);
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

const ensureGitAskPass = async (runtimeHome) => {
  const gitToken = process.env.GIT_TOKEN?.trim();
  if (!gitToken) {
    return;
  }

  const askPassPath = path.join(runtimeHome, "verft-git-askpass.sh");
  await writeFile(
    askPassPath,
    `#!/usr/bin/env sh
case "$1" in
  *sername*) echo "\${GIT_USERNAME:-x-access-token}" ;;
  *assword*) echo "\${GIT_TOKEN:-}" ;;
  *) echo "" ;;
esac
`,
    "utf8"
  );
  await chmod(askPassPath, 0o700);
  process.env.GIT_TERMINAL_PROMPT = "0";
  process.env.GIT_ASKPASS = askPassPath;
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stderr = "";

    proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
    });
  });

await mkdir(homeDir, { recursive: true });
await mkdir(codexDir, { recursive: true });
await runCommand("node", ["/usr/local/bin/normalize-provider-paths.mjs", homeDir]);
await mkdir(path.dirname(manifest.resultJsonPath), { recursive: true });
await mkdir(path.dirname(rawEventsJsonlPath), { recursive: true });
process.env.CODEX_HOME = codexDir;
console.log(`[runtime] codex auth home=${(await fileExists(path.join(codexDir, "auth.json"))) ? "present" : "missing"}`);
if (!openAiApiKey && !(await fileExists(path.join(codexDir, "auth.json")))) {
  console.error("OPENAI_API_KEY or Codex host login is required");
  process.exit(1);
}

if (openAiBaseUrl) {
  process.env.OPENAI_BASE_URL = openAiBaseUrl;
}
if (openAiApiKey) {
  process.env.OPENAI_API_KEY = openAiApiKey;
}
process.env.GIT_OPTIONAL_LOCKS = "0";
process.env.HOME = homeDir;
preserveHostexecPath();
await ensureGitAskPass(homeDir);

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
  if (typeof manifest.harnessFilePath === "string" && manifest.harnessFilePath.trim().length > 0) {
    promptSections.push(
      "Repository harness:",
      `- ${manifest.harnessFilePath.trim()}`,
      "Use this file as standing repository guidance for this task run.",
      ""
    );
  }
  promptSections.push("Current user request:", "", rawContent);
  return promptSections.join("\n");
};

const isAsk = manifest.action === "ask";
await runCommand("chown", ["-R", AGENT_IDENTITY, homeDir, path.dirname(manifest.resultJsonPath), path.dirname(rawEventsJsonlPath)]);
if (!isAsk) {
  await runCommand("chown", ["-R", AGENT_IDENTITY, manifest.workspacePath]).catch(() => undefined);
}
console.log(`[runtime] prepared codex runtime user=${AGENT_IDENTITY}`);

const prompt = buildPrompt();
const persistedSessionId = await readPersistedSessionId();
let resolvedSessionId = persistedSessionId;

console.log(
  `[runtime] running codex action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}${isAsk ? " (read-only instruction)" : ""} session=${persistedSessionId ?? "new"}`
);
const args = [
  "exec",
  "-C",
  manifest.workspacePath,
  "--color",
  "never",
  "--json",
  "--output-last-message",
  lastMessageFile
];
// Ask-mode immutability is enforced by mounting the workspace as read-only in the spawner.
// Avoid Codex sandbox flags here because nested bubblewrap can fail on hosts without user namespaces.
args.push("--dangerously-bypass-approvals-and-sandbox");
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

const execProc = spawn("su-exec", [AGENT_IDENTITY, "codex", ...args], {
  env: process.env,
  cwd: manifest.workspacePath,
  stdio: ["ignore", "pipe", "pipe"]
});
let stdoutBuffer = "";
let stderrBuffer = "";
const rawEventsStream = createWriteStream(rawEventsJsonlPath, { flags: "a" });

execProc.stdout.on("data", (chunk) => {
  rawEventsStream.write(chunk);
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
let codexProcessError = null;
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
}).catch((error) => {
  codexProcessError = error;
});
await new Promise((resolve, reject) => {
  rawEventsStream.end(() => resolve());
  rawEventsStream.on("error", reject);
});
if (codexProcessError) {
  throw codexProcessError;
}

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
