# Development Commands

## Harness Commands
- `./scripts/harness/doctor.sh`: verify tools and script availability.
- `./scripts/harness/setup.sh`: initialize Docker stack and local runtime folders.
- `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh`: also install npm dependencies.
- `./scripts/harness/check-docs.sh`: scan docs for broken internal links, TODO/FIXME counts, and stale review metadata warnings.
- `./scripts/harness/check-human-gated-flow.sh`: verify active execution plans contain required human-gated flow evidence.
- `./scripts/harness/check.sh`: compatibility wrapper for `npm run ci`.
- `node ./scripts/harness/boundary-check.mjs`: run architecture boundary checks only.
- `./scripts/harness/test.sh`: legacy scoped test runner.
- `./scripts/harness/pr-ready.sh`: compatibility wrapper for `npm run ci`.
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
- If the web host port is occupied, override `PUBLIC_PORT`. Redis and Postgres are not published as host ports in the Docker stack.

## Root Package Manager Commands
- `npm run dev`: runs server and web dev processes together.
- `npm run dev:server`: runs backend only.
- `npm run dev:web`: runs frontend only.
- `npm run ci`: runs dependency install, lint, build, and tests inside a single Node Docker container, then removes the container and image.
- `npm test`: runs server and web tests.
- `npm run typecheck`: alias to repository type checks (`npm run lint`).
- `npm run build`: builds shared-types, server, and web.
- `npm run lint`: TypeScript no-emit checks for server and web.

Notes:
- `setup.sh` only installs npm dependencies when `HARNESS_INSTALL_NPM_DEPS=1` is set.
- `npm run ci` does not require host `node_modules`; it runs `npm ci --include=dev` inside Docker.
- `npm run ci` removes its Docker container and image when it exits. Set `CI_DOCKER_KEEP_IMAGE=1` only when deliberately debugging image reuse.
- On clean checkout, install dependencies before running host-local lint or tests directly.
- Harness setup installs dependencies with `npm ci --include=dev`.
- `npm ci` requires `python3` in this repo because `node-pty` may need local native build steps.

## Workspace Commands
- Server (`@verft/server`):
  - `npm run -w @verft/server dev`
  - `npm run -w @verft/server start`
  - `npm run -w @verft/server build`
  - `npm run -w @verft/server lint`
  - `npm run -w @verft/server test`
  - `npm run -w @verft/server db:migrate`
- Web (`@verft/web`):
  - `npm run -w @verft/web dev`
  - `npm run -w @verft/web start`
  - `npm run -w @verft/web build`
  - `npm run -w @verft/web lint`
  - `npm run -w @verft/web test`
- Shared types (`@verft/shared-types`):
  - `npm run -w @verft/shared-types build`

## Existing Docker Control Commands
- `./verft init`
- `./verft start`
- `./verft rebuild`
- `./verft rebuild --clean`
- `./verft update`
- `./verft stop`

`init` and `rebuild` build the unified agent toolbox image from `agent-runtime/Dockerfile`. Builds use Docker's cache by default; pass `--clean` to `rebuild` to pull base images and disable the build cache. Override the tag with `AGENT_RUNTIME_IMAGE` when testing a custom runtime image.

`update` runs `git pull --ff-only` for the current branch, then performs the cached rebuild. If Git cannot fast-forward or pull successfully, the rebuild does not run.

## CI / Local Parity Notes
- CI workflow: `.github/workflows/lint-and-tests.yml`.
- CI runs:
  - `./scripts/ci.sh`, which runs `npm ci`, lint, build, and tests in `node:22-bookworm`.
- Local pre-PR flow remains:
  - `npm run ci`

## TODO
- TODO: Add a canonical root format-check command (`format:check` or `fmt:check`) if/when a formatter is adopted.
