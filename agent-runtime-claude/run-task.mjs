import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

const buildPrompt = () => {
  const rulesSection = manifest.agentRules?.trim()
    ? `\nGlobal Agent Rules:\n${manifest.agentRules}\n\nThese rules apply to every action unless they directly conflict with the explicit task requirements.\n`
    : "";
  const approvedPlanSection = manifest.planMarkdown?.trim()
    ? `\nApproved plan markdown:\n${manifest.planMarkdown}\n`
    : `\nNo approved plan markdown is available for this task.\nFallback execution summary:\n${manifest.executionSummary}\n`;
  const followUpInstructionSection = manifest.iterationInput?.trim()
    ? `\nAdditional user instruction:\n${manifest.iterationInput}\n`
    : "";

  switch (manifest.action) {
    case "plan":
      return `You are planning work for the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${followUpInstructionSection}${rulesSection}\nInspect the repository and create an implementation plan in markdown with sections:\n- Overview\n- Repo Findings\n- Files To Change\n- Implementation Steps\n- Validation\n- Risks\n\nImportant:\n- Return only markdown content for the plan.\n- Do not ask for additional input.\n- Be concrete. The plan must describe the likely code changes, not just process steps.\n- In \"Overview\", summarize the problem and intended outcome without repeating the full requirements.\n- In \"Repo Findings\", list the concrete files, modules, or code paths you inspected and why they matter.\n- In \"Repo Findings\", include short code snippets only when they clarify a key implementation constraint.\n- In \"Files To Change\", organize the plan file-by-file, explain why each file matters, and include the proposed edits directly under that file entry.\n- Do not create a separate \"Suggested Code Changes\" section.\n- When proposing file edits, prefer fenced markdown code blocks whose language is set to diff.\n- For diff blocks, prefer full git-style unified diffs with diff --git, ---, +++, and valid @@ -old,+new @@ hunk headers so the UI can render them reliably.\n- In \"Validation\", list only the concrete checks or commands needed to verify the planned change.\n- Omit \"Risks\" if there are no meaningful risks.\n- Do not actually modify files during planning.`;
    case "build":
      return `You are implementing a task in the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${approvedPlanSection}${followUpInstructionSection}${rulesSection}\nImplement the required code changes directly in this repository, then stop.\nUse the approved plan as the primary implementation guide when it is available.\nOnly rely on the fallback execution summary when no approved plan exists.\nStay close to the planned files and implementation steps.\nDo not do broad repository exploration unless the approved plan is clearly blocked by the actual code.\nDo not run git commit, git push, or create your own local commits.\nDo not summarize hypothetical commits. The server will handle commit and push after the run.\nLeave file modifications in the working tree and return a markdown summary of the completed code changes and validation results.`;
    case "iterate":
      return `You are revising an implementation plan for the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}\n\nCurrent plan markdown:\n${manifest.planMarkdown || "(no plan has been generated yet; use the execution summary below as the current draft)"}\n\nCurrent execution summary:\n${manifest.executionSummary}\n\nIteration request:\n${manifest.iterationInput}${rulesSection}\nRevise the plan to incorporate the iteration request, then stop.\nReturn only the complete updated markdown plan.\nKeep the same plan structure and sections as the initial planning step.\nDo not modify files.`;
    case "review":
      return `You are reviewing the implementation on branch ${manifest.baseBranch} in the repository at ${manifest.workspacePath}.\n\nCompare it against the repository default branch:\n${manifest.repoDefaultBranch}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${followUpInstructionSection}${rulesSection}\nInspect the branch diff against ${manifest.repoDefaultBranch} and the relevant changed files, then return a markdown review with sections:\n- Verdict\n- Summary\n- Findings\n- Recommended Changes\n- Validation\n\nImportant:\n- Return only markdown.\n- In \"Verdict\", output exactly one of: approved, changes_requested.\n- If the implementation is acceptable, say approved and keep findings concise.\n- If changes are needed, explain the concrete issues and how to fix them.\n- Do not modify files.`;
    case "ask":
      return `You are answering a repository question for the branch ${manifest.baseBranch} at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nQuestion:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${followUpInstructionSection}${rulesSection}\nAnswer the question in markdown only.\nIf code snippets help, use fenced code blocks.\nDo not modify files.`;
    default:
      throw new Error(`Unsupported action: ${manifest.action}`);
  }
};

