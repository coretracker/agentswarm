#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
DEFAULT_PUBLIC_PORT="3217"
RESTRICTED_GIT_TERMINAL_TAG="local/git-terminal:latest"
INTERACTIVE_CODEX_TAG="local/codex-interactive:latest"
INTERACTIVE_CLAUDE_TAG="local/claude-interactive:latest"

print_usage() {
  cat <<EOF
Usage: ./${SCRIPT_NAME} <start|stop|rebuild|init|help>

Commands:
  start    Start the AgentSwarm compose stack in the background.
  stop     Stop the AgentSwarm compose stack.
  rebuild  Rebuild compose, automated runtime, and interactive runtime images, then restart.
  init     Alias for rebuild.
  help     Show this help text.
EOF
}

load_env_file() {
  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ "$line" =~ ^[[:space:]]*$ ]]; then
      continue
    fi

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"

      # Trim leading/trailing whitespace in value while preserving internal spaces.
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"

      # Keep explicitly provided environment overrides (for CI/remote harness).
      if [[ -z "${!key+x}" ]]; then
        export "${key}=${value}"
      fi
    fi
  done < "$env_file"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required but not installed." >&2
    exit 1
  fi
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return 0
  fi

  echo "Docker Compose is required but neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
}

compose() {
  "${COMPOSE_CMD[@]}" "$@"
}

print_access_hint() {
  local public_port="${PUBLIC_PORT:-$DEFAULT_PUBLIC_PORT}"
  echo "AgentSwarm should be reachable at http://localhost:${public_port}/login"
}

warn_if_missing_interactive_images() {
  local image
  for image in "$RESTRICTED_GIT_TERMINAL_TAG" "$INTERACTIVE_CODEX_TAG" "$INTERACTIVE_CLAUDE_TAG"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "warning: interactive image '$image' is not built." >&2
    fi
  done
}

warn_if_missing_runtime_images() {
  local image
  for image in "$CODEX_RUNTIME_IMAGE" "$CLAUDE_RUNTIME_IMAGE"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "warning: automated runtime image '$image' is not built." >&2
    fi
  done
}

build_runtime_images() {
  echo "Building automated Codex runtime image: $CODEX_RUNTIME_IMAGE"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/agent-runtime-codex/Dockerfile" \
    -t "$CODEX_RUNTIME_IMAGE" \
    "$ROOT_DIR/agent-runtime-codex"

  echo "Building automated Claude runtime image: $CLAUDE_RUNTIME_IMAGE"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/agent-runtime-claude/Dockerfile" \
    -t "$CLAUDE_RUNTIME_IMAGE" \
    "$ROOT_DIR/agent-runtime-claude"
}

build_interactive_images() {
  echo "Building restricted Git terminal image: $RESTRICTED_GIT_TERMINAL_TAG"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/tools/codex-web-terminal/Dockerfile.git" \
    -t "$RESTRICTED_GIT_TERMINAL_TAG" \
    "$ROOT_DIR/tools/codex-web-terminal"

  echo "Building interactive Codex image: $INTERACTIVE_CODEX_TAG"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/tools/codex-web-terminal/Dockerfile.codex" \
    -t "$INTERACTIVE_CODEX_TAG" \
    "$ROOT_DIR/tools/codex-web-terminal"

  echo "Building interactive Claude image: $INTERACTIVE_CLAUDE_TAG"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/tools/codex-web-terminal/Dockerfile.claude" \
    -t "$INTERACTIVE_CLAUDE_TAG" \
    "$ROOT_DIR/tools/codex-web-terminal"
}

start_stack() {
  echo "Starting AgentSwarm services"
  compose up -d
  warn_if_missing_runtime_images
  warn_if_missing_interactive_images
  print_access_hint
}

stop_stack() {
  echo "Stopping AgentSwarm services"
  compose down
}

rebuild_stack() {
  build_runtime_images
  build_interactive_images
  echo "Rebuilding AgentSwarm compose images"
  compose build --pull --no-cache
  echo "Restarting AgentSwarm services"
  compose up -d --force-recreate
  print_access_hint
}

main() {
  local command="${1:-help}"

  case "$command" in
    help|-h|--help)
      print_usage
      ;;
    start|stop|rebuild|init)
      load_env_file
      require_docker
      detect_compose
      cd "$ROOT_DIR"
      CODEX_RUNTIME_IMAGE="${CODEX_RUNTIME_IMAGE:-agentswarm-agent-runtime-codex:latest}"
      CLAUDE_RUNTIME_IMAGE="${CLAUDE_RUNTIME_IMAGE:-agentswarm-agent-runtime-claude:latest}"

      case "$command" in
        start)
          start_stack
          ;;
        stop)
          stop_stack
          ;;
        rebuild|init)
          rebuild_stack
          ;;
      esac
      ;;
    *)
      echo "Unknown command: $command" >&2
      print_usage >&2
      exit 1
      ;;
  esac
}

main "$@"
