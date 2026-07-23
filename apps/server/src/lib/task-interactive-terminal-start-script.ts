export function buildTerminalStartScript(): string {
  return [
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    'printf "\\033[90mTerminal ready in %s. Full toolbox shell available.\\033[0m\\n" "$PWD"',
    [
      'node /usr/local/bin/normalize-provider-paths.mjs "$HOME"',
      'chown -R agent:agent "$TASK_INTERACTIVE_WORKSPACE" 2>/dev/null || true'
    ].join("\n"),
    [
      'if [ -n "${GIT_TOKEN:-}" ]; then',
      "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > \"$HOME/verft-git-askpass.sh\"",
      "  chmod 700 \"$HOME/verft-git-askpass.sh\"",
      '  chown agent:agent "$HOME/verft-git-askpass.sh" 2>/dev/null || true',
      '  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$HOME/verft-git-askpass.sh"',
      "fi"
    ].join("\n"),
    [
      'if [ -f "$HOME/.claude/mcp-config.json" ]; then',
      '  CLAUDE_REAL="$(command -v claude 2>/dev/null || true)"',
      '  if [ -n "$CLAUDE_REAL" ]; then',
      '    mkdir -p /tmp/verft-bin',
      '    printf "%s\\n" "#!/bin/sh" "exec \\"$CLAUDE_REAL\\" --mcp-config \\"$HOME/.claude/mcp-config.json\\" \\"\\$@\\"" > /tmp/verft-bin/claude',
      '    chown -R agent:agent /tmp/verft-bin 2>/dev/null || true',
      '    chmod 755 /tmp/verft-bin /tmp/verft-bin/claude',
      '    export PATH="/tmp/verft-bin:$PATH"',
      "  fi",
      "fi"
    ].join("\n"),
    'if command -v bash >/dev/null 2>&1; then exec su-exec agent:agent bash -lc \'if [ -n "${HOSTEXEC_BIN_PATH:-}" ]; then export PATH="${HOSTEXEC_BIN_PATH}:$PATH"; fi; exec bash -i\'; fi',
    'exec su-exec agent:agent sh -lc \'if [ -n "${HOSTEXEC_BIN_PATH:-}" ]; then export PATH="${HOSTEXEC_BIN_PATH}:$PATH"; fi; exec sh -i\''
  ].join(" && ");
}
