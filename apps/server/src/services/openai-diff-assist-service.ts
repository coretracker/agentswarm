import { access } from "node:fs/promises";
import path from "node:path";
import type { OpenAiDiffAssistResult, ProviderProfile } from "@agentswarm/shared-types";
import { env } from "../config/env.js";
import { codexReasoningEffortForProfile } from "../lib/provider-config.js";
import { readSafeWorkspaceFile, writeSafeWorkspaceFile } from "../lib/safe-workspace-file.js";

const MAX_SNIPPET = 48_000;
const MAX_USER_PROMPT = 16_000;
const MAX_FILE_IN_PROMPT = 120_000;
const MAX_AGENT_RULES = 8_000;

function openAiChatBase(openaiBaseUrl: string | null): string {
  return (openaiBaseUrl?.replace(/\/$/, "") ?? "https://api.openai.com") + "/v1";
}

export function normalizeDiffFilePath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, "/");
  if (p.startsWith("a/") || p.startsWith("b/")) {
    p = p.slice(2);
  }
  return p.replace(/^\/+/, "");
}

function extractCompletionText(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = d.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

async function postChatCompletions(
  base: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, message: raw.slice(0, 2000) };
  }
  try {
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 502, message: "Invalid JSON from OpenAI" };
  }
}

async function chatReadWithRetries(
  base: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  reasoningEffort: string
): Promise<unknown> {
  let lastError = "OpenAI request failed";
  for (const useReasoning of [true, false]) {
    const body: Record<string, unknown> = { model, messages };
    if (useReasoning) {
      body.reasoning_effort = reasoningEffort;
    }
    const result = await postChatCompletions(base, apiKey, body);
    if (result.ok) {
      return result.data;
    }
    lastError = result.message;
    if (result.status !== 400) {
      break;
    }
  }
  throw Object.assign(new Error(lastError), { status: 502 });
}

async function chatReadWriteWithRetries(
  base: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  reasoningEffort: string
): Promise<unknown> {
  const order: Array<{ reasoning: boolean; jsonObject: boolean }> = [
    { reasoning: true, jsonObject: true },
    { reasoning: false, jsonObject: true },
    { reasoning: false, jsonObject: false }
  ];

  let lastError = "OpenAI request failed";

  for (const opts of order) {
    const body: Record<string, unknown> = { model, messages };
    if (opts.reasoning) {
      body.reasoning_effort = reasoningEffort;
    }
    if (opts.jsonObject) {
      body.response_format = { type: "json_object" };
    }
    const result = await postChatCompletions(base, apiKey, body);
    if (result.ok) {
      return result.data;
    }
    lastError = result.message;
    if (result.status !== 400) {
      break;
    }
  }

  throw Object.assign(new Error(lastError), { status: 502 });
}

function parseJsonFromModel(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body) as unknown;
}

export async function executeOpenAiDiffAssist(input: {
  mode: "read" | "readwrite";
  taskId: string;
  model: string;
  providerProfile: ProviderProfile;
  userPrompt: string;
  filePath: string;
  selectedSnippet: string;
  openaiApiKey: string;
  openaiBaseUrl: string | null;
  agentRules: string;
}): Promise<OpenAiDiffAssistResult> {
  const relativePath = normalizeDiffFilePath(input.filePath);
  if (!relativePath) {
    throw Object.assign(new Error("Invalid file path."), { status: 400 });
  }

  const workspaceRoot = path.join(env.TASK_WORKSPACE_ROOT, input.taskId);
  try {
    await access(workspaceRoot);
  } catch {
    throw Object.assign(new Error("No local workspace for this task."), { status: 409 });
  }

  const reasoningEffort = codexReasoningEffortForProfile(input.providerProfile);
  const base = openAiChatBase(input.openaiBaseUrl);
  const currentFile = await readSafeWorkspaceFile(workspaceRoot, relativePath);
  const snippet = input.selectedSnippet.slice(0, MAX_SNIPPET);
  const userPrompt = input.userPrompt.trim().slice(0, MAX_USER_PROMPT);

  const rulesBlock =
    input.agentRules.trim().length > 0
      ? `Additional rules from workspace settings (follow when relevant):\n${input.agentRules.trim().slice(0, MAX_AGENT_RULES)}\n\n`
      : "";

  const contextParts = [
    `File path (repository-relative): ${relativePath}`,
    "",
    "Selected diff lines (unified diff excerpt):",
    "```",
    snippet,
    "```",
    "",
    currentFile !== null
      ? "Current file contents in the task workspace:\n```\n" + currentFile.slice(0, MAX_FILE_IN_PROMPT) + "\n```"
      : "(File is not present in the workspace yet, or could not be read.)",
    "",
    "User request:",
    userPrompt
  ];

  if (input.mode === "read") {
    const userContent = contextParts.join("\n");
    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content:
          "You are a careful code assistant. Answer using the provided context. Be concise and accurate."
      },
      { role: "user", content: rulesBlock + userContent }
    ];

    const data = await chatReadWithRetries(base, input.openaiApiKey, input.model, messages, reasoningEffort);

    return { mode: "read", text: extractCompletionText(data) };
  }

  const userContent = [
    `You must respond with a single JSON object only (no markdown fences). Keys: "explanation" (string) and "content" (string, the complete new file contents).`,
    ...contextParts
  ].join("\n");

  const messages: Array<{ role: string; content: string }> = [
    {
      role: "system",
      content:
        "You are an expert developer. Output only valid JSON with keys explanation and content. The content field must be the entire new file as UTF-8 text."
    },
    { role: "user", content: rulesBlock + userContent }
  ];

  const data = await chatReadWriteWithRetries(base, input.openaiApiKey, input.model, messages, reasoningEffort);

  const rawText = extractCompletionText(data);
  let parsed: { explanation?: unknown; content?: unknown };
  try {
    parsed = parseJsonFromModel(rawText) as { explanation?: unknown; content?: unknown };
  } catch {
    throw Object.assign(new Error("Model did not return valid JSON."), { status: 502 });
  }

  const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
  const content = typeof parsed.content === "string" ? parsed.content : "";

  if (!content) {
    throw Object.assign(new Error("Model JSON missing content."), { status: 502 });
  }

  const wrote = await writeSafeWorkspaceFile(workspaceRoot, relativePath, content);
  if (!wrote) {
    throw Object.assign(new Error("Refused unsafe file path for write."), { status: 400 });
  }

  return { mode: "readwrite", explanation, appliedRelativePath: relativePath };
}
