import { parseDiff, type FileData } from "react-diff-view";

const FILE_HEADER_PATTERN = /^diff --git a\/(.+?) b\/(.+)$/;
const FULL_HUNK_HEADER_PATTERN = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@(.*)$/;
const IMAGE_FILE_EXTENSION_PATTERN = /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

function isDiffBodyStart(line: string): boolean {
  if (line.startsWith("@@")) {
    return true;
  }

  // Treat actual file markers as metadata, not body lines.
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return false;
  }

  return /^[ +\\-]/.test(line);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function countHunkLines(lines: string[]): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;

  for (const line of lines) {
    if (line.startsWith("+")) {
      newCount += 1;
      continue;
    }

    if (line.startsWith("-")) {
      oldCount += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      oldCount += 1;
      newCount += 1;
    }
  }

  return { oldCount, newCount };
}

function normalizeHunks(lines: string[]): string[] {
  const normalized: string[] = [];
  let index = 0;
  let currentOldLine = 1;
  let currentNewLine = 1;

  while (index < lines.length) {
    const currentLine = lines[index];

    if (currentLine.startsWith("@@")) {
      const header = currentLine;
      index += 1;

      const body: string[] = [];
      while (index < lines.length && !lines[index].startsWith("@@")) {
        body.push(lines[index]);
        index += 1;
      }

      const explicitHeaderMatch = header.match(FULL_HUNK_HEADER_PATTERN);
      if (explicitHeaderMatch) {
        const oldStart = Number.parseInt(explicitHeaderMatch[1], 10);
        const oldCount = Number.parseInt(explicitHeaderMatch[2] ?? "1", 10);
        const newStart = Number.parseInt(explicitHeaderMatch[3], 10);
        const newCount = Number.parseInt(explicitHeaderMatch[4] ?? "1", 10);

        normalized.push(header, ...body);
        currentOldLine = oldStart + oldCount;
        currentNewLine = newStart + newCount;
        continue;
      }

      const { oldCount, newCount } = countHunkLines(body);
      const suffix = header.replace(/^@@\s*/, "").trim();
      normalized.push(
        `@@ -${currentOldLine},${Math.max(oldCount, 1)} +${currentNewLine},${Math.max(newCount, 1)} @@${suffix ? ` ${suffix}` : ""}`,
        ...body
      );
      currentOldLine += oldCount;
      currentNewLine += newCount;
      continue;
    }

    if (/^[ +\\-]/.test(currentLine)) {
      const body: string[] = [];
      while (index < lines.length && !lines[index].startsWith("@@")) {
        body.push(lines[index]);
        index += 1;
      }

      const { oldCount, newCount } = countHunkLines(body);
      normalized.push(`@@ -${currentOldLine},${Math.max(oldCount, 1)} +${currentNewLine},${Math.max(newCount, 1)} @@`, ...body);
      currentOldLine += oldCount;
      currentNewLine += newCount;
      continue;
    }

    normalized.push(currentLine);
    index += 1;
  }

  return normalized;
}

function normalizeFileBlock(block: string): string {
  const lines = block.split("\n");
  const fileHeaderMatch = lines[0]?.match(FILE_HEADER_PATTERN);

  if (!fileHeaderMatch) {
    return block;
  }

  const [, oldPath, newPath] = fileHeaderMatch;
  const metadataLines: string[] = [];
  const diffLines: string[] = [];
  let hasOldPathMarker = false;
  let hasNewPathMarker = false;
  let readingDiffBody = false;

  for (const line of lines.slice(1)) {
    if (!readingDiffBody && isDiffBodyStart(line)) {
      readingDiffBody = true;
    }

    if (readingDiffBody) {
      diffLines.push(line);
      continue;
    }

    if (line.startsWith("--- ")) {
      hasOldPathMarker = true;
    } else if (line.startsWith("+++ ")) {
      hasNewPathMarker = true;
    }

    metadataLines.push(line);
  }

  return [
    lines[0],
    ...metadataLines,
    ...(hasOldPathMarker ? [] : [`--- a/${oldPath}`]),
    ...(hasNewPathMarker ? [] : [`+++ b/${newPath}`]),
    ...normalizeHunks(diffLines)
  ].join("\n");
}

export function normalizeDiffForRendering(diffText: string): string {
  const normalized = normalizeLineEndings(diffText);

  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [line];
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks.map((block) => normalizeFileBlock(block.join("\n"))).join("\n");
}

export function parseRenderableDiff(diffText: string): FileData[] {
  const normalized = normalizeDiffForRendering(diffText);

  if (!normalized) {
    return [];
  }

  return parseDiff(normalized);
}

export function isImageDiffPath(filePath: string): boolean {
  return IMAGE_FILE_EXTENSION_PATTERN.test(filePath.trim());
}
