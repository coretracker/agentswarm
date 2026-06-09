#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$REPO_ROOT"

echo "[harness:human-gated] repo root: $REPO_ROOT"

shopt -s nullglob
plan_candidates=(docs/exec-plans/active/*.md)
plans=()
for candidate in "${plan_candidates[@]}"; do
  if [[ "$(basename "$candidate")" == ".gitkeep" ]]; then
    continue
  fi
  plans+=("$candidate")
done

if [[ ${#plans[@]} -eq 0 ]]; then
  if [[ "${HARNESS_REQUIRE_ACTIVE_EXEC_PLAN:-0}" == "1" ]]; then
    echo "[harness:human-gated] error: no active execution plans found" >&2
    echo "[harness:human-gated] fix: create an active plan from docs/exec-plans/template.md" >&2
    exit 1
  fi
  echo "[harness:human-gated] no active execution plans found; skipping check (set HARNESS_REQUIRE_ACTIVE_EXEC_PLAN=1 to enforce)"
  exit 0
fi

required_labels=(
  "Requirements Read:"
  "Requirements Understood:"
  "Repository Research Complete:"
  "Uncertainties Logged:"
  "Human Review Completed:"
  "User Approval To Start:"
  "Baseline Checks Run:"
  "Visible Task List Updated:"
  "Task-Level Tests/Lint/Build:"
  "Self Review Complete:"
  "Code Review Complete:"
  "Final Verification Complete:"
  "Security/Privacy Review Complete:"
  "Docs/Changelog Updated:"
)

failure=0
for plan in "${plans[@]}"; do
  echo "[harness:human-gated] checking: $plan"
  if ! rg -q "^## Human-Gated Flow Evidence" "$plan"; then
    echo "[harness:human-gated] error: missing section '## Human-Gated Flow Evidence' in $plan" >&2
    failure=1
    continue
  fi
  for label in "${required_labels[@]}"; do
    if ! rg -q "^- ${label}" "$plan"; then
      echo "[harness:human-gated] error: missing checklist item '- ${label}' in $plan" >&2
      failure=1
    fi
  done
done

if [[ "$failure" -ne 0 ]]; then
  echo "[harness:human-gated] fix: use docs/exec-plans/template.md and include all required flow evidence items." >&2
  exit 1
fi

echo "[harness:human-gated] check passed"
