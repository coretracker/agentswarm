#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
process.chdir(repoRoot);
const DOC_PATH = "docs/architecture/boundaries.md";

const sourceRoots = [
  path.join(repoRoot, "apps"),
  path.join(repoRoot, "packages")
];

const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

const importPatterns = [
  /import\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
  /export\s+[^"']*?\s+from\s+["']([^"']+)["']/g,
  /require\(\s*["']([^"']+)["']\s*\)/g,
  /import\(\s*["']([^"']+)["']\s*\)/g
];

const toPosix = (value) => value.split(path.sep).join("/");

const isInside = (candidate, root) => {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const classifyFile = (filePath) => {
  const normalized = toPosix(filePath);
  if (normalized.includes("/apps/web/")) {
    return "web";
  }
  if (normalized.includes("/apps/server/")) {
    return "server";
  }
  if (normalized.includes("/packages/shared-types/")) {
    return "shared-types";
  }
  if (normalized.includes("/apps/")) {
    return "app-other";
  }
  if (normalized.includes("/packages/")) {
    return "package-other";
  }
  return "other";
};

const createViolation = ({ filePath, specifier, rule, why, fix }) => ({
  filePath,
  specifier,
  rule,
  why,
  fix,
  doc: DOC_PATH
});

const shouldScanFile = (filePath) => {
  const ext = path.extname(filePath);
  if (!allowedExtensions.has(ext)) {
    return false;
  }

  const normalized = toPosix(filePath);
  return !normalized.includes("/node_modules/") && !normalized.includes("/.next/") && !normalized.includes("/dist/");
};

const walkFiles = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && shouldScanFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
};

const collectSpecifiers = (content) => {
  const specifiers = [];
  for (const pattern of importPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
};

const analyzeImport = ({ filePath, fileKind, specifier }) => {
  const violations = [];

  if (specifier.startsWith("@verft/shared-types/")) {
    violations.push(
      createViolation({
        filePath,
        specifier,
        rule: "Do not deep-import from @verft/shared-types.",
        why: "Deep imports bypass the package boundary and can break when internals change.",
        fix: "Import from @verft/shared-types root export instead."
      })
    );
    return violations;
  }

  const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
  if (!isRelative) {
    return violations;
  }

  const resolvedPath = path.resolve(path.dirname(filePath), specifier);

  const pointsToWeb = isInside(resolvedPath, path.join(repoRoot, "apps", "web"));
  const pointsToServer = isInside(resolvedPath, path.join(repoRoot, "apps", "server"));
  const pointsToSharedTypes = isInside(resolvedPath, path.join(repoRoot, "packages", "shared-types"));
  const pointsToApps = isInside(resolvedPath, path.join(repoRoot, "apps"));

  if (fileKind === "web" && pointsToServer) {
    violations.push(
      createViolation({
        filePath,
        specifier,
        rule: "Web code must not import server code.",
        why: "The browser app and backend runtime are separate deploy units.",
        fix: "Move shared logic into packages/shared-types or call server APIs instead."
      })
    );
  }

  if (fileKind === "server" && pointsToWeb) {
    violations.push(
      createViolation({
        filePath,
        specifier,
        rule: "Server code must not import web code.",
        why: "Backend services must stay independent from UI implementation details.",
        fix: "Move shared data contracts to packages/shared-types or keep logic in server modules."
      })
    );
  }

  if (fileKind === "shared-types" && pointsToApps) {
    violations.push(
      createViolation({
        filePath,
        specifier,
        rule: "packages/shared-types must not import from apps.",
        why: "Shared contracts should be dependency-free and usable by both app layers.",
        fix: "Keep shared-types self-contained and move app-specific logic out of this package."
      })
    );
  }

  if ((fileKind === "web" || fileKind === "server") && pointsToSharedTypes && specifier.startsWith(".")) {
    violations.push(
      createViolation({
        filePath,
        specifier,
        rule: "Apps must import shared-types via package name, not filesystem paths.",
        why: "Package imports preserve clear boundaries and stable public exports.",
        fix: "Replace relative path import with @verft/shared-types."
      })
    );
  }

  return violations;
};

const main = async () => {
  const allFiles = [];
  for (const root of sourceRoots) {
    try {
      allFiles.push(...(await walkFiles(root)));
    } catch {
      // Ignore missing roots.
    }
  }

  const violations = [];

  for (const filePath of allFiles) {
    const fileKind = classifyFile(filePath);
    const content = await fs.readFile(filePath, "utf8");
    const specifiers = collectSpecifiers(content);
    for (const specifier of specifiers) {
      violations.push(...analyzeImport({ filePath, fileKind, specifier }));
    }
  }

  if (violations.length === 0) {
    console.log("[boundary-check] OK: no boundary violations found.");
    return;
  }

  console.error(`[boundary-check] Found ${violations.length} boundary violation(s).`);
  for (const [index, violation] of violations.entries()) {
    const relFile = toPosix(path.relative(repoRoot, violation.filePath));
    console.error(`\nViolation ${index + 1}: ${relFile} -> ${violation.specifier}`);
    console.error(`1. Rule broken: ${violation.rule}`);
    console.error(`2. Why this rule exists: ${violation.why}`);
    console.error(`3. How to fix: ${violation.fix}`);
    console.error(`4. Read this doc: ${violation.doc}`);
  }

  process.exit(1);
};

await main();
