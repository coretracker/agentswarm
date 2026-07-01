#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/check.sh" "$@"

cd "$REPO_ROOT"

echo "[harness:check] repo root: $REPO_ROOT"
echo "[harness:check] compatibility wrapper; running Dockerized CI"
npm run ci

echo "[harness:check] done"
