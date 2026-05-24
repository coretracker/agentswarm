# Agent Harness Guide

This file is a short operating guide for coding agents in this repository.

## Start Here
- If `REMOTE_BUILD=1`, export `REMOTE_BUILD_IMAGE` first.
- Run `./scripts/harness/doctor.sh`
- Run `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh` on clean checkout
- Run `./scripts/harness/check.sh`
- Run `./scripts/harness/test.sh` (canonical test command)
- Run `./scripts/harness/start.sh` (foreground dev mode)

## Expected PR Workflow
1. Run `./scripts/harness/pr-ready.sh`.
2. Fix any failing checks.
3. Complete the agent self-review checklist: `docs/development/agent-review.md`.
4. Open a PR using `.github/pull_request_template.md`.
5. Confirm docs are updated when behavior changes.

Note:
- `pr-ready.sh` includes architecture boundary checks.
- `test.sh` supports `TEST_SCOPE=unit|integration|e2e|all`.

## Documentation Table of Contents
- [Architecture Summary](ARCHITECTURE.md)
- [Docs Home](docs/index.md)
- [Development Setup](docs/development/setup.md)
- [Development Commands](docs/development/commands.md)
- [Testing](docs/development/testing.md)
- [Debugging](docs/development/debugging.md)
- [Agent Self-Review](docs/development/agent-review.md)
- [PR Workflow](docs/development/pr-workflow.md)
- [Architecture Docs](docs/architecture/index.md)
- [Product Docs](docs/product/index.md)
- [Quality Docs](docs/quality/scorecard.md)
- [Golden Principles](docs/quality/golden-principles.md)

## Execution Plans
- Small tasks can use inline plans in the task conversation.
- Complex tasks must create an execution plan using `docs/exec-plans/template.md`.
- Plans must be updated during work as steps complete or scope changes.
- Completed plans move from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.

## Operating Rules
- Prefer harness scripts in `scripts/harness/`.
- Treat non-zero exit codes as failures.
- Do not assume behavior that is not documented in this repository.
- Mark missing evidence as `TODO` instead of guessing.

## Remote Build Runner
Use `http://host.docker.internal:38127` and call `POST /run` with:
- `image`
- `workdir`
- `cmd` (non-empty string array, for example `["sh","-lc","echo ok"]`)

For `workdir`, prefer `TASK_WORKSPACE_PATH`.

Runner mount support:
- `dockerSocketContainerPath`: `/var/run/docker.sock` (available for mounting Docker into the runner container)

Harness remote mode:
- Set `REMOTE_BUILD=1` to force harness scripts to run in Remote Build Runner.
- Set `REMOTE_BUILD_IMAGE` to the container image used by the runner request.
- Optional: set `REMOTE_BUILD_RUNNER_URL` (defaults to `http://host.docker.internal:38127`).
- Harness scripts auto-route to `POST /run` before local execution when remote mode is enabled.
- Set `REMOTE_BUILD=0` (or unset it) to run harness scripts locally.
- Use a remote image that has: `bash`, `node`, `npm`, `python3`, `docker`, and Docker Compose.
- `test.sh` auto-falls back to `PLAYWRIGHT_DOCKER_IMAGE` (default `mcr.microsoft.com/playwright:v1.60.0-noble`) for browser E2E when the remote runner cannot launch Playwright locally.

## Sync Policy Reference
- GitHub sync ownership and conflict policy: [docs/github-sync-ownership-model.md](docs/github-sync-ownership-model.md)
