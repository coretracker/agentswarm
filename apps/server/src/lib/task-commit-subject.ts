import path from "node:path";

const MAX_COMMIT_SUBJECT_LENGTH = 72;
const conventionalPrefixPattern = /^(feat|fix|docs|refactor|test|chore)(\([^)]+\))?!?:\s*/i;
const genericTitlePattern = /^(do it|task|changes|update|fix|work|follow up|follow-up|cleanup|refactor|docs?|tests?)$/i;
const questionLikePattern = /^(what|why|how|when|where|who|is|are|do|does|did|can|could|would|should|whats|what's)\b/i;

type CommitType = "fix" | "feat" | "refactor" | "docs" | "test" | "chore";

function lowercaseFirstCharacter(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}

function detectScopeForPath(filePath: string): string {
  const normalized = normalizePathSeparators(filePath);

  if (/^apps\/server\//.test(normalized)) return "server";
  if (/^apps\/web\//.test(normalized)) return "web";
  if (/^packages\/shared-types\//.test(normalized)) return "shared-types";
  if (/^agent-runtime-claude\//.test(normalized)) return "claude-runtime";
  if (/^agent-runtime-codex\//.test(normalized)) return "codex-runtime";
  if (/^agent-runtime\//.test(normalized)) return "runtime";
  if (/^tools\/codex-web-terminal\//.test(normalized)) return "interactive";
  if (/^deploy\//.test(normalized) || /^docker-compose\.ya?ml$/i.test(normalized)) return "infra";

  return "repo";
}

function inferCommitScope(files: string[]): string {
  const counts = new Map<string, number>();

  for (const file of files) {
    const scope = detectScopeForPath(file);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return "repo";
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [winnerScope, winnerCount] = sorted[0]!;
  if (counts.size === 1 || winnerCount > files.length / 2) {
    return winnerScope;
  }

  return "repo";
}

function inferCommitType(taskTitle: string, files: string[]): CommitType {
  const title = taskTitle.toLowerCase();
  if (/\bfix\b|\bbug\b|\bregress|\berror\b|\bfail(?:ed|ing|s)?\b|\bwarning\b|\bmissing\b|\bbroken\b|\bpermission\b|\bdenied\b/.test(title)) {
    return "fix";
  }

  const loweredFiles = files.map((file) => normalizePathSeparators(file).toLowerCase());
  if (loweredFiles.length > 0 && loweredFiles.every((file) => file.endsWith(".md") || file.includes("/docs/"))) return "docs";
  if (loweredFiles.length > 0 && loweredFiles.every((file) => file.includes(".test.") || file.includes(".spec.") || file.includes("/test/"))) return "test";
  if (/\brefactor\b|\bcleanup\b/.test(title)) return "refactor";
  if (/\badd\b|\bimplement\b|\bfeature\b|\binteractive\b|\bsupport\b|\benable\b|\ballow\b|\bintroduce\b/.test(title)) return "feat";
  return "chore";
}

function summarizeChangedPaths(files: string[], scope: string): string {
  const unique = [...new Set(files.map((file) => normalizePathSeparators(file)).filter(Boolean))];
  if (unique.length === 0) {
    return scope === "repo" ? "update workspace" : `update ${scope}`;
  }
  if (unique.length === 1) {
    return `update ${path.basename(unique[0])}`;
  }
  if (unique.length === 2) {
    return `update ${path.basename(unique[0])} and ${path.basename(unique[1])}`;
  }
  return scope === "repo" ? `update ${unique.length} files` : `update ${scope} files`;
}

function normalizeTitleIntent(taskTitle: string): string | null {
  let cleaned = taskTitle.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(conventionalPrefixPattern, "");
  cleaned = cleaned.replace(/^\[[^\]]+\]\s*/, "");
  cleaned = cleaned.replace(/^#+\s*/, "");
  cleaned = cleaned.replace(/^please\s+/i, "");
  cleaned = cleaned.replace(/^(can|could|would)\s+you\s+/i, "");
  cleaned = cleaned.replace(/^(we need to|need to|i need to|let's|lets)\s+/i, "");
  cleaned = cleaned.replace(/^make sure\s+/i, "");
  cleaned = cleaned.replace(/\busers\s+(email|name)\b/gi, "user $1");

  const reordered = cleaned.match(
    /^for\s+(.+?)\s+(add|allow|avoid|block|create|disable|enable|fix|improve|persist|prevent|remove|rename|restore|support|update|use)\s+(.+)$/i
  );
  if (reordered) {
    cleaned = `${reordered[2]} ${reordered[3]} for ${reordered[1]}`;
  }

  cleaned = cleaned.replace(/[.?!:;,\s]+$/, "").trim();
  if (!cleaned || cleaned.length < 8 || questionLikePattern.test(cleaned) || genericTitlePattern.test(cleaned)) {
    return null;
  }

  return lowercaseFirstCharacter(cleaned);
}

export function formatCommitSubject(input: string): string {
  const cleaned = input.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_COMMIT_SUBJECT_LENGTH ? `${cleaned.slice(0, MAX_COMMIT_SUBJECT_LENGTH - 3).trimEnd()}...` : cleaned;
}

export function buildTaskCommitSubject(taskTitle: string, files: string[]): string {
  const scope = inferCommitScope(files);
  const type = inferCommitType(taskTitle, files);
  const intent = normalizeTitleIntent(taskTitle);
  const summary = intent ?? summarizeChangedPaths(files, scope);
  return formatCommitSubject(`${type}(${scope}): ${summary}`);
}
