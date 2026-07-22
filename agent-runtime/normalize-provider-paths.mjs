import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeHome = process.argv[2]?.trim() || "/home/agent";
const providerRoots = [path.join(runtimeHome, ".claude"), path.join(runtimeHome, ".codex")];
const unixProviderPathPattern = /(?:\/[^/\s"'`]+)+\/\.(claude|codex)(?=\/|\s|["'`]|$)/g;
const windowsProviderPathPattern = /[A-Za-z]:(?:\\+[^\\\s"'`]+)+\\+\.(claude|codex)(?=\\|\s|["'`]|$)/g;

const files = [];
const pending = [...providerRoots];
while (pending.length > 0) {
  const current = pending.pop();
  const entries = current ? await readdir(current, { withFileTypes: true }).catch(() => []) : [];
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      pending.push(entryPath);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
}

const claudeSidecarConfig = path.join(runtimeHome, ".claude.json");
if ((await stat(claudeSidecarConfig).catch(() => null))?.isFile()) {
  files.push(claudeSidecarConfig);
}

let normalizedFileCount = 0;
let normalizedPathCount = 0;
for (const filePath of files) {
  const content = await readFile(filePath).catch(() => null);
  if (!content || content.includes(0)) {
    continue;
  }

  const raw = content.toString("utf8");
  let filePathCount = 0;
  const replaceProviderRoot = (_match, providerName) => {
    filePathCount += 1;
    return path.join(runtimeHome, `.${providerName}`);
  };
  const normalized = raw
    .replace(unixProviderPathPattern, replaceProviderRoot)
    .replace(windowsProviderPathPattern, replaceProviderRoot);

  if (filePathCount > 0 && normalized !== raw) {
    await writeFile(filePath, normalized, "utf8");
    normalizedFileCount += 1;
    normalizedPathCount += filePathCount;
  }
}

if (normalizedPathCount > 0) {
  console.log(`[runtime] normalized ${normalizedPathCount} provider path(s) in ${normalizedFileCount} text file(s)`);
}
