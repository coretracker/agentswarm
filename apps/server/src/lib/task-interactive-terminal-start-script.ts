export function buildGitTerminalStartScript(): string {
  return [
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    'printf "\\033[90mGit terminal ready in %s. The shell is restricted to this workspace and only exposes git, vim, vi, and diff3.\\033[0m\\n" "$PWD"',
    [
      'if [ -n "${GIT_TOKEN:-}" ]; then',
      "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > /tmp/agentswarm-git-askpass.sh",
      "  chmod 700 /tmp/agentswarm-git-askpass.sh",
      '  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/agentswarm-git-askpass.sh',
      "fi"
    ].join("\n"),
    "exec git-terminal-shell"
  ].join(" && ");
}
