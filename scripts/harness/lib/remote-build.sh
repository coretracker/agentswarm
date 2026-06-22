#!/usr/bin/env bash
set -euo pipefail

is_remote_build_enabled() {
  [[ "${REMOTE_BUILD:-0}" == "1" ]]
}

build_remote_command() {
  local script_path="$1"
  shift || true

  local -a passthrough_vars=(
    HARNESS_INSTALL_NPM_DEPS
    HARNESS_DB_RESET
    TEST_SCOPE
    DOC_STALE_DAYS
    FOLLOW
    TAIL_LINES
    AGENTSWARM_UI_BASE_URL
    AGENTSWARM_E2E_EMAIL
    AGENTSWARM_E2E_PASSWORD
    PLAYWRIGHT_CAPTURE_VIDEO
    PLAYWRIGHT_SKIP_INSTALL
    CI
    NODE_ENV
    TZ
    LANG
    LC_ALL
    NO_COLOR
    FORCE_COLOR
    AGENTSWARM_TEST_SEED
    PUBLIC_PORT
    TASK_WORKSPACE_PATH
    TASK_WORKSPACE_DOCKER_SOURCE
  )

  local -a cmd_parts=("env" "HARNESS_REMOTE_EXECUTING=1")
  local var_name=""
  for var_name in "${passthrough_vars[@]}"; do
    if [[ -n "${!var_name:-}" ]]; then
      cmd_parts+=("${var_name}=${!var_name}")
    fi
  done

  cmd_parts+=("bash" "$script_path")
  if [[ "$#" -gt 0 ]]; then
    cmd_parts+=("$@")
  fi

  local remote_cmd=""
  printf -v remote_cmd '%q ' "${cmd_parts[@]}"
  echo "${remote_cmd% }"
}

ensure_remote_build_execution() {
  local repo_root="$1"
  local script_path="$2"
  shift 2

  if [[ "${HARNESS_REMOTE_EXECUTING:-0}" == "1" ]]; then
    return 0
  fi
  if ! is_remote_build_enabled; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "[harness:remote] error: curl is required when REMOTE_BUILD=1" >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[harness:remote] error: node is required when REMOTE_BUILD=1" >&2
    exit 1
  fi

  local endpoint="${REMOTE_BUILD_RUNNER_URL:-http://host.docker.internal:38127}"
  local image="${REMOTE_BUILD_IMAGE:-}"
  local docker_socket_container_path="${REMOTE_BUILD_DOCKER_SOCKET_CONTAINER_PATH:-/var/run/docker.sock}"
  local workdir="${TASK_WORKSPACE_PATH:-$repo_root}"
  if [[ -z "$image" ]]; then
    echo "[harness:remote] error: REMOTE_BUILD_IMAGE is required when REMOTE_BUILD=1" >&2
    echo "[harness:remote] fix: export REMOTE_BUILD_IMAGE=<runner-image>" >&2
    echo "[harness:remote] or run locally with: REMOTE_BUILD=0 <harness-command>" >&2
    exit 1
  fi

  local remote_cmd=""
  remote_cmd="$(build_remote_command "$script_path" "$@")"
  echo "[harness:remote] REMOTE_BUILD=1; routing to Remote Build Runner"
  echo "[harness:remote] endpoint: ${endpoint}/run"
  echo "[harness:remote] image: $image"
  echo "[harness:remote] workdir: $workdir"

  local payload=""
  payload="$(IMAGE="$image" WORKDIR="$workdir" CMD_STRING="$remote_cmd" DOCKER_SOCKET_CONTAINER_PATH="$docker_socket_container_path" node -e 'const payload = { image: process.env.IMAGE, workdir: process.env.WORKDIR, cmd: ["sh", "-lc", process.env.CMD_STRING], dockerSocketContainerPath: process.env.DOCKER_SOCKET_CONTAINER_PATH || "/var/run/docker.sock" }; process.stdout.write(JSON.stringify(payload));')"

  local response=""
  response="$(curl -fsS -X POST "${endpoint%/}/run" -H "content-type: application/json" --data "$payload")"
  if [[ -n "$response" ]]; then
    printf '%s\n' "$response"
  fi

  local remote_exit_code=""
  remote_exit_code="$(printf '%s' "$response" | node -e 'let data = ""; process.stdin.on("data", (chunk) => { data += chunk; }); process.stdin.on("end", () => { try { const body = JSON.parse(data); if (typeof body.exitCode === "number") { process.stdout.write(String(body.exitCode)); return; } if (typeof body.code === "number") { process.stdout.write(String(body.code)); return; } if (body.result && typeof body.result.exitCode === "number") { process.stdout.write(String(body.result.exitCode)); return; } } catch {} const match = data.match(/\\[exit\\]\\s+code=(\\d+)/); if (match) { process.stdout.write(match[1]); } });')"

  if [[ -n "$remote_exit_code" && "$remote_exit_code" != "0" ]]; then
    echo "[harness:remote] remote command failed with exit code: $remote_exit_code" >&2
    exit "$remote_exit_code"
  fi

  exit 0
}
