#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/check-docs.sh" "$@"

cd "$REPO_ROOT"

DOC_STALE_DAYS="${DOC_STALE_DAYS:-180}"

DOC_FILES=()
for fixed in README.md AGENTS.md ARCHITECTURE.md .github/pull_request_template.md; do
  if [[ -f "$fixed" ]]; then
    DOC_FILES+=("$fixed")
  fi
done

while IFS= read -r file; do
  DOC_FILES+=("$file")
done < <(find docs -type f -name '*.md' | sort)

if [[ "${#DOC_FILES[@]}" -eq 0 ]]; then
  echo "[harness:check-docs] warning: no documentation files found"
  exit 0
fi

echo "[harness:check-docs] repo root: $REPO_ROOT"
echo "[harness:check-docs] scanning ${#DOC_FILES[@]} markdown files"
echo "[harness:check-docs] stale threshold: ${DOC_STALE_DAYS} days"

node - "$REPO_ROOT" "$DOC_STALE_DAYS" "${DOC_FILES[@]}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.argv[2];
const staleDays = Number(process.argv[3]);
const files = process.argv.slice(4);

const now = new Date();
const oneDayMs = 24 * 60 * 60 * 1000;
const staleThresholdMs = Number.isFinite(staleDays) && staleDays > 0 ? staleDays * oneDayMs : 180 * oneDayMs;

const skippedSchemes = ["http://", "https://", "mailto:", "tel:", "data:", "javascript:"];

const brokenLinks = [];
const staleReviewed = [];
const invalidReviewed = [];
const todoCounts = [];

const existsAsFileOrDir = (targetPath) => {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveCandidate = (docFile, target) => {
  if (target.startsWith("/")) {
    return path.join(repoRoot, target.replace(/^\/+/, ""));
  }
  return path.resolve(path.dirname(docFile), target);
};

for (const relFile of files) {
  const absFile = path.join(repoRoot, relFile);
  let content = "";
  try {
    content = fs.readFileSync(absFile, "utf8");
  } catch {
    continue;
  }

  const todoMatches = content.match(/\b(TODO|FIXME)\b/g);
  todoCounts.push({ file: relFile, count: todoMatches ? todoMatches.length : 0 });

  const reviewRegex = /(?:^|\n)\s*(?:last\s*reviewed|last\s*review|reviewed\s*on|last_reviewed)\s*[:|-]\s*(\d{4}-\d{2}-\d{2})/gi;
  let reviewMatch;
  while ((reviewMatch = reviewRegex.exec(content)) !== null) {
    const rawDate = reviewMatch[1];
    const reviewedAt = new Date(`${rawDate}T00:00:00Z`);
    if (Number.isNaN(reviewedAt.getTime())) {
      invalidReviewed.push({ file: relFile, value: rawDate });
      continue;
    }
    const ageMs = now.getTime() - reviewedAt.getTime();
    if (ageMs > staleThresholdMs) {
      staleReviewed.push({ file: relFile, value: rawDate, ageDays: Math.floor(ageMs / oneDayMs) });
    }
  }

  const markdownLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
  let linkMatch;
  while ((linkMatch = markdownLinkRegex.exec(content)) !== null) {
    const rawHref = (linkMatch[1] || "").trim();
    if (!rawHref) continue;

    let href = rawHref;
    if (href.startsWith("<") && href.endsWith(">")) {
      href = href.slice(1, -1).trim();
    }
    if (!href) continue;

    if (skippedSchemes.some((prefix) => href.toLowerCase().startsWith(prefix))) {
      continue;
    }

    if (href.startsWith("#")) {
      continue;
    }

    href = href.split(/\s+/)[0];
    const [targetPath] = href.split("#");

    if (!targetPath || targetPath.startsWith("#")) {
      continue;
    }

    const resolved = resolveCandidate(absFile, targetPath);

    if (existsAsFileOrDir(resolved)) {
      continue;
    }

    // If extension omitted, allow markdown fallback.
    if (!path.extname(resolved)) {
      if (existsAsFileOrDir(`${resolved}.md`)) {
        continue;
      }
      if (existsAsFileOrDir(path.join(resolved, "index.md"))) {
        continue;
      }
    }

    brokenLinks.push({
      file: relFile,
      href: rawHref,
      resolved: path.relative(repoRoot, resolved) || "."
    });
  }
}

const totalTodo = todoCounts.reduce((sum, item) => sum + item.count, 0);
const filesWithTodo = todoCounts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);

console.log("[harness:check-docs] summary");
console.log(`[harness:check-docs] - broken internal links: ${brokenLinks.length}`);
console.log(`[harness:check-docs] - TODO/FIXME total: ${totalTodo}`);
console.log(`[harness:check-docs] - files with TODO/FIXME: ${filesWithTodo.length}`);
console.log(`[harness:check-docs] - stale 'last reviewed' entries: ${staleReviewed.length}`);
console.log(`[harness:check-docs] - invalid 'last reviewed' entries: ${invalidReviewed.length}`);

if (filesWithTodo.length > 0) {
  console.log("[harness:check-docs] top TODO/FIXME files:");
  for (const item of filesWithTodo.slice(0, 10)) {
    console.log(`[harness:check-docs]   ${item.file}: ${item.count}`);
  }
}

if (staleReviewed.length > 0) {
  console.log("[harness:check-docs] warnings: stale review metadata detected");
  for (const item of staleReviewed.slice(0, 20)) {
    console.log(`[harness:check-docs]   ${item.file}: ${item.value} (${item.ageDays} days old)`);
  }
}

if (invalidReviewed.length > 0) {
  console.log("[harness:check-docs] warnings: invalid review metadata detected");
  for (const item of invalidReviewed.slice(0, 20)) {
    console.log(`[harness:check-docs]   ${item.file}: ${item.value}`);
  }
}

if (brokenLinks.length > 0) {
  console.error("[harness:check-docs] error: broken internal links found");
  for (const item of brokenLinks.slice(0, 100)) {
    console.error(`[harness:check-docs]   ${item.file}: ${item.href} -> ${item.resolved}`);
  }
  process.exit(1);
}

console.log("[harness:check-docs] docs check passed (no broken internal links)");
NODE
