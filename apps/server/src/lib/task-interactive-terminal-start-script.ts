export function buildTerminalStartScript(): string {
  return [
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    'printf "\\033[90mTerminal ready in %s. Full toolbox shell available.\\033[0m\\n" "$PWD"',
    [
      'mkdir -p "$HOME/.codex" "$HOME/.claude"',
      'if [ -d "${VERFT_BASE_ROOT:-/verft-base}/codex" ]; then',
      '  CODEX_GENERATED_CONFIG="$(mktemp)"',
      '  [ -f "$HOME/.codex/config.toml" ] && cp "$HOME/.codex/config.toml" "$CODEX_GENERATED_CONFIG"',
      '  [ -f "${VERFT_BASE_ROOT:-/verft-base}/codex/auth.json" ] && cp "${VERFT_BASE_ROOT:-/verft-base}/codex/auth.json" "$HOME/.codex/auth.json"',
      '  [ -d "${VERFT_BASE_ROOT:-/verft-base}/codex/skills" ] && rm -rf "$HOME/.codex/skills" && cp -a "${VERFT_BASE_ROOT:-/verft-base}/codex/skills" "$HOME/.codex/skills"',
      '  [ -d "${VERFT_BASE_ROOT:-/verft-base}/codex/.tmp" ] && rm -rf "$HOME/.codex/.tmp" && cp -a "${VERFT_BASE_ROOT:-/verft-base}/codex/.tmp" "$HOME/.codex/.tmp"',
      '  [ -d "${VERFT_BASE_ROOT:-/verft-base}/codex/plugins" ] && rm -rf "$HOME/.codex/plugins" && cp -a "${VERFT_BASE_ROOT:-/verft-base}/codex/plugins" "$HOME/.codex/plugins"',
      '  [ -f "${VERFT_BASE_ROOT:-/verft-base}/codex/config.toml" ] && cp "${VERFT_BASE_ROOT:-/verft-base}/codex/config.toml" "$HOME/.codex/config.toml"',
      '  if [ -s "$CODEX_GENERATED_CONFIG" ]; then',
      '    if [ -f "$HOME/.codex/config.toml" ]; then awk \'BEGIN{s=0} /^\\[mcp_servers\\.verft(\\.env)?\\]$/ {s=1; next} /^\\[/ {s=0} !s {print}\' "$HOME/.codex/config.toml" > "$HOME/.codex/config.toml.base" && mv "$HOME/.codex/config.toml.base" "$HOME/.codex/config.toml"; fi',
      '    printf "\\n" >> "$HOME/.codex/config.toml"',
      '    cat "$CODEX_GENERATED_CONFIG" >> "$HOME/.codex/config.toml"',
      "  fi",
      '  rm -f "$CODEX_GENERATED_CONFIG"',
      "fi",
      'if [ -d "${VERFT_BASE_ROOT:-/verft-base}/claude" ]; then',
      '  CLAUDE_GENERATED_MCP="$(mktemp)"',
      '  [ -f "$HOME/.claude/mcp-config.json" ] && cp "$HOME/.claude/mcp-config.json" "$CLAUDE_GENERATED_MCP"',
      '  [ -f "${VERFT_BASE_ROOT:-/verft-base}/claude/.credentials.json" ] && cp "${VERFT_BASE_ROOT:-/verft-base}/claude/.credentials.json" "$HOME/.claude/.credentials.json"',
      '  [ -f "${VERFT_BASE_ROOT:-/verft-base}/claude/settings.json" ] && cp "${VERFT_BASE_ROOT:-/verft-base}/claude/settings.json" "$HOME/.claude/settings.json"',
      '  [ -d "${VERFT_BASE_ROOT:-/verft-base}/claude/plugins" ] && rm -rf "$HOME/.claude/plugins" && cp -a "${VERFT_BASE_ROOT:-/verft-base}/claude/plugins" "$HOME/.claude/plugins"',
      '  [ -s "$CLAUDE_GENERATED_MCP" ] && cp "$CLAUDE_GENERATED_MCP" "$HOME/.claude/mcp-config.json"',
      '  rm -f "$CLAUDE_GENERATED_MCP"',
      "fi",
      'chown -R agent:agent "$HOME" "$TASK_INTERACTIVE_WORKSPACE" 2>/dev/null || true'
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
