#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/logs.sh" "$@"

cd "$REPO_ROOT"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/harness/logs.sh [service]

Examples:
  ./scripts/harness/logs.sh
  ./scripts/harness/logs.sh server
  TAIL_LINES=500 ./scripts/harness/logs.sh server
  FOLLOW=0 ./scripts/harness/logs.sh proxy

Options via env:
  TAIL_LINES   Number of historical lines to show first (default: 200)
  FOLLOW       1 to follow logs, 0 to print and exit (default: 1)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SERVICE="${1:-}"
TAIL_LINES="${TAIL_LINES:-200}"
FOLLOW="${FOLLOW:-1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[harness:logs] error: docker is required" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[harness:logs] error: Docker Compose is required" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[harness:logs] error: Docker daemon is not reachable" >&2
  exit 1
fi

ARGS=(logs --timestamps --tail "$TAIL_LINES")
if [[ "$FOLLOW" == "1" ]]; then
  ARGS+=(-f)
fi
if [[ -n "$SERVICE" ]]; then
  ARGS+=("$SERVICE")
fi

echo "[harness:logs] repo root: $REPO_ROOT"
echo "[harness:logs] compose: ${COMPOSE[*]}"
if [[ -n "$SERVICE" ]]; then
  echo "[harness:logs] service: $SERVICE"
else
  echo "[harness:logs] service: all"
fi
echo "[harness:logs] tail lines: $TAIL_LINES"
if [[ "$FOLLOW" == "1" ]]; then
  echo "[harness:logs] mode: follow"
else
  echo "[harness:logs] mode: snapshot"
fi

"${COMPOSE[@]}" "${ARGS[@]}"
