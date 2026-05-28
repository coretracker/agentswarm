#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/check.sh" "$@"

cd "$REPO_ROOT"

echo "[harness:check] repo root: $REPO_ROOT"
echo "[harness:check] running docs checks"
./scripts/harness/check-docs.sh

echo "[harness:check] running human-gated flow checks"
./scripts/harness/check-human-gated-flow.sh

echo "[harness:check] running boundary checks"
node ./scripts/harness/boundary-check.mjs

echo "[harness:check] running lint"
npm run lint

echo "[harness:check] running build"
npm run build

echo "[harness:check] done"
