# PR Workflow

This page describes the expected pull request readiness flow for this repository.

## Recommended Sequence
1. Run `./scripts/harness/doctor.sh`.
2. Run `./scripts/harness/setup.sh` if dependencies changed.
3. Run `./scripts/harness/pr-ready.sh`.
4. If checks pass, open a pull request and complete the PR template.

Note:
- `pr-ready.sh` auto-runs setup when dependencies are missing and forces npm dependency installation.

## What `pr-ready.sh` checks
- Format check:
  - runs `format:check` or `fmt:check` if defined at root
  - skips by default when no format-check script exists
  - can be enforced by setting `HARNESS_REQUIRE_FORMAT_CHECK=1`
- Boundary checks.
- Lint checks.
- Type checks.
- Tests (server and web).
- Build.
- Repo-specific check: Docker Compose config validation when Docker is available.

## Current limitation
- This repository does not currently define a root format-check command.
- Result: format-check step is skipped unless a format-check script is added.

## TODO
- TODO: Add a canonical root format-check script (for example `format:check`) and wire it into the harness.
