import { chmod, writeFile } from "node:fs/promises";

let gitAskPassPath: string | null = null;

export async function ensureGitAskPassScript(): Promise<string> {
  if (gitAskPassPath) {
    return gitAskPassPath;
  }

  const askPassPath = "/tmp/agentswarm-git-askpass.sh";
  await writeFile(
    askPassPath,
    `#!/usr/bin/env sh
case "$1" in
  *sername*) echo "\${GIT_USERNAME:-x-access-token}" ;;
  *assword*) echo "\${GIT_TOKEN:-}" ;;
  *) echo "" ;;
esac
`,
    "utf8"
  );
  await chmod(askPassPath, 0o700);
  gitAskPassPath = askPassPath;
  return askPassPath;
}

export async function buildGitProcessEnv(options: {
  workspacePath?: string | null;
  githubToken?: string | null;
  gitUsername?: string | null;
}): Promise<NodeJS.ProcessEnv> {
  const gitEnv: NodeJS.ProcessEnv = {
    GIT_OPTIONAL_LOCKS: "0"
  };
  const githubToken = options.githubToken?.trim() ? options.githubToken.trim() : options.githubToken ?? null;
  const gitUsername = options.gitUsername?.trim() ? options.gitUsername.trim() : "x-access-token";

  if (githubToken) {
    gitEnv.GIT_TERMINAL_PROMPT = "0";
    gitEnv.GIT_ASKPASS = await ensureGitAskPassScript();
    gitEnv.GIT_USERNAME = gitUsername;
    gitEnv.GIT_TOKEN = githubToken;
  }

  const workspacePath = options.workspacePath?.trim();
  if (workspacePath) {
    gitEnv.GIT_CONFIG_COUNT = "1";
    gitEnv.GIT_CONFIG_KEY_0 = "safe.directory";
    gitEnv.GIT_CONFIG_VALUE_0 = workspacePath;
  }

  return gitEnv;
}
