import type { GitCommitIdentity } from "./task-git-identity.js";

export function buildInteractiveWorkspaceGitEnvEntries(
  workspacePath: string,
  configEntries: Array<[string, string]> = []
): Array<[string, string]> {
  const gitConfigEntries: Array<[string, string]> = [["safe.directory", workspacePath], ...configEntries];
  const envEntries: Array<[string, string]> = [["GIT_CONFIG_COUNT", String(gitConfigEntries.length)]];

  gitConfigEntries.forEach(([key, value], index) => {
    envEntries.push([`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]);
  });

  return envEntries;
}

export function buildGitTerminalEnvEntries(options: {
  workspacePath: string;
  githubToken?: string | null;
  gitUsername?: string | null;
  gitIdentity?: GitCommitIdentity | null;
}): Array<[string, string]> {
  const identityName = options.gitIdentity?.name.trim() ?? "";
  const identityEmail = options.gitIdentity?.email.trim() ?? "";
  const envEntries: Array<[string, string]> = [
    ["TERM", "xterm-256color"],
    ["HOME", "/root"],
    ["TASK_INTERACTIVE_WORKSPACE", options.workspacePath],
    ["GIT_OPTIONAL_LOCKS", "0"],
    ...buildInteractiveWorkspaceGitEnvEntries(
      options.workspacePath,
      identityName && identityEmail
        ? [
            ["user.name", identityName],
            ["user.email", identityEmail]
          ]
        : []
    )
  ];

  if (identityName && identityEmail) {
    envEntries.push(
      ["GIT_AUTHOR_NAME", identityName],
      ["GIT_AUTHOR_EMAIL", identityEmail],
      ["GIT_COMMITTER_NAME", identityName],
      ["GIT_COMMITTER_EMAIL", identityEmail]
    );
  }

  if (options.githubToken?.trim()) {
    envEntries.push(["GIT_TOKEN", options.githubToken.trim()]);
    envEntries.push(["GIT_USERNAME", options.gitUsername?.trim() || "x-access-token"]);
  }

  return envEntries;
}
