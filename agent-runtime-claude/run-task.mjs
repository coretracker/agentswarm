import { access, constants, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const manifestPath = process.env.TASK_MANIFEST_FILE;
const providerConfigPath = process.env.PROVIDER_CONFIG_FILE;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";

if (!manifestPath) {
  console.error("TASK_MANIFEST_FILE is required");
  process.exit(1);
}
if (!providerConfigPath) {
  console.error("PROVIDER_CONFIG_FILE is required");
  process.exit(1);
}
if (!anthropicApiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(path.dirname(manifest.resultJsonPath), { recursive: true });
process.env.ANTHROPIC_API_KEY = anthropicApiKey;
process.env.GIT_OPTIONAL_LOCKS = "0";
const configuredStatePath = process.env.TASK_PROVIDER_STATE_PATH?.trim();
const configuredHomeDir = process.env.TASK_PROVIDER_HOME?.trim();
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSessionId = (value) => typeof value === "string" && SESSION_ID_PATTERN.test(value.trim());

const readPersistedSessionId = async (sessionIdPath) => {
  const raw = await readFile(sessionIdPath, "utf8").catch(() => "");
  const candidate = raw.trim();
  return isSessionId(candidate) ? candidate : null;
};

const writePersistedSessionId = async (sessionIdPath, sessionId) => {
  if (!isSessionId(sessionId)) {
    return;
  }

  await writeFile(sessionIdPath, `${sessionId.trim()}\n`, "utf8");
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

const isExecutable = async (candidate) => {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveClaudeBinary = async (runtimeHome) => {
  const homeBinary = path.join(runtimeHome, ".local", "bin", "claude");
  if (await isExecutable(homeBinary)) {
    return homeBinary;
  }

  const legacyBinary = "/opt/claude-code/.local/bin/claude";
  if (await isExecutable(legacyBinary)) {
    await mkdir(path.dirname(homeBinary), { recursive: true });
    await symlink(legacyBinary, homeBinary).catch(() => undefined);
    if (await isExecutable(homeBinary)) {
      return homeBinary;
    }
    return legacyBinary;
  }

  return homeBinary;
};

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
  return promptSections.join("\n");
};

const mcpTools = providerConfigPath
  ? Object.keys((JSON.parse(await readFile(providerConfigPath, "utf8").catch(() => "{}"))?.mcpServers ?? {})).map((name) => `mcp__${name}`)
  : [];
const isAsk = manifest.action === "ask";
const allowedTools = (isAsk
  ? ["Read", "LS", "Grep", "Glob", "TodoWrite", "Task", ...mcpTools]
  : ["Bash", "Read", "Edit", "Write", "MultiEdit", "LS", "Grep", "Glob", "TodoWrite", "Task", ...mcpTools]
).join(",");

const args = [
  "-p",
  buildPrompt(),
  "--output-format",
  "stream-json",
  "--include-partial-messages",
  "--verbose",
  "--dangerously-skip-permissions",
  "--allowedTools",
  allowedTools,
  "--mcp-config",
  providerConfigPath
];
if (manifest.resolvedModel) {
  args.push("--model", manifest.resolvedModel);
}

const workspaceStats = await stat(manifest.workspacePath);
const runtimeIdentity = workspaceStats.uid > 0 && workspaceStats.gid > 0 ? `${workspaceStats.uid}:${workspaceStats.gid}` : "agent:agent";
const runtimeHome = configuredHomeDir && configuredHomeDir.length > 0
  ? configuredHomeDir
  : path.join("/runtime", `claude-home-${runtimeIdentity.replace(/[:/]/g, "-")}`);
const providerStatePath = configuredStatePath && configuredStatePath.length > 0
  ? configuredStatePath
  : path.join(runtimeHome, ".claude");
await mkdir(runtimeHome, { recursive: true });
await mkdir(providerStatePath, { recursive: true });
const sessionIdFilePath = path.join(providerStatePath, "agentswarm-session-id.txt");
const persistedSessionId = await readPersistedSessionId(sessionIdFilePath);
if (persistedSessionId) {
  args.push("--resume", persistedSessionId);
}
const claudeBinary = await resolveClaudeBinary(runtimeHome);

console.log(
  `[runtime] running claude action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}${isAsk ? " (read-only tools)" : ""} session=${persistedSessionId ?? "new"}`
);
console.log(`[runtime] claude thinking_budget_tokens=${manifest.resolvedThinkingBudgetTokens ?? "default"}`);
await runCommand("chown", ["-R", runtimeIdentity, runtimeHome, path.dirname(manifest.resultJsonPath)]);
console.log(`[runtime] prepared claude runtime user=${runtimeIdentity}`);

let finalMarkdown = "";
let resultSubtype = null;
let resultDetails = null;
let resolvedSessionId = persistedSessionId;
const assistantLines = [];
const toolBlocks = new Map();
let sawPartialAssistantText = false;
let partialTextBuffer = "";
const proc = spawn("su-exec", [runtimeIdentity, claudeBinary, ...args], {
  env: {
    ...process.env,
    ...(typeof manifest.resolvedThinkingBudgetTokens === "number"
      ? { MAX_THINKING_TOKENS: String(manifest.resolvedThinkingBudgetTokens) }
      : {}),
    HOME: runtimeHome,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: manifest.workspacePath
  },
  cwd: manifest.workspacePath,
  stdio: ["ignore", "pipe", "pipe"]
});
let stdoutBuffer = "";

const truncateForLog = (value, maxLength = 320) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
};

const flushPartialTextBuffer = () => {
  const line = partialTextBuffer.trim();
  if (line) {
    console.log(`[claude] ${line}`);
  }
  partialTextBuffer = "";
};

const appendPartialText = (text) => {
  if (!text) {
    return;
  }

  sawPartialAssistantText = true;
  partialTextBuffer += text;

  while (partialTextBuffer.includes("\n")) {
    const newlineIndex = partialTextBuffer.indexOf("\n");
    const line = partialTextBuffer.slice(0, newlineIndex).trim();
    if (line) {
      console.log(`[claude] ${line}`);
    }
    partialTextBuffer = partialTextBuffer.slice(newlineIndex + 1);
  }
};

const emitAssistantText = (message) => {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      assistantLines.push(block.text.trim());
      if (!sawPartialAssistantText) {
        console.log(`[claude] ${block.text.trim()}`);
      }
    }
  }
};

