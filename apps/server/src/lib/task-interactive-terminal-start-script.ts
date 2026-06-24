export function buildTerminalStartScript(): string {
  return [
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    'printf "\\033[90mTerminal ready in %s. Full toolbox shell available.\\033[0m\\n" "$PWD"',
    [
      'mkdir -p "$HOME/.codex" "$HOME/.claude"',
      'if [ -n "${CODEX_AUTH_JSON_B64:-}" ]; then',
      '  printf "%s" "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json"',
      '  chmod 600 "$HOME/.codex/auth.json"',
      "fi"
    ].join("\n"),
    [
      'if [ -n "${GIT_TOKEN:-}" ]; then',
      "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > /tmp/agentswarm-git-askpass.sh",
      "  chmod 700 /tmp/agentswarm-git-askpass.sh",
      '  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/agentswarm-git-askpass.sh',
      "fi"
    ].join("\n"),
    [
      'if [ -f "$HOME/.claude/mcp-config.json" ]; then',
      '  CLAUDE_REAL="$(command -v claude 2>/dev/null || true)"',
      '  if [ -n "$CLAUDE_REAL" ]; then',
      '    mkdir -p /tmp/agentswarm-bin',
      '    printf "%s\\n" "#!/bin/sh" "exec \\"$CLAUDE_REAL\\" --mcp-config \\"$HOME/.claude/mcp-config.json\\" \\"\\$@\\"" > /tmp/agentswarm-bin/claude',
      '    chmod 700 /tmp/agentswarm-bin/claude',
      '    export PATH="/tmp/agentswarm-bin:$PATH"',
      "  fi",
      "fi"
    ].join("\n"),
    'if command -v bash >/dev/null 2>&1; then exec bash -l; fi',
    "exec sh -l"
  ].join(" && ");
}
