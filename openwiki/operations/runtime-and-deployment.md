# Runtime and Deployment Operations

Verft’s default operating model is local Docker Compose plus short-lived Docker runtime containers for agent work. This page covers the stack, agent toolbox image, hostexec bridge, configuration, CI, and GitHub workflows.

Primary evidence: `README.md`, `docker-compose.yml`, `verft.sh`, `.env.example`, `apps/server/src/config/env.ts`, `agent-runtime/*`, `hostexec/*`, `scripts/ci.sh`, `docs/development/*`, and `.github/workflows/*`.

## Docker Compose stack

`docker-compose.yml` defines:

- `redis`: `redis:7-alpine`, durable `redis_data` volume.
- `postgres`: `postgres:16-alpine`, durable `postgres_data`, healthcheck on database `verft`.
- `server`: built from `apps/server/Dockerfile`, env wired to Redis/Postgres, repository cache, runtime payloads, task workspaces, server secrets, Docker socket, and host gateway.
- `web`: built from `apps/web/Dockerfile`.
- `proxy`: `nginx:1.27-alpine`, publishes `${PUBLIC_PORT:-3217}:3217`, mounts `deploy/nginx.conf`.

Only the proxy publishes a host port by default. Redis/Postgres/server/web communicate internally.

## Stack helper

`verft.sh` is the main local stack helper:

```bash
./verft.sh init     # alias for rebuild
./verft.sh start
./verft.sh rebuild
./verft.sh stop
./verft.sh help
```

`init`/`rebuild` build the agent toolbox image from `agent-runtime/Dockerfile`, rebuild Compose images, and start services. `start` starts Compose and warns if the runtime image is missing. The helper loads `.env` without overriding already-exported environment variables, detects `docker compose` vs `docker-compose`, and ensures the task workspace directory exists when configured as a path.

## Agent toolbox runtime

`agent-runtime/Dockerfile` builds `verft-agent-toolbox:latest` by default. It is based on `node:20-bookworm` and installs:

- bash, Git, GitHub CLI (`gh`), OpenSSH client;
- Docker CLI/buildx/compose plugin for nested Docker-backed checks;
- Python, g++, make, ripgrep, vim/neovim;
- OpenAI Codex CLI via npm;
- Claude Code via Anthropic install script;
- Verft runner scripts: `run-task-codex.mjs`, `run-task-claude.mjs`, `verft-base-state.mjs`, `hostexec-proxy.mjs`.

`run-task-codex.mjs` and `run-task-claude.mjs` require runtime manifest/config env vars, restore provider state, set Git askpass when `GIT_TOKEN` is present, preserve hostexec shim path, stream provider output, and write raw event/result files. Codex requires `OPENAI_API_KEY` or a persisted Codex base login. Claude requires `ANTHROPIC_API_KEY` or a persisted Claude base login.

## Docker socket access

Docker socket access is enabled by default in local config (`DOCKER_SOCKET_ACCESS_ENABLED=true` in `.env.example` and `apps/server/src/config/env.ts`). This lets toolbox containers run Docker-backed checks and nested containers, but it is a high-risk capability equivalent to broad host control from inside the runtime container.

Relevant env names:

- `DOCKER_SOCKET_ACCESS_ENABLED`
- `DOCKER_SOCKET_HOST_PATH`
- `DOCKER_SOCKET_CONTAINER_PATH_CODEX`
- `DOCKER_SOCKET_CONTAINER_PATH_CLAUDE`

Change this with care and test `apps/server/src/lib/docker-socket-access.test.ts` plus runtime mount behavior.

## Hostexec bridge

Hostexec optionally exposes selected manually started host commands, such as `xcodebuild`, to agent containers.

1. Start the host daemon:

   ```bash
   npm run hostexec
   ```

2. Configure repository **Host Commands** with simple command names (`xcodebuild`, `xcrun`, `gradlew`, etc.).
3. If using bearer auth, set `HOSTEXEC_TOKEN` in the host environment and enter `HOSTEXEC_TOKEN` as the env var name in Settings.

`hostexec/daemon.mjs` reads `.env`/process env, defaults to `127.0.0.1:38128`, validates command names, optionally restricts to allowed commands, checks bearer token, resolves cwd under the host workspace root, and streams NDJSON stdout/stderr/exit events.

