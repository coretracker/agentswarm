#!/bin/sh
set -eu

workspace="${TASK_INTERACTIVE_WORKSPACE:-/workspace}"

if [ ! -d "$workspace" ]; then
  echo "Workspace not found: $workspace" >&2
  exit 1
fi

export GIT_TERMINAL_WORKSPACE="$workspace"
export PATH="/usr/local/git-terminal-bin"
export ENV=
export HISTFILE=/dev/null

cd "$workspace"

exec /bin/ash -r -i
