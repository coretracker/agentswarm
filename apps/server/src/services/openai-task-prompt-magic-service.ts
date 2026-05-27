import type { TaskPromptMagicResult } from "@agentswarm/shared-types";

const MAX_USER_PROMPT = 16_000;
const SYSTEM_PROMPT_TEMPLATE = `You are an expert prompt editor for software engineering tasks.
Rewrite the user request into a clear, execution-ready task prompt for an autonomous coding agent.

Requirements:
- Preserve intent and constraints.
- Make it specific and actionable.
- Include acceptance criteria when implied.
- Avoid changing requested scope.
- Return plain text only, no markdown fences.

User request:
{{user_request}}
`;

function openAiChatBase(openaiBaseUrl: string | null): string {
  return (openaiBaseUrl?.replace(/\/$/, "") ?? "https://api.openai.com") + "/v1";
}

function extractCompletionText(data: unknown): string {
  const payload = data as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

async function postChatCompletions(
  base: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, message: raw.slice(0, 2000) };
  }

  try {
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 502, message: "Invalid JSON from OpenAI" };
  }
}

export async function executeTaskPromptMagic(input: {
  prompt: string;
  openaiApiKey: string;
  openaiBaseUrl: string | null;
}): Promise<TaskPromptMagicResult> {
  const userPrompt = input.prompt.trim().slice(0, MAX_USER_PROMPT);
  if (!userPrompt) {
    throw Object.assign(new Error("Prompt is required."), { status: 400 });
  }

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{{user_request}}", userPrompt);
  const base = openAiChatBase(input.openaiBaseUrl);

  const response = await postChatCompletions(base, input.openaiApiKey, {
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  if (!response.ok) {
    throw Object.assign(new Error(response.message || "OpenAI request failed"), { status: 502 });
  }

  const generatedPrompt = extractCompletionText(response.data);
  if (!generatedPrompt) {
    throw Object.assign(new Error("Magic prompt generation returned empty output."), { status: 502 });
  }

  return { prompt: generatedPrompt };
}
