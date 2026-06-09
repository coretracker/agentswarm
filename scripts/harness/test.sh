#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/lib/remote-build.sh"
ensure_remote_build_execution "$REPO_ROOT" "./scripts/harness/test.sh" "$@"

cd "$REPO_ROOT"

TEST_SCOPE="${TEST_SCOPE:-all}"

case "$TEST_SCOPE" in
  all|unit|integration|e2e)
    ;;
  *)
    echo "[harness:test] error: invalid TEST_SCOPE='$TEST_SCOPE' (use: all|unit|integration|e2e)" >&2
    exit 2
    ;;
esac

# Deterministic runtime defaults for CI and local agents.
export CI="${CI:-1}"
export NODE_ENV="${NODE_ENV:-test}"
export TZ="${TZ:-UTC}"
export LANG="${LANG:-C}"
export LC_ALL="${LC_ALL:-C}"
export NO_COLOR="${NO_COLOR:-1}"
export FORCE_COLOR="${FORCE_COLOR:-0}"
export AGENTSWARM_TEST_SEED="${AGENTSWARM_TEST_SEED:-20260523}"

if ! node -e 'require.resolve("tsx/package.json")' >/dev/null 2>&1; then
  echo "[harness:test] error: required test dependency 'tsx' is not installed" >&2
  echo "[harness:test] fix: run npm ci (or HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh)" >&2
  exit 1
fi

FIXTURE_ROOT="${REPO_ROOT}/.tmp/harness-tests"
rm -rf "$FIXTURE_ROOT"
mkdir -p "$FIXTURE_ROOT"
export AGENTSWARM_TEST_FIXTURE_ROOT="$FIXTURE_ROOT"

CURRENT_PHASE="initializing"
CURRENT_CMD=""

on_error() {
  local exit_code=$?
  echo "[harness:test]"
  echo "[harness:test] failed during phase: ${CURRENT_PHASE}" >&2
  if [[ -n "$CURRENT_CMD" ]]; then
    echo "[harness:test] command: ${CURRENT_CMD}" >&2
    echo "[harness:test] rerun: ${CURRENT_CMD}" >&2
  fi
  echo "[harness:test] tips:" >&2
  echo "[harness:test] - run only one scope: TEST_SCOPE=unit ./scripts/harness/test.sh" >&2
  echo "[harness:test] - read docs: docs/development/testing.md" >&2
  exit "$exit_code"
}

trap on_error ERR

