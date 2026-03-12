#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${REPO_URL:-}" ]]; then
  echo "REPO_URL is required"
  exit 1
fi

BASE_BRANCH="${BASE_BRANCH:-develop}"
REPO_DEFAULT_BRANCH="${REPO_DEFAULT_BRANCH:-$BASE_BRANCH}"
BRANCH_NAME="${BRANCH_NAME:-agentswarm/task}"
TASK_TITLE="${TASK_TITLE:-AgentSwarm task}"
TASK_PLAN_PATH="${TASK_PLAN_PATH:-local-plans/plan.md}"
TASK_BRANCH_STRATEGY="${TASK_BRANCH_STRATEGY:-feature_branch}"
TASK_REQUIREMENTS_FILE="${TASK_REQUIREMENTS_FILE:-}"
TASK_PLAN_MARKDOWN_FILE="${TASK_PLAN_MARKDOWN_FILE:-}"
TASK_EXECUTION_SUMMARY_FILE="${TASK_EXECUTION_SUMMARY_FILE:-}"
TASK_REPO_PROFILE_FILE="${TASK_REPO_PROFILE_FILE:-}"
TASK_ITERATION_INPUT_FILE="${TASK_ITERATION_INPUT_FILE:-}"
TASK_AGENT_RULES_FILE="${TASK_AGENT_RULES_FILE:-}"
CODEX_CONFIG_FILE="${CODEX_CONFIG_FILE:-}"
REPO_CACHE_PATH="${REPO_CACHE_PATH:-}"
TASK_MODEL="${TASK_MODEL:-}"
TASK_REASONING_EFFORT="${TASK_REASONING_EFFORT:-}"
EXECUTION_ACTION="${EXECUTION_ACTION:-build}"
GIT_USER_NAME="${GIT_USER_NAME:-AgentSwarm Bot}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-agentswarm@local.dev}"
GIT_USERNAME="${GIT_USERNAME:-x-access-token}"
GIT_TOKEN="${GIT_TOKEN:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"

read_context_file() {
  local file_path="${1:-}"
  if [[ -z "$file_path" || ! -f "$file_path" ]]; then
    return 0
  fi

  cat "$file_path"
}

TASK_REQUIREMENTS="$(read_context_file "$TASK_REQUIREMENTS_FILE")"
TASK_PLAN_MARKDOWN="$(read_context_file "$TASK_PLAN_MARKDOWN_FILE")"
TASK_EXECUTION_SUMMARY="$(read_context_file "$TASK_EXECUTION_SUMMARY_FILE")"
TASK_REPO_PROFILE="$(read_context_file "$TASK_REPO_PROFILE_FILE")"
TASK_ITERATION_INPUT="$(read_context_file "$TASK_ITERATION_INPUT_FILE")"
TASK_AGENT_RULES="$(read_context_file "$TASK_AGENT_RULES_FILE")"
CODEX_CONFIG_CONTENT="$(read_context_file "$CODEX_CONFIG_FILE")"

if [[ -z "$TASK_REQUIREMENTS" ]]; then
  echo "TASK_REQUIREMENTS is required"
  exit 1
fi

export HOME=/root
mkdir -p "${HOME}/.codex"
if [[ -n "$CODEX_CONFIG_CONTENT" ]]; then
  printf '%s\n' "$CODEX_CONFIG_CONTENT" > "${HOME}/.codex/config.toml"
  echo "[runtime] wrote Codex config with MCP server definitions"
fi
WORK_DIR="/tmp/work"
REPO_DIR="${WORK_DIR}/repo"

mkdir -p "$WORK_DIR"
rm -rf "$REPO_DIR"

if [[ -n "$GIT_TOKEN" ]]; then
  export GIT_TERMINAL_PROMPT=0
  export GIT_USERNAME
  export GIT_TOKEN
  cat > /tmp/git-askpass.sh <<'ASKPASS'
#!/usr/bin/env sh
case "$1" in
  *sername*) echo "$GIT_USERNAME" ;;
  *assword*) echo "$GIT_TOKEN" ;;
  *) echo "" ;;
esac
ASKPASS
  chmod +x /tmp/git-askpass.sh
  export GIT_ASKPASS=/tmp/git-askpass.sh
  echo "[runtime] git token authentication enabled via GIT_ASKPASS"
fi

if [[ -n "$OPENAI_API_KEY" ]]; then
  export OPENAI_API_KEY
fi
if [[ -n "$OPENAI_BASE_URL" ]]; then
  export OPENAI_BASE_URL
fi

if [[ -n "$REPO_CACHE_PATH" && -d "$REPO_CACHE_PATH" ]]; then
  echo "[runtime] cloning repository from local mirror cache: $REPO_CACHE_PATH"
  git clone "$REPO_CACHE_PATH" "$REPO_DIR"
  cd "$REPO_DIR"
  git remote set-url origin "$REPO_URL"
else
  echo "[runtime] cloning repository: $REPO_URL"
  git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

echo "[runtime] checking out branch: $BASE_BRANCH"
git fetch origin "$BASE_BRANCH" || true
git checkout "$BASE_BRANCH" || git checkout -b "$BASE_BRANCH"
START_REF="$(git rev-parse HEAD)"