const allowedTools = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "LS",
  "Grep",
  "Glob",
  "TodoWrite",
  "Task",
  ...(providerConfigPath ? Object.keys((JSON.parse(await readFile(providerConfigPath, "utf8").catch(() => "{}"))?.mcpServers ?? {})).map((name) => `mcp__${name}`) : [])
].join(",");

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
if (manifest.resolvedMaxTurns) {
  args.push("--max-turns", String(manifest.resolvedMaxTurns));
}

const workspaceStats = await stat(manifest.workspacePath);
const runtimeIdentity = workspaceStats.uid > 0 && workspaceStats.gid > 0 ? `${workspaceStats.uid}:${workspaceStats.gid}` : "agent:agent";
const runtimeHome = path.join("/runtime", `claude-home-${runtimeIdentity.replace(/[:/]/g, "-")}`);
await mkdir(runtimeHome, { recursive: true });

console.log(`[runtime] running claude action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}`);
console.log(`[runtime] claude max_turns=${manifest.resolvedMaxTurns ?? "default"}`);
await runCommand("chown", ["-R", runtimeIdentity, runtimeHome, path.dirname(manifest.resultJsonPath)]);
console.log(`[runtime] prepared claude runtime user=${runtimeIdentity}`);

let finalMarkdown = "";
let latestTokenUsage = null;
let resultSubtype = null;
let resultDetails = null;
const assistantLines = [];
const toolBlocks = new Map();
let sawPartialAssistantText = false;
let partialTextBuffer = "";
const proc = spawn("su-exec", [runtimeIdentity, "claude", ...args], {
  env: {
    ...process.env,
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

const toTokenUsage = (usage) => {
  const inputTokens = Number.isFinite(usage?.input_tokens) ? usage.input_tokens : null;
  const outputTokens = Number.isFinite(usage?.output_tokens) ? usage.output_tokens : null;
  return {
    status: inputTokens !== null || outputTokens !== null ? "available" : "unavailable",
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    note: null
  };
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
      `Claude hit the turn limit before producing a final answer.${resultDetails ? ` ${resultDetails}` : ""} Increase the profile or max turns for this task.`
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
      const usage = rawEvent.usage
        ? ` input=${rawEvent.usage.input_tokens ?? "?"} output=${rawEvent.usage.output_tokens ?? "?"}`
        : "";
      if (rawEvent.usage) {
        latestTokenUsage = toTokenUsage(rawEvent.usage);
      }
      console.log(`[runtime] claude message_delta stop_reason=${stopReason}${usage}`);
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
      if (event.type === "system" && event.subtype === "init") {
        console.log(`[runtime] claude init model=${event.model} permissionMode=${event.permissionMode}`);
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

await writeFile(manifest.resultMarkdownPath, `${finalMarkdown}\n`, "utf8");
await writeFile(
  manifest.resultJsonPath,
  JSON.stringify(
    {
      taskType: manifest.taskType,
      status: "success",
      summaryMarkdown: finalMarkdown,
      reviewVerdict: manifest.action === "review" ? extractReviewVerdict(finalMarkdown) : null,
      changedFiles: [],
      metadata: {
        provider: manifest.provider,
        action: manifest.action,
        tokenUsage: latestTokenUsage ?? {
          status: "unavailable",
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          note: "No usage returned by Claude runtime."
        }
      }
    },
    null,
    2
  ),
  "utf8"
);

console.log("[runtime] completed");
