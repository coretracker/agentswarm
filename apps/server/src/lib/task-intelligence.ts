import type { TaskComplexity, TaskReviewVerdict } from "@agentswarm/shared-types";

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

export function classifyTaskComplexity(title: string, requirements: string): TaskComplexity {
  const normalized = `${title}\n${requirements}`.trim();
  const length = normalized.length;
  const bulletCount = collectBulletLines(requirements, 50).length;
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

export function buildExecutionSummaryFromRequirements(title: string, requirements: string): string {
  const lines = collectBulletLines(requirements, 8);
  const pathMatches = Array.from(new Set(requirements.match(pathPattern) ?? [])).slice(0, 6);

  const sections = [
    `# Execution Summary`,
    ``,
    `## Goal`,
    `- ${title.trim()}`,
    ``,
    `## Requirements`,
    ...(lines.length > 0 ? lines.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`) : ["- No additional requirements provided."])
  ];

  if (pathMatches.length > 0) {
    sections.push("", "## Candidate Files", ...pathMatches.map((item) => `- ${item}`));
  }

  return sections.join("\n").trim();
}

function extractSection(markdown: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`(?:^|\\n)#{1,6}\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "i"));
  if (!match) {
    return [];
  }

  return collectBulletLines(match[1], 8).map((line) => line.replace(/^[-*]\s*/, ""));
}

function extractFirstMatchingSection(markdown: string, headings: string[]): string[] {
  for (const heading of headings) {
    const lines = extractSection(markdown, heading);
    if (lines.length > 0) {
      return lines;
    }
  }

  return [];
}

export function buildExecutionSummaryFromPlan(planMarkdown: string): string {
  const overview = extractFirstMatchingSection(planMarkdown, ["Overview", "Goal"]);
  const repoFindings = extractSection(planMarkdown, "Repo Findings");
  const files = extractSection(planMarkdown, "Files To Change");
  const steps = extractSection(planMarkdown, "Implementation Steps");
  const validation = extractSection(planMarkdown, "Validation");
  const outcome = extractSection(planMarkdown, "Expected Outcome");
  const combinedOverview = overview.length > 0 ? overview : outcome;

  const sections = [
    `# Execution Summary`,
    ``,
    `## Overview`,
    ...(combinedOverview.length > 0 ? combinedOverview.map((line) => `- ${line}`) : ["- Use the approved plan context."]),
    ``,
    `## Files To Change`,
    ...(files.length > 0 ? files.map((line) => `- ${line}`) : ["- Determine affected files from the approved plan."]),
    ``,
    `## Implementation Steps`,
    ...(steps.length > 0 ? steps.map((line) => `- ${line}`) : ["- Implement the requested change with the minimum necessary edits."])
  ];

  if (repoFindings.length > 0) {
    sections.push("", "## Repo Findings", ...repoFindings.slice(0, 4).map((line) => `- ${line}`));
  }

  if (validation.length > 0) {
    sections.push("", "## Validation", ...validation.map((line) => `- ${line}`));
  }

  return sections.join("\n").trim();
}

export function extractReviewVerdict(markdown: string): TaskReviewVerdict | null {
  const verdictLines = extractSection(markdown, "Verdict");
  const candidate = verdictLines[0]?.toLowerCase().replace(/[`*_]/g, "").trim();

  if (!candidate) {
    return null;
  }

  if (candidate.includes("changes_requested") || candidate.includes("changes requested")) {
    return "changes_requested";
  }

  if (candidate.includes("approved") || candidate.includes("all good")) {
    return "approved";
  }

  return null;
}