if [[ "$EXECUTION_ACTION" == "review" && "$REPO_DEFAULT_BRANCH" != "$BASE_BRANCH" ]]; then
  echo "[runtime] fetching default branch for review comparison: $REPO_DEFAULT_BRANCH"
  git fetch origin "$REPO_DEFAULT_BRANCH" || true
fi

if [[ "$EXECUTION_ACTION" == "build" ]]; then
  if [[ "$TASK_BRANCH_STRATEGY" == "work_on_branch" ]]; then
    BRANCH_NAME="$BASE_BRANCH"
    echo "[runtime] work_on_branch enabled; building directly on $BASE_BRANCH"
  else
    echo "[runtime] preparing feature branch: $BRANCH_NAME"
    if git ls-remote --exit-code --heads origin "$BRANCH_NAME" >/dev/null 2>&1; then
      git fetch origin "$BRANCH_NAME"
      git checkout -B "$BRANCH_NAME" "origin/$BRANCH_NAME"
    else
      git checkout -B "$BRANCH_NAME"
    fi
  fi
elif [[ "$EXECUTION_ACTION" == "review" ]]; then
  echo "[runtime] review mode active; comparing $BASE_BRANCH against default branch $REPO_DEFAULT_BRANCH without modifying or pushing a branch"
else
  echo "[runtime] non-mutating mode active; staying on branch $BASE_BRANCH without creating or pushing a feature branch"
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[runtime] codex not found, attempting npm install -g @openai/codex"
  npm install -g @openai/codex || true
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[runtime] codex CLI is required but unavailable"
  exit 1
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "[runtime] ripgrep (rg) is required but unavailable"
  exit 1
fi

echo "[runtime] rg available: $(rg --version | head -n 1)"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "[runtime] OPENAI_API_KEY is missing. Configure it in AgentSwarm Settings before running this task."
  exit 1
fi

echo "[runtime] authenticating codex with OPENAI_API_KEY"
printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key

GLOBAL_RULES_PROMPT=""
if [[ -n "$TASK_AGENT_RULES" ]]; then
  GLOBAL_RULES_PROMPT=$(cat <<PROMPT

Global Agent Rules:
$TASK_AGENT_RULES

These rules apply to every action unless they directly conflict with the explicit task requirements.
PROMPT
)
fi

ACTION_PROMPT=""
case "$EXECUTION_ACTION" in
  plan)
    ACTION_PROMPT=$(cat <<PROMPT
You are planning work for the repository at $(pwd).

Task title:
$TASK_TITLE

Requirements:
$TASK_REQUIREMENTS

Repository profile:
$TASK_REPO_PROFILE
$GLOBAL_RULES_PROMPT

Inspect the repository and create an implementation plan in markdown with sections:
- Overview
- Repo Findings
- Files To Change
- Implementation Steps
- Validation
- Risks

Important:
- Return only markdown content for the plan.
- Do not ask for additional input.
- Be concrete. The plan must describe the likely code changes, not just process steps.
- In "Overview", summarize the problem and intended outcome without repeating the full requirements.
- In "Repo Findings", list the concrete files, modules, or code paths you inspected and why they matter.
- In "Repo Findings", include short code snippets only when they clarify a key implementation constraint.
- In "Files To Change", organize the plan file-by-file, explain why each file matters, and include the proposed edits directly under that file entry.
- Do not create a separate "Suggested Code Changes" section.
- When proposing file edits, prefer fenced markdown code blocks whose language is set to diff.
- For diff blocks, prefer full git-style unified diffs with diff --git, ---, +++, and valid @@ -old,+new @@ hunk headers so the UI can render them reliably.
- In "Validation", list only the concrete checks or commands needed to verify the planned change.
- Omit "Risks" if there are no meaningful risks.
- Do not actually modify files during planning.
PROMPT
)
    ;;
  build)
    ACTION_PROMPT=$(cat <<PROMPT
You are implementing a task in the repository at $(pwd).

Task title:
$TASK_TITLE

Requirements:
$TASK_REQUIREMENTS

Repository profile:
$TASK_REPO_PROFILE

Execution summary:
$TASK_EXECUTION_SUMMARY
$GLOBAL_RULES_PROMPT

Implement the required code changes directly in this repository, then stop.
Do not restate the entire plan. Use the execution summary as the authoritative compact context.
PROMPT
)
    ;;
  iterate)
    ACTION_PROMPT=$(cat <<PROMPT
You are revising an implementation plan for the repository at $(pwd).

Task title:
$TASK_TITLE

Requirements:
$TASK_REQUIREMENTS

Repository profile:
$TASK_REPO_PROFILE

Current plan markdown:
${TASK_PLAN_MARKDOWN:-"(no plan has been generated yet; use the execution summary below as the current draft)"}

Current execution summary:
$TASK_EXECUTION_SUMMARY

Iteration request:
$TASK_ITERATION_INPUT
$GLOBAL_RULES_PROMPT

Revise the plan to incorporate the iteration request, then stop.
Return only the complete updated markdown plan.
Keep the same plan structure and sections as the initial planning step.
Do not modify files.
Do not create commits.
Do not push any branch.
PROMPT
)
    ;;
  review)
    ACTION_PROMPT=$(cat <<PROMPT
You are reviewing the implementation on branch $BASE_BRANCH in the repository at $(pwd).

Compare it against the repository default branch:
$REPO_DEFAULT_BRANCH

Requirements:
$TASK_REQUIREMENTS

Repository profile:
$TASK_REPO_PROFILE
$GLOBAL_RULES_PROMPT

Inspect the branch diff against $REPO_DEFAULT_BRANCH and the relevant changed files, then return a markdown review with sections:
- Verdict
- Summary
- Findings
- Recommended Changes
- Validation

Important:
- Return only markdown.
- In "Verdict", output exactly one of: approved, changes_requested.
- If the implementation is acceptable, say approved and keep findings concise.
- If changes are needed, explain the concrete issues and how to fix them.
- Do not modify files.
- Do not create commits.
- Do not push any branch.
PROMPT
)
    ;;
  ask)
    ACTION_PROMPT=$(cat <<PROMPT
You are answering a repository question for the branch $BASE_BRANCH at $(pwd).

Task title:
$TASK_TITLE

Question:
$TASK_REQUIREMENTS

Repository profile:
$TASK_REPO_PROFILE
$GLOBAL_RULES_PROMPT

Answer the question in markdown only.
If code snippets help, use fenced code blocks.
Do not modify files.
Do not create commits.
Do not push any branch.
PROMPT
)
    ;;
  *)
    echo "[runtime] unsupported EXECUTION_ACTION: $EXECUTION_ACTION"
    exit 1
    ;;