run_phase() {
  local phase="$1"
  shift
  CURRENT_PHASE="$phase"
  CURRENT_CMD="$*"
  echo "[harness:test]"
  echo "[harness:test] phase: $phase"
  echo "[harness:test] running: $*"
  "$@"
  echo "[harness:test] phase passed: $phase"
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

resolve_public_port() {
  if [[ -n "${PUBLIC_PORT:-}" ]]; then
    echo "$PUBLIC_PORT"
    return
  fi

  if [[ -f .env ]]; then
    local from_env
    from_env="$(awk -F= '/^PUBLIC_PORT=/{print $2; exit}' .env | tr -d '[:space:]')"
    if [[ -n "$from_env" ]]; then
      echo "$from_env"
      return
    fi
  fi

  echo "3217"
}

ensure_ui_for_playwright() {
  local ui_base_url="$1"
  local health_url="${ui_base_url%/}/api/health"

  if http_check "$health_url"; then
    echo "[harness:test] e2e app health check already passing: $health_url"
    return
  fi

  echo "[harness:test] e2e app not healthy yet; starting stack"
  run_phase "e2e:boot-app" ./scripts/harness/start.sh

  if ! http_check "$health_url"; then
    echo "[harness:test] error: e2e app health endpoint is not reachable: $health_url" >&2
    exit 1
  fi

  echo "[harness:test] e2e app health check passed: $health_url"
}

all_tests=()
unit_tests=()
integration_tests=()
e2e_tests=()

while IFS= read -r test_file; do
  all_tests+=("$test_file")

  case "$test_file" in
    apps/server/src/lib/*.test.ts|apps/web/src/utils/*.test.ts)
      unit_tests+=("$test_file")
      ;;
    */e2e/*|*.e2e.test.ts|*.e2e.test.tsx|*.e2e.test.js|*.e2e.test.mjs|*.e2e.spec.ts|*.e2e.spec.tsx|*.e2e.spec.js|*.e2e.spec.mjs)
      e2e_tests+=("$test_file")
      ;;
    apps/server/src/services/*.test.ts|apps/server/src/routes/*.test.ts)
      integration_tests+=("$test_file")
      ;;
    *)
      # Conservative default: treat unknown test locations as integration-level.
      integration_tests+=("$test_file")
      ;;
  esac
done < <(
  find apps \
    \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/build/*' -o -path '*/.next/*' \) -prune -o \
    -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.js' -o -name '*.test.mjs' \) -print |
    sort
)

run_node_tests() {
  local group_name="$1"
  shift

  if [[ "$#" -eq 0 ]]; then
    echo "[harness:test]"
    echo "[harness:test] phase: ${group_name}"
    echo "[harness:test] no tests found for this group, skipping"
    return
  fi

  run_phase "$group_name" node --import tsx --test "$@"
}

run_playwright_e2e() {
  if [[ ! -f playwright.config.ts ]]; then
    echo "[harness:test]"
    echo "[harness:test] phase: e2e:playwright"
    echo "[harness:test] playwright config not found, skipping"
    return
  fi

  if ! find apps/web/e2e -type f -name '*.spec.ts' | grep -q .; then
    echo "[harness:test]"
    echo "[harness:test] phase: e2e:playwright"
    echo "[harness:test] no Playwright spec files found, skipping"
    return
  fi

  if ! node -e 'require.resolve("@playwright/test/package.json")' >/dev/null 2>&1; then
    echo "[harness:test] error: @playwright/test is not installed in node_modules" >&2
    echo "[harness:test] run npm ci (or HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh) and retry" >&2
    exit 1
  fi

  local public_port
  public_port="$(resolve_public_port)"
  local default_ui_host="localhost"
  if [[ "${HARNESS_REMOTE_EXECUTING:-0}" == "1" ]]; then
    default_ui_host="host.docker.internal"
  fi
  local ui_base_url="${AGENTSWARM_UI_BASE_URL:-http://${default_ui_host}:${public_port}}"

  ensure_ui_for_playwright "$ui_base_url"

  local remote_runner_is_musl=0
  if [[ "${HARNESS_REMOTE_EXECUTING:-0}" == "1" ]] && command -v ldd >/dev/null 2>&1; then
    if ldd --version 2>&1 | grep -qi "musl"; then
      remote_runner_is_musl=1
    fi
  fi

  if [[ "$remote_runner_is_musl" == "1" ]] && command -v docker >/dev/null 2>&1; then
    local musl_playwright_docker_image="${PLAYWRIGHT_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
    local musl_docker_workspace_mount="$REPO_ROOT"
    if [[ -n "${TASK_WORKSPACE_PATH:-}" ]]; then
      musl_docker_workspace_mount="$TASK_WORKSPACE_PATH"
    fi
    echo "[harness:test] remote runner uses musl libc; running Playwright in containerized fallback"
    run_phase \
      "e2e:playwright:docker" \
      docker run --rm \
        -w /workspace \
        -v "$musl_docker_workspace_mount:/workspace" \
        -e AGENTSWARM_UI_BASE_URL="$ui_base_url" \
        -e CI="${CI:-1}" \
        -e NO_COLOR="${NO_COLOR:-1}" \
        -e FORCE_COLOR="${FORCE_COLOR:-0}" \
        -e PLAYWRIGHT_CAPTURE_VIDEO="${PLAYWRIGHT_CAPTURE_VIDEO:-0}" \
        "$musl_playwright_docker_image" \
        sh -lc "npx playwright test --config playwright.config.ts"
    return
  fi

  if [[ "${PLAYWRIGHT_SKIP_INSTALL:-0}" != "1" ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      run_phase "e2e:playwright-install" npx playwright install --with-deps chromium --only-shell
    else
      echo "[harness:test] apt-get not found; installing Playwright browser without OS package install"
      run_phase "e2e:playwright-install" npx playwright install chromium --only-shell
    fi
  else
    echo "[harness:test] skipping browser install (PLAYWRIGHT_SKIP_INSTALL=1)"
  fi

  if env AGENTSWARM_UI_BASE_URL="$ui_base_url" node -e 'const { chromium } = require("@playwright/test"); chromium.launch({ headless: true }).then((browser) => browser.close()).then(() => process.exit(0)).catch(() => process.exit(1));'; then
    run_phase "e2e:playwright" env AGENTSWARM_UI_BASE_URL="$ui_base_url" npx playwright test --config playwright.config.ts
    return
  fi

  if [[ "${HARNESS_REMOTE_EXECUTING:-0}" == "1" ]] && command -v docker >/dev/null 2>&1; then
    local playwright_docker_image="${PLAYWRIGHT_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
    local docker_workspace_mount="$REPO_ROOT"
    if [[ -n "${TASK_WORKSPACE_PATH:-}" ]]; then
      docker_workspace_mount="$TASK_WORKSPACE_PATH"
    fi
    echo "[harness:test] local Playwright launch probe failed in remote runner; falling back to containerized Playwright"
    run_phase \
      "e2e:playwright:docker" \
      docker run --rm \
        -w /workspace \
        -v "$docker_workspace_mount:/workspace" \
        -e AGENTSWARM_UI_BASE_URL="$ui_base_url" \
        -e CI="${CI:-1}" \
        -e NO_COLOR="${NO_COLOR:-1}" \
        -e FORCE_COLOR="${FORCE_COLOR:-0}" \
        -e PLAYWRIGHT_CAPTURE_VIDEO="${PLAYWRIGHT_CAPTURE_VIDEO:-0}" \
        "$playwright_docker_image" \
        sh -lc "npx playwright test --config playwright.config.ts"
    return
  fi

  echo "[harness:test] error: Playwright browser launch probe failed" >&2
  echo "[harness:test] fix: use a glibc-based runtime (or set PLAYWRIGHT_DOCKER_IMAGE and run in remote mode)" >&2
  exit 1
}

echo "[harness:test] repo root: $REPO_ROOT"
echo "[harness:test] scope: $TEST_SCOPE"
echo "[harness:test] deterministic seed: $AGENTSWARM_TEST_SEED"
echo "[harness:test] fixture root: $AGENTSWARM_TEST_FIXTURE_ROOT"
echo "[harness:test] discovered tests: total=${#all_tests[@]}, unit=${#unit_tests[@]}, integration=${#integration_tests[@]}, e2e=${#e2e_tests[@]}"

case "$TEST_SCOPE" in
  all)
    if [[ "${#unit_tests[@]}" -eq 0 ]]; then run_node_tests "unit"; else run_node_tests "unit" "${unit_tests[@]}"; fi
    if [[ "${#integration_tests[@]}" -eq 0 ]]; then run_node_tests "integration"; else run_node_tests "integration" "${integration_tests[@]}"; fi
    if [[ "${#e2e_tests[@]}" -eq 0 ]]; then run_node_tests "e2e:node"; else run_node_tests "e2e:node" "${e2e_tests[@]}"; fi
    run_playwright_e2e
    ;;
  unit)
    if [[ "${#unit_tests[@]}" -eq 0 ]]; then run_node_tests "unit"; else run_node_tests "unit" "${unit_tests[@]}"; fi
    ;;
  integration)
    if [[ "${#integration_tests[@]}" -eq 0 ]]; then run_node_tests "integration"; else run_node_tests "integration" "${integration_tests[@]}"; fi
    ;;
  e2e)
    if [[ "${#e2e_tests[@]}" -eq 0 ]]; then run_node_tests "e2e:node"; else run_node_tests "e2e:node" "${e2e_tests[@]}"; fi
    run_playwright_e2e
    ;;
esac

echo "[harness:test]"
echo "[harness:test] all requested test phases passed"