const extractResultMarkdown = (value) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const text = value
      .flatMap((entry) => {
        if (typeof entry === "string") {
          return [entry];
        }

        if (entry && typeof entry === "object" && typeof entry.text === "string") {
          return [entry.text];
        }

        return [];
      })
      .join("\n\n")
      .trim();
    return text || "";
  }

  if (value && typeof value === "object") {
    if (typeof value.text === "string" && value.text.trim()) {
      return value.text.trim();
    }

    if (Array.isArray(value.content)) {
      return extractResultMarkdown(value.content);
    }

    if (typeof value.result === "string" && value.result.trim()) {
      return value.result.trim();
    }
  }

  return "";
};

const describeResultEvent = (event) => {
  if (!event || typeof event !== "object") {
    return "";
  }

  const candidates = [
    typeof event.error === "string" ? event.error : "",
    typeof event.message === "string" ? event.message : "",
    typeof event.result === "string" ? event.result : "",
    typeof event.details === "string" ? event.details : ""
  ].filter((value) => value.trim().length > 0);

  if (candidates.length > 0) {
    return candidates[0].trim();
  }

  return "";
};

const buildResultError = () => {
  if (!resultSubtype || resultSubtype === "success") {
    return null;
  }

  if (resultSubtype.includes("max_turns")) {
    return new Error(
      `Claude hit a turn limit before producing a final answer.${resultDetails ? ` ${resultDetails}` : ""} AgentSwarm did not set --max-turns for this run.`
    );
  }

  return new Error(
    `Claude finished without a successful result (subtype=${resultSubtype}).${resultDetails ? ` ${resultDetails}` : ""}`
  );
};

