# Development Commands

## Canonical Agent Harness Commands
- `./scripts/harness/doctor.sh`: verify tools and script availability.
- `./scripts/harness/setup.sh`: initialize Docker stack and local runtime folders.
- `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh`: also install npm dependencies for check/test/pr-ready.
- `./scripts/harness/check-docs.sh`: scan docs for broken internal links, TODO/FIXME counts, and stale review metadata warnings.
- `./scripts/harness/check-human-gated-flow.sh`: verify active execution plans contain required human-gated flow evidence.
- `./scripts/harness/check.sh`: run docs checks + human-gated flow checks + boundary checks + lint + build.
- `node ./scripts/harness/boundary-check.mjs`: run architecture boundary checks only.
- `./scripts/harness/test.sh`: run server + web tests.
- `./scripts/harness/pr-ready.sh`: run pull request readiness verification.
- `./scripts/harness/start.sh`: start dev processes (foreground).

## Remote Build Mode
- Set `REMOTE_BUILD=1` to force harness scripts to execute in the Remote Build Runner.
- Required with remote mode: `REMOTE_BUILD_IMAGE`.
- Optional override: `REMOTE_BUILD_RUNNER_URL` (default: `http://host.docker.internal:38127`).
- Remote runs use `TASK_WORKSPACE_PATH` when present for the runner `workdir`.
- Remote mode uses `TASK_WORKSPACE_PATH` as the runner workdir when present.
- Set `REMOTE_BUILD=0` (or unset it) to run harness scripts locally.
- Runner API note: `/run` expects `cmd` as a non-empty string array, not a single string.
- Remote runner image should include: `bash`, `node`, `npm`, `python3`, `docker`, and Docker Compose.
- For remote browser E2E: if the runner is musl-based, harness auto-falls back to `PLAYWRIGHT_DOCKER_IMAGE` (default `mcr.microsoft.com/playwright:v1.60.0-noble`).
- If the web host port is occupied, override `PUBLIC_PORT`.

## Root Package Manager Commands
- `npm run dev`: runs server and web dev processes together.
- `npm run dev:server`: runs backend only.
- `npm run dev:web`: runs frontend only.
- `npm run test`: canonical harness test run (`./scripts/harness/test.sh`).
- `npm run typecheck`: alias to repository type checks (`npm run lint`).
- `npm run build`: builds shared-types, server, and web.
- `npm run lint`: TypeScript no-emit checks for server and web.

Notes:
- `setup.sh` only installs npm dependencies when `HARNESS_INSTALL_NPM_DEPS=1` is set.
- On clean checkout, install dependencies before running `check.sh`, `test.sh`, or `pr-ready.sh`.
- `pr-ready.sh` forces dependency installation automatically when `node_modules` is missing.
- Harness setup installs dependencies with `npm ci --include=dev`.
- `npm ci` requires `python3` in this repo because `node-pty` may need local native build steps.
- `check.sh` and `pr-ready.sh` enforce human-gated flow evidence for active execution plans.
- Set `HARNESS_REQUIRE_ACTIVE_EXEC_PLAN=1` to fail when no active execution plan exists.

## Workspace Commands
- Server (`@agentswarm/server`):
  - `npm run -w @agentswarm/server dev`
  - `npm run -w @agentswarm/server start`
  - `npm run -w @agentswarm/server build`
  - `npm run -w @agentswarm/server lint`
  - `npm run -w @agentswarm/server test`
  - `npm run -w @agentswarm/server db:migrate`
  - `npm run -w @agentswarm/server db:backfill:redis-to-postgres`
- Web (`@agentswarm/web`):
  - `npm run -w @agentswarm/web dev`
  - `npm run -w @agentswarm/web start`
  - `npm run -w @agentswarm/web build`
  - `npm run -w @agentswarm/web lint`
  - `npm run -w @agentswarm/web test`
- Shared types (`@agentswarm/shared-types`):
  - `npm run -w @agentswarm/shared-types build`

## Existing Docker Control Commands
- `./agentswarm.sh init`
- `./agentswarm.sh start`
- `./agentswarm.sh rebuild`
- `./agentswarm.sh stop`

## CI / Local Parity Notes
- CI workflow: `.github/workflows/harness-check.yml`.
- CI runs:
  - `./scripts/harness/doctor.sh` when Docker is available on the runner.
  - `./scripts/harness/check.sh`.
  - `./scripts/harness/test.sh`.
- CI does **not** run `./scripts/harness/pr-ready.sh` because that would duplicate expensive checks already covered by doctor/check/test.
- Local pre-PR flow remains:
  - `./scripts/harness/pr-ready.sh`

## TODO
- TODO: Add a canonical root format-check command (`format:check` or `fmt:check`) if/when a formatter is adopted.
