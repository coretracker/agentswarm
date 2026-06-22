#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/setup.sh" "$@"

cd "$REPO_ROOT"
TASK_WORKSPACE_HOST_ROOT="${TASK_WORKSPACE_HOST_ROOT:-${TASK_WORKSPACE_DOCKER_SOURCE:-$REPO_ROOT/task-workspaces}}"
export TASK_WORKSPACE_HOST_ROOT

log() {
  echo "[harness:setup] $1"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[harness:setup] error: required command not found: $cmd" >&2
    exit 1
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

log "repo root: $REPO_ROOT"

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "[harness:setup] error: .env.example not found; cannot create .env template" >&2
    exit 1
  fi
  cp .env.example .env
  log "created .env from .env.example"
else
  log ".env already exists"
fi

mkdir -p task-workspaces
log "ensured local runtime directory exists (task-workspaces)"

if [[ "${HARNESS_INSTALL_NPM_DEPS:-0}" == "1" ]]; then
  require_cmd npm
  require_cmd python3
  log "installing Node dependencies with npm ci --include=dev"
  npm ci --include=dev
else
  log "skipping npm ci (set HARNESS_INSTALL_NPM_DEPS=1 to enable)"
fi

require_cmd docker
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "[harness:setup] error: Docker Compose is required" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "[harness:setup] error: Docker daemon is not reachable. Start Docker and retry." >&2
  exit 1
fi

if [[ "${HARNESS_DB_RESET:-0}" == "1" ]]; then
  log "reset requested: stopping stack and removing local DB/cache volumes"
  compose down -v --remove-orphans
  log "local DB/cache reset complete"
fi

log "running first-time stack initialization (build + start)"
./agentswarm.sh init

log "setup complete"
log "admin seed is created on first boot from .env defaults (DEFAULT_ADMIN_*)"
log "next: run ./scripts/harness/start.sh to verify health"