const handleRawStreamEvent = (rawEvent) => {
  if (!rawEvent || typeof rawEvent !== "object") {
    return;
  }

  switch (rawEvent.type) {
    case "message_start": {
      const id = rawEvent.message?.id ?? "unknown";
      console.log(`[runtime] claude message_start id=${id}`);
      return;
    }
    case "content_block_start": {
      const block = rawEvent.content_block ?? {};
      const index = rawEvent.index ?? "unknown";
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        toolBlocks.set(index, { name: block.name ?? "tool", input: "" });
        console.log(`[runtime] claude tool start name=${block.name ?? "tool"} index=${index}`);
      } else if (block.type === "text") {
        console.log(`[runtime] claude text block start index=${index}`);
      } else if (typeof block.type === "string") {
        console.log(`[runtime] claude block start type=${block.type} index=${index}`);
      }
      return;
    }
    case "content_block_delta": {
      const delta = rawEvent.delta ?? {};
      const index = rawEvent.index;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        appendPartialText(delta.text);
        return;
      }

      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const current = toolBlocks.get(index) ?? { name: "tool", input: "" };
        current.input += delta.partial_json;
        toolBlocks.set(index, current);
      }
      return;
    }
    case "content_block_stop": {
      flushPartialTextBuffer();
      const current = toolBlocks.get(rawEvent.index);
      if (current) {
        const preview = truncateForLog(current.input.replace(/\s+/g, " ").trim());
        console.log(
          preview
            ? `[runtime] claude tool input name=${current.name} payload=${preview}`
            : `[runtime] claude tool end name=${current.name}`
        );
        toolBlocks.delete(rawEvent.index);
      }
      return;
    }
    case "message_delta": {
      flushPartialTextBuffer();
      const stopReason = rawEvent.delta?.stop_reason ?? rawEvent.stop_reason ?? "streaming";
      console.log(`[runtime] claude message_delta stop_reason=${stopReason}`);
      return;
    }
    case "message_stop": {
      flushPartialTextBuffer();
      console.log("[runtime] claude message_stop");
      return;
    }
    default: {
      if (typeof rawEvent.type === "string") {
        console.log(`[runtime] claude stream event type=${rawEvent.type}`);
      }
    }
  }
};

proc.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      const sessionIdCandidate = [event.session_id, event.sessionId, event.event?.session_id, event.event?.sessionId]
        .find((value) => isSessionId(value));
      if (sessionIdCandidate) {
        resolvedSessionId = sessionIdCandidate.trim();
      }

      if (event.type === "system" && event.subtype === "init") {
        console.log(
          `[runtime] claude init model=${event.model} permissionMode=${event.permissionMode} session_id=${resolvedSessionId ?? "unknown"}`
        );
      } else if (event.type === "stream_event" && event.event) {
        handleRawStreamEvent(event.event);
      } else if (event.type === "assistant") {
        emitAssistantText(event.message);
      } else if (event.type === "result") {
        flushPartialTextBuffer();
        resultSubtype = typeof event.subtype === "string" ? event.subtype : null;
        resultDetails = describeResultEvent(event);
        finalMarkdown = extractResultMarkdown(event.result);
        console.log(
          `[runtime] claude result subtype=${resultSubtype ?? "unknown"}${resultDetails ? ` detail=${truncateForLog(resultDetails)}` : ""}`
        );
      } else {
        console.log(`[runtime] claude event type=${event.type ?? "unknown"}`);
      }
    } catch {
      console.log(`[runtime] ${line}`);
    }
  }
});
proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
await new Promise((resolve, reject) => {
  proc.on("error", reject);
  proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`claude exited with code ${code ?? "unknown"}`))));
});
flushPartialTextBuffer();

const resultError = buildResultError();
if (resultError) {
  throw resultError;
}

if (!finalMarkdown) {
  finalMarkdown = assistantLines.join("\n\n").trim();
}
if (!finalMarkdown) {
  throw new Error("Claude completed without producing final markdown output.");
}

if (resolvedSessionId) {
  await writePersistedSessionId(sessionIdFilePath, resolvedSessionId);
  console.log(`[runtime] claude session_id=${resolvedSessionId}`);
}

await writeFile(manifest.resultMarkdownPath, `${finalMarkdown}\n`, "utf8");
await writeFile(
  manifest.resultJsonPath,
  JSON.stringify(
    {
      taskType: manifest.taskType,
      status: "success",
      summaryMarkdown: finalMarkdown,
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