`agent-runtime/hostexec-proxy.mjs` runs inside the container shim path. It validates the command, checks the current directory is inside `HOSTEXEC_WORKSPACE_ROOT`, maps the relative cwd to `HOSTEXEC_HOST_WORKSPACE_ROOT`, and calls the daemon `/exec` endpoint. Verft mounts generated shims read-only under `/hostexec/bin` and prepends that directory to `PATH`.

## Configuration and credentials

`.env.example` contains local bootstrap and infrastructure settings:

- default admin account values used only on first creation;
- cookie/session settings;
- Sentry toggles;
- agent runtime image and Docker socket access;
- hostexec host/port/token env name;
- public port and CORS origin.

Provider API keys and GitHub credentials are managed through the Verft Settings UI and stored as encrypted credentials, not copied into `.env`. Repository env secrets are write-only and should only be documented by configured flag/name, never by value.

## CI and test operations

Root `package.json` scripts:

- `npm run ci` — Dockerized CI via `scripts/ci.sh`.
- `npm test` — server and web tests.
- `npm run lint` / `npm run typecheck` — TypeScript no-emit checks.
- `npm run build` — shared-types, server, web.
- `npm run dev`, `dev:server`, `dev:web` — local dev processes.

`scripts/ci.sh` runs a `node:22-bookworm` container with the repo mounted at `/workspace` and executes:

```bash
npm ci --include=dev && npm run lint && npm run build && npm test
```

`docs/development/testing.md` recommends `npm run ci` as the canonical verification command. The `lint-and-tests` GitHub workflow runs `./scripts/ci.sh` on pull requests and pushes to `main`.

## Development harness

Useful scripts from `docs/development/commands.md`:

- `./scripts/harness/doctor.sh` — verify tools/scripts.
- `./scripts/harness/setup.sh` — initialize Docker stack and runtime folders.
- `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh` — setup plus npm deps.
- `./scripts/harness/check-docs.sh` — docs link/TODO/staleness scan.
- `./scripts/harness/check-human-gated-flow.sh` — execution plan evidence check.
- `./scripts/harness/start.sh` — start dev stack and wait for health.
- `./scripts/harness/test.sh` — legacy scoped runner, including E2E support.
- `./scripts/harness/pr-ready.sh` and `check.sh` — compatibility wrappers for `npm run ci`.

Remote build mode exists for harness scripts via `REMOTE_BUILD=1` and a runner URL/image, but normal repository verification should start with `npm run ci`.

## GitHub workflows and OpenWiki

Current workflows:

- `.github/workflows/lint-and-tests.yml`: pull request and main-push CI running `./scripts/ci.sh`.
- `.github/workflows/openwiki-init.yml`: manual workflow that installs OpenWiki, runs `openwiki code --init --print`, and opens an init PR adding `openwiki` (and `AGENTS.md` in `add-paths`). It currently uses `OPENAI_API_KEY`, `OPENWIKI_MODEL_ID=gpt-5.5`, and tracing disabled.
- `.github/workflows/openwiki-update.yml`: manual + daily scheduled workflow that installs OpenWiki, runs `openwiki code --update --print`, and opens an update PR for `openwiki`, agent instruction files, and the update workflow itself.

In the current working tree, `.github/workflows/openwiki-update.yml` does not use the `Build` environment and runs updates with `OPENROUTER_API_KEY`, `OPENWIKI_MODEL_ID=z-ai/glm-5.2`, `LANGSMITH_API_KEY`, `LANGCHAIN_PROJECT=openwiki`, and tracing enabled. Its create-pull-request step is pinned to a v7 commit SHA and includes `openwiki`, `AGENTS.md`, `CLAUDE.md`, and `.github/workflows/openwiki-update.yml` in `add-paths`; `CLAUDE.md` is currently untracked and contains an OpenWiki generated-doc guidance block. Treat this as current local state until committed.

## Operational watchpoints

- Do not expose the default bootstrap admin password outside local development.
- Consider Docker socket access a privileged security boundary.
- Hostexec should expose only narrow command names needed by a repository and must run with workspace containment.
- Keep `.env` and real credentials out of docs and chat. Document env var names and UI setup paths only.
- If changing runtime image contents, test both automated tasks and interactive terminals.
- If changing Compose ports/networking, update `README.md`, `docs/development/*`, and this wiki.
