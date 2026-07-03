#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
DEFAULT_PUBLIC_PORT="3217"
DEFAULT_AGENT_RUNTIME_IMAGE="verft-agent-toolbox:latest"
DEFAULT_TASK_WORKSPACE_DIR="$ROOT_DIR/task-workspaces"

print_usage() {
  cat <<EOF
Usage: ./${SCRIPT_NAME} <start|stop|rebuild|init|help>

Commands:
  start    Start the Verft compose stack in the background.
  stop     Stop the Verft compose stack.
  rebuild  Rebuild compose and agent toolbox runtime images, then restart.
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
  echo "Verft should be reachable at http://localhost:${public_port}/login"
}

warn_if_missing_runtime_image() {
  if ! docker image inspect "$AGENT_RUNTIME_IMAGE" >/dev/null 2>&1; then
    echo "warning: agent runtime image '$AGENT_RUNTIME_IMAGE' is not built." >&2
  fi
}

ensure_task_workspace_dir() {
  if [[ "$TASK_WORKSPACE_DOCKER_SOURCE" = /* || "$TASK_WORKSPACE_DOCKER_SOURCE" = ./* || "$TASK_WORKSPACE_DOCKER_SOURCE" = ../* ]]; then
    mkdir -p "$TASK_WORKSPACE_DOCKER_SOURCE"
  fi
}

build_runtime_image() {
  echo "Building agent toolbox runtime image: $AGENT_RUNTIME_IMAGE"
  docker build \
    --pull \
    --no-cache \
    -f "$ROOT_DIR/agent-runtime/Dockerfile" \
    -t "$AGENT_RUNTIME_IMAGE" \
    "$ROOT_DIR/agent-runtime"
}

start_stack() {
  echo "Starting Verft services"
  ensure_task_workspace_dir
  compose up -d
  warn_if_missing_runtime_image
  print_access_hint
}

stop_stack() {
  echo "Stopping Verft services"
  compose down
}

rebuild_stack() {
  build_runtime_image
  echo "Rebuilding Verft compose images"
  compose build --pull --no-cache
  echo "Restarting Verft services"
  ensure_task_workspace_dir
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
      AGENT_RUNTIME_IMAGE="${AGENT_RUNTIME_IMAGE:-${CODEX_RUNTIME_IMAGE:-${CLAUDE_RUNTIME_IMAGE:-$DEFAULT_AGENT_RUNTIME_IMAGE}}}"
      TASK_WORKSPACE_DOCKER_SOURCE="${TASK_WORKSPACE_DOCKER_SOURCE:-$DEFAULT_TASK_WORKSPACE_DIR}"
      export AGENT_RUNTIME_IMAGE TASK_WORKSPACE_DOCKER_SOURCE

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
