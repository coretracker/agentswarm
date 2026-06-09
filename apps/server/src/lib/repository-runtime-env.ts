import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepositoryRuntimeEnvEntry } from "../services/repository-store.js";
import { RepositoryEnvFileStore } from "../services/repository-env-file-store.js";

const FILE_NAME_SAFE_PATTERN = /[^A-Za-z0-9._-]+/g;

const sanitizeFileName = (value: string): string => {
  const normalized = value.trim().replace(FILE_NAME_SAFE_PATTERN, "-").replace(/-+/g, "-").replace(/^\.+/, "");
  return normalized.length > 0 ? normalized.slice(0, 120) : "env-file.bin";
};

export const materializeRepositoryRuntimeEnvEntries = async (options: {
  destinationDir: string;
  entries: RepositoryRuntimeEnvEntry[];
  fileStore: RepositoryEnvFileStore;
}): Promise<Array<[string, string]>> => {
  await mkdir(options.destinationDir, { recursive: true, mode: 0o700 });
  await chmod(options.destinationDir, 0o700).catch(() => undefined);

  const envEntries: Array<[string, string]> = [];
  for (let index = 0; index < options.entries.length; index += 1) {
    const entry = options.entries[index]!;
    if (entry.type === "text") {
      envEntries.push([entry.key, entry.value]);
      continue;
    }

    const content = await options.fileStore.readFile(entry.fileId);
    if (!content) {
      throw new Error(`File-backed value for ${entry.key} is unavailable. Upload the file again in repository settings.`);
    }

    const fileName = sanitizeFileName(entry.fileName);
    const filePath = path.join(options.destinationDir, `${String(index + 1).padStart(3, "0")}-${fileName}`);
    await writeFile(filePath, content, { mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => undefined);
    envEntries.push([entry.key, filePath]);
  }

  return envEntries;
};

