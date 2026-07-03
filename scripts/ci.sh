#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE="${CI_DOCKER_IMAGE:-node:22-bookworm}"
CONTAINER_NAME="${CI_DOCKER_CONTAINER_NAME:-verft-ci-$(date +%s)-$$}"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  if [[ "${CI_DOCKER_KEEP_IMAGE:-0}" != "1" ]]; then
    docker image rm "${IMAGE}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

tty_args=()
if [[ -t 1 ]]; then
  tty_args=(-t)
fi

echo "[ci] image: ${IMAGE}"
echo "[ci] container: ${CONTAINER_NAME}"
echo "[ci] repo: ${REPO_ROOT}"
echo "[ci] running npm ci, lint, build, and tests in a single Node container"

docker run --rm "${tty_args[@]}" \
  --name "${CONTAINER_NAME}" \
  --user "$(id -u):$(id -g)" \
  -e CI=1 \
  -e NODE_ENV=test \
  -e NPM_CONFIG_CACHE=/tmp/verft-npm-cache \
  -e HOME=/tmp/verft-home \
  -v "${REPO_ROOT}:/workspace" \
  -w /workspace \
  "${IMAGE}" \
  bash -lc 'mkdir -p "$HOME" "$NPM_CONFIG_CACHE" && node --version && npm --version && npm ci --include=dev && npm run lint && npm run build && npm test'
