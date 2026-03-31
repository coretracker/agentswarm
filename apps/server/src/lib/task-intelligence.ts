import type { TaskComplexity } from "@agentswarm/shared-types";

const pathPattern = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g;
const complexityKeywords = /(refactor|migrate|architecture|redis|docker|socket|websocket|backend|frontend|database|queue|worker|concurrency|stream|realtime|multi[- ]step|full stack|end[- ]to[- ]end)/i;
const trivialKeywords = /(readme|copy|rename|wording|typo|text only|single file|small change|minor)/i;

const normalizeWhitespace = (value: string): string => value.replace(/\r\n?/g, "\n").trim();

const collectBulletLines = (text: string, maxItems: number): string[] =>
  normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxItems);

export function classifyTaskComplexity(title: string, prompt: string): TaskComplexity {
  const normalized = `${title}\n${prompt}`.trim();
  const length = normalized.length;
  const bulletCount = collectBulletLines(prompt, 50).length;
  const pathMatches = normalized.match(pathPattern)?.length ?? 0;
  const areaMentions = [
    /frontend/i.test(normalized),
    /backend/i.test(normalized),
    /database|redis|sql/i.test(normalized),
    /docker|deploy|infra/i.test(normalized),
    /test|lint|build/i.test(normalized)
  ].filter(Boolean).length;

  let score = 0;

  if (length > 700) {
    score += 3;
  } else if (length > 320) {
    score += 1;
  }

  if (bulletCount >= 8) {
    score += 2;
  } else if (bulletCount >= 4) {
    score += 1;
  }

  if (pathMatches >= 3) {
    score += 2;
  } else if (pathMatches >= 1) {
    score += 1;
  }

  if (areaMentions >= 3) {
    score += 2;
  } else if (areaMentions >= 2) {
    score += 1;
  }

  if (complexityKeywords.test(normalized)) {
    score += 2;
  }

  if (trivialKeywords.test(normalized) && length < 260) {
    score -= 2;
  }

  if (score <= 0) {
    return "trivial";
  }

  if (score >= 5) {
    return "complex";
  }

  return "normal";
}

export function buildExecutionSummaryFromPrompt(title: string, prompt: string): string {
  const lines = collectBulletLines(prompt, 8);
  const pathMatches = Array.from(new Set(prompt.match(pathPattern) ?? [])).slice(0, 6);

  const sections = [
    `# Execution Summary`,
    ``,
    `## Goal`,
    `- ${title.trim()}`,
    ``,
    `## Prompt`,
    ...(lines.length > 0 ? lines.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`) : ["- No additional prompt details provided."])
  ];

  if (pathMatches.length > 0) {
    sections.push("", "## Candidate Files", ...pathMatches.map((item) => `- ${item}`));
  }

  return sections.join("\n").trim();
}
