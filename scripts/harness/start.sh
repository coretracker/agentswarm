#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/start.sh" "$@"

cd "$REPO_ROOT"

log() {
  echo "[harness:start] $1"
}

http_check() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$url" >/dev/null
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "$url"
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' "$url"
    return $?
  fi
  return 1
}

compose_logs_hint() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose logs --tail=200"
  else
    echo "docker-compose logs --tail=200"
  fi
}

if [[ -n "${PUBLIC_PORT:-}" ]]; then
  PUBLIC_PORT="${PUBLIC_PORT}"
elif [[ -f .env ]]; then
  parsed_port="$(awk -F= '/^PUBLIC_PORT=/{print $2; exit}' .env | tr -d '[:space:]')"
  if [[ -n "${parsed_port:-}" ]]; then
    PUBLIC_PORT="$parsed_port"
  else
    PUBLIC_PORT="3217"
  fi
else
  PUBLIC_PORT="3217"
fi

HEALTH_HOST="localhost"
if [[ "${HARNESS_REMOTE_EXECUTING:-0}" == "1" ]]; then
  HEALTH_HOST="${HARNESS_HEALTH_HOST:-host.docker.internal}"
fi

HEALTH_URL="http://${HEALTH_HOST}:${PUBLIC_PORT}/api/health"
APP_URL="http://localhost:${PUBLIC_PORT}/login"

log "repo root: $REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[harness:start] error: docker is required but not installed." >&2
  echo "[harness:start] fix: install Docker and re-run ./scripts/harness/doctor.sh" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "[harness:start] error: Docker daemon is not reachable." >&2
  echo "[harness:start] fix: start Docker and re-run ./scripts/harness/doctor.sh" >&2
  exit 1
fi

log "starting stack"
./verft.sh start

log "waiting for health endpoint: $HEALTH_URL"
for attempt in $(seq 1 60); do
  if http_check "$HEALTH_URL"; then
    log "health check passed"
    log "app URL: $APP_URL"
    exit 0
  fi
  sleep 2
  if (( attempt % 10 == 0 )); then
    log "still waiting for health (attempt $attempt/60)"
  fi
done

echo "[harness:start] error: app did not become healthy in time" >&2
echo "[harness:start] check logs with: $(compose_logs_hint)" >&2
echo "[harness:start] troubleshooting doc: docs/development/debugging.md" >&2
exit 1
