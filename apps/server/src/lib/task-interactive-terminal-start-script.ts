export function buildGitTerminalStartScript(): string {
  return [
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    'printf "\\033[90mTerminal ready in %s. Full toolbox shell available.\\033[0m\\n" "$PWD"',
    [
      'if [ -n "${GIT_TOKEN:-}" ]; then',
      "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > /tmp/agentswarm-git-askpass.sh",
      "  chmod 700 /tmp/agentswarm-git-askpass.sh",
      '  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/agentswarm-git-askpass.sh',
      "fi"
    ].join("\n"),
    'if command -v bash >/dev/null 2>&1; then exec bash -l; fi',
    "exec sh -l"
  ].join(" && ");
}
