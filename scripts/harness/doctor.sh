#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/doctor.sh" "$@"

cd "$REPO_ROOT"
TASK_WORKSPACE_DOCKER_SOURCE="${TASK_WORKSPACE_DOCKER_SOURCE:-$REPO_ROOT/task-workspaces}"
export TASK_WORKSPACE_DOCKER_SOURCE

log() {
  echo "[harness:doctor] $1"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[harness:doctor] error: required command not found: $cmd" >&2
    exit 1
  fi
}

log "repo root: $REPO_ROOT"

require_cmd bash
require_cmd docker
require_cmd node
require_cmd npm

if [[ ! -d node_modules ]]; then
  require_cmd python3
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "[harness:doctor] error: Docker Compose is required" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "[harness:doctor] error: Docker daemon is not reachable. Start Docker and retry." >&2
  exit 1
fi

if [[ ! -f package.json || ! -f package-lock.json ]]; then
  echo "[harness:doctor] error: package.json and package-lock.json are required at repo root" >&2
  exit 1
fi

if [[ ! -f .env && ! -f .env.example ]]; then
  echo "[harness:doctor] error: no environment template found (.env or .env.example)" >&2
  exit 1
fi

if [[ -f .env.example ]]; then
  for required_key in DEFAULT_ADMIN_EMAIL DEFAULT_ADMIN_PASSWORD PUBLIC_PORT DATABASE_URL; do
    if ! grep -q "^${required_key}=" .env.example; then
      echo "[harness:doctor] error: .env.example is missing required key: ${required_key}" >&2
      exit 1
    fi
  done
fi

if [[ ! -x ./verft.sh ]]; then
  echo "[harness:doctor] error: ./verft.sh is missing or not executable" >&2
  exit 1
fi

for script in ./scripts/harness/setup.sh ./scripts/harness/start.sh ./scripts/harness/check.sh ./scripts/harness/check-docs.sh ./scripts/harness/test.sh ./scripts/harness/pr-ready.sh ./scripts/harness/logs.sh; do
  if [[ ! -x "$script" ]]; then
    echo "[harness:doctor] error: harness script missing or not executable: $script" >&2
    exit 1
  fi
done

log "node version: $(node -v)"
log "npm version: $(npm -v)"
if command -v python3 >/dev/null 2>&1; then
  log "python3 version: $(python3 --version 2>/dev/null || echo unknown)"
fi

log "validating Docker Compose configuration"
if docker compose version >/dev/null 2>&1; then
  docker compose config >/dev/null
else
  docker-compose config >/dev/null
fi

log "validating npm workspace scripts"
npm run >/dev/null
npm run -w @verft/server >/dev/null
npm run -w @verft/web >/dev/null

log "doctor checks passed"
log "next: run ./scripts/harness/setup.sh"