esac

LAST_MESSAGE_FILE="/tmp/codex-last-message.txt"
rm -f "$LAST_MESSAGE_FILE"

CODEX_ARGS=(
  exec
  --dangerously-bypass-approvals-and-sandbox
  -C "$REPO_DIR"
  --color never
  --output-last-message "$LAST_MESSAGE_FILE"
)

if [[ -n "$TASK_MODEL" ]]; then
  CODEX_ARGS+=(-m "$TASK_MODEL")
fi

if [[ -n "$TASK_REASONING_EFFORT" ]]; then
  CODEX_ARGS+=(-c "model_reasoning_effort=\"$TASK_REASONING_EFFORT\"")
fi

echo "[runtime] running codex exec action=$EXECUTION_ACTION model=${TASK_MODEL:-default} effort=${TASK_REASONING_EFFORT:-default}"
set +e
codex "${CODEX_ARGS[@]}" "$ACTION_PROMPT"
CODEX_EXIT=$?
set -e

if [[ -f "$LAST_MESSAGE_FILE" ]]; then
  echo "[runtime] codex final message begin"
  cat "$LAST_MESSAGE_FILE"
  echo "[runtime] codex final message end"
fi

if [[ "$CODEX_EXIT" -ne 0 ]]; then
  echo "[runtime] codex exited with code $CODEX_EXIT"
  exit "$CODEX_EXIT"
fi

git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

if [[ "$EXECUTION_ACTION" == "review" ]]; then
  echo "[runtime] branch diff begin"
  git diff "origin/$REPO_DEFAULT_BRANCH...HEAD" || true
  echo "[runtime] branch diff end"
fi

if [[ "$EXECUTION_ACTION" == "plan" || "$EXECUTION_ACTION" == "iterate" || "$EXECUTION_ACTION" == "review" || "$EXECUTION_ACTION" == "ask" ]]; then
  if [[ ! -f "$LAST_MESSAGE_FILE" ]]; then
    echo "[runtime] missing markdown output"
    exit 21
  fi

  if [[ "$EXECUTION_ACTION" == "plan" || "$EXECUTION_ACTION" == "iterate" ]]; then
    echo "[runtime] plan markdown generated; local storage handled by AgentSwarm server at $TASK_PLAN_PATH"
  else
    echo "[runtime] result markdown generated"
  fi
  echo "[runtime] completed"
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  echo "[runtime] no changes detected after codex; failing task"
  exit 20
fi

git commit -m "feat(agentswarm): ${TASK_TITLE}"

echo "[runtime] branch diff begin"
git diff "$START_REF..HEAD" || true
echo "[runtime] branch diff end"

echo "[runtime] pushing branch $BRANCH_NAME"
set +e
git push -u origin "$BRANCH_NAME"
PUSH_EXIT=$?
set -e

if [[ "$PUSH_EXIT" -ne 0 ]]; then
  echo "[runtime] initial push failed; attempting fetch+rebase retry"
  git fetch origin "$BRANCH_NAME" || true
  if git rev-parse --verify "origin/$BRANCH_NAME" >/dev/null 2>&1; then
    set +e
    git rebase "origin/$BRANCH_NAME"
    REBASE_EXIT=$?
    set -e
    if [[ "$REBASE_EXIT" -ne 0 ]]; then
      echo "[runtime] rebase failed; aborting rebase"
      git rebase --abort || true
      exit 22
    fi
  fi

  git push -u origin "$BRANCH_NAME"
fi

echo "[runtime] completed"
