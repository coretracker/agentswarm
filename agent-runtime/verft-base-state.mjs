import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_ROOT = "/verft-base";

const pathExists = async (targetPath) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const copyIfExists = async (source, target) => {
  if (!(await pathExists(source))) {
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true, dereference: false });
};

// Cleanly replace the destination before copying so stale files (and their
// stale ownership/permissions from a previous task run on a persisted home)
// cannot linger and break the provider. Mirrors the interactive terminal's
// `rm -rf … && cp -a …` behaviour. Used for the plugins cache, which Claude
// stores as git clones with read-only objects that must remain owned by and
// writable to the agent user.
const replaceDirIfExists = async (source, target) => {
  if (!(await pathExists(source))) {
    return;
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true, dereference: false });
};

const removeManagedCodexMcpBlocks = (content) => {
  const lines = content.split(/\r?\n/);
  const kept = [];
  let skipping = false;

  for (const line of lines) {
    const table = line.trim().match(/^\[([^\]]+)\]$/);
    if (table) {
      skipping = table[1] === "mcp_servers.verft" || table[1] === "mcp_servers.verft.env";
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join("\n").replace(/\s+$/, "");
};

const readOptional = async (filePath) => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
};

const writeMergedCodexConfig = async (targetPath, generatedConfig) => {
  const baseConfig = removeManagedCodexMcpBlocks(await readOptional(targetPath));
  const generated = generatedConfig.trim();
  const merged = [baseConfig, generated].filter(Boolean).join("\n\n");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${merged.trim()}\n`, "utf8");
};

export async function importVerftBaseState({ provider, homeDir, generatedConfig }) {
  const baseRoot = process.env.VERFT_BASE_ROOT?.trim() || DEFAULT_BASE_ROOT;
  const providerRoot = path.join(baseRoot, provider);
  const providerDir = path.join(homeDir, provider === "claude" ? ".claude" : ".codex");

  await mkdir(providerDir, { recursive: true });

  if (provider === "codex") {
    await copyIfExists(path.join(providerRoot, "auth.json"), path.join(providerDir, "auth.json"));
    await copyIfExists(path.join(providerRoot, "skills"), path.join(providerDir, "skills"));
    await copyIfExists(path.join(providerRoot, ".tmp"), path.join(providerDir, ".tmp"));
    await replaceDirIfExists(path.join(providerRoot, "plugins"), path.join(providerDir, "plugins"));
    await copyIfExists(path.join(providerRoot, "config.toml"), path.join(providerDir, "config.toml"));
    await writeMergedCodexConfig(path.join(providerDir, "config.toml"), generatedConfig ?? "");
    return;
  }

  await copyIfExists(path.join(providerRoot, ".credentials.json"), path.join(providerDir, ".credentials.json"));
  await copyIfExists(path.join(providerRoot, "settings.json"), path.join(providerDir, "settings.json"));
  await replaceDirIfExists(path.join(providerRoot, "plugins"), path.join(providerDir, "plugins"));
  await copyIfExists(path.join(providerRoot, ".claude.json"), path.join(homeDir, ".claude.json"));
  if (generatedConfig !== undefined) {
    await writeFile(path.join(providerDir, "mcp-config.json"), generatedConfig, "utf8");
  }
};

export async function exportVerftBaseState({ provider, homeDir }) {
  const baseRoot = process.env.VERFT_BASE_ROOT?.trim() || DEFAULT_BASE_ROOT;
  const providerRoot = path.join(baseRoot, provider);
  const providerDir = path.join(homeDir, provider === "claude" ? ".claude" : ".codex");

  if (!(await pathExists(providerDir))) {
    return;
  }

  await mkdir(providerRoot, { recursive: true });

  if (provider === "codex") {
    await copyIfExists(path.join(providerDir, "auth.json"), path.join(providerRoot, "auth.json"));
    await copyIfExists(path.join(providerDir, "config.toml"), path.join(providerRoot, "config.toml"));
    await copyIfExists(path.join(providerDir, "skills"), path.join(providerRoot, "skills"));
    await copyIfExists(path.join(providerDir, ".tmp"), path.join(providerRoot, ".tmp"));
    await copyIfExists(path.join(providerDir, "plugins"), path.join(providerRoot, "plugins"));
    return;
  }

  await copyIfExists(path.join(providerDir, ".credentials.json"), path.join(providerRoot, ".credentials.json"));
  await copyIfExists(path.join(providerDir, "settings.json"), path.join(providerRoot, "settings.json"));
  await copyIfExists(path.join(providerDir, "plugins"), path.join(providerRoot, "plugins"));
  await copyIfExists(path.join(homeDir, ".claude.json"), path.join(providerRoot, ".claude.json"));
}

export async function hasVerftBaseLogin(provider) {
  const baseRoot = process.env.VERFT_BASE_ROOT?.trim() || DEFAULT_BASE_ROOT;
  const loginPath = provider === "claude"
    ? path.join(baseRoot, provider, ".credentials.json")
    : path.join(baseRoot, provider, "auth.json");
  const entry = await stat(loginPath).catch(() => null);
  return Boolean(entry?.isFile());
}
