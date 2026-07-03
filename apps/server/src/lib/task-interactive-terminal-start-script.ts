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
      "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > /tmp/verft-git-askpass.sh",
      "  chmod 700 /tmp/verft-git-askpass.sh",
      '  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/verft-git-askpass.sh',
      "fi"
    ].join("\n"),
    [
      'if [ -f "$HOME/.claude/mcp-config.json" ]; then',
      '  CLAUDE_REAL="$(command -v claude 2>/dev/null || true)"',
      '  if [ -n "$CLAUDE_REAL" ]; then',
      '    mkdir -p /tmp/verft-bin',
      '    printf "%s\\n" "#!/bin/sh" "exec \\"$CLAUDE_REAL\\" --mcp-config \\"$HOME/.claude/mcp-config.json\\" \\"\\$@\\"" > /tmp/verft-bin/claude',
      '    chmod 700 /tmp/verft-bin/claude',
      '    export PATH="/tmp/verft-bin:$PATH"',
      "  fi",
      "fi"
    ].join("\n"),
    'if command -v bash >/dev/null 2>&1; then exec bash -lc \'if [ -n "${HOSTEXEC_BIN_PATH:-}" ]; then export PATH="${HOSTEXEC_BIN_PATH}:$PATH"; fi; exec bash -i\'; fi',
    'exec sh -lc \'if [ -n "${HOSTEXEC_BIN_PATH:-}" ]; then export PATH="${HOSTEXEC_BIN_PATH}:$PATH"; fi; exec sh -i\''
  ].join(" && ");
}
