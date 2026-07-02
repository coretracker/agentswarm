#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/pr-ready.sh" "$@"

cd "$REPO_ROOT"

step() {
  echo "[harness:pr-ready] $1"
}

run() {
  step "running: $*"
  "$@"
}

step "repo root: $REPO_ROOT"

step "running Dockerized CI"
run npm run ci

step "PR readiness checks passed"
