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

has_root_script() {
  local script_name="$1"
  node -e '
const fs = require("fs");
const name = process.argv[1];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
process.exit(pkg && pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, name) ? 0 : 1);
' "$script_name"
}

step "repo root: $REPO_ROOT"

if [[ ! -d node_modules ]]; then
  step "dependencies missing (node_modules not found); running setup first"
  run env HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
fi

step "1/8 doctor"
run ./scripts/harness/doctor.sh

step "2/8 format check"
format_check_required="${HARNESS_REQUIRE_FORMAT_CHECK:-0}"
if has_root_script "format:check"; then
  run npm run format:check
elif has_root_script "fmt:check"; then
  run npm run fmt:check
elif [[ "$format_check_required" == "1" ]]; then
  echo "[harness:pr-ready] error: HARNESS_REQUIRE_FORMAT_CHECK=1 but no root format-check script is defined." >&2
  echo "[harness:pr-ready] fix: add package.json script 'format:check' (or 'fmt:check') and retry." >&2
  exit 1
else
  step "no root format-check script found; skipping (set HARNESS_REQUIRE_FORMAT_CHECK=1 to enforce)"
fi

step "3/8 boundary checks"
run node ./scripts/harness/boundary-check.mjs

step "4/8 lint"
run npm run lint

step "5/8 typecheck"
# In this repo, lint commands are TypeScript no-emit checks.
run npm run -w @agentswarm/server lint
run npm run -w @agentswarm/web lint

step "6/8 tests"
run ./scripts/harness/test.sh

step "7/8 build"
run npm run build

step "8/8 repo-specific checks"
# Validate Compose config when Docker is available.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  run docker compose config >/dev/null
  step "docker compose config is valid"
else
  step "docker compose not available; skipped compose config validation"
fi

step "PR readiness checks passed"
