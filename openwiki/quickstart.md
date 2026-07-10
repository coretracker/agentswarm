# Verft OpenWiki Quickstart

Verft is a Docker-based web application for running AI coding work on real Git repositories. Users create **build** or **ask** tasks, run Codex or Claude in isolated toolbox containers, inspect logs/diffs/checkpoints, manage Git branches, and continue work through an interactive browser terminal. The product goal is agent-assisted coding with human visibility into repository state and reviewable changes.

This wiki is a synthesis layer over the source tree and existing docs. Start here, then follow the focused pages below.

## Major sections

- [Architecture overview](architecture/overview.md) — monorepo shape, service topology, boundaries, and cross-cutting flows.
- [Task lifecycle and product model](application/task-lifecycle.md) — tasks, repositories, settings, queueing, runs, checkpoints, Git actions, and terminal flows.
- [Backend guide](application/backend.md) — Fastify API, Postgres/Redis stores, scheduler, spawner, MCP, and backend tests.
- [Frontend guide](application/frontend.md) — Next.js app shell, pages, API client, realtime hooks, and UI watchpoints.
- [Runtime and deployment operations](operations/runtime-and-deployment.md) — Docker Compose, agent runtime image, hostexec, CI, config, and workflows.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/server` | Fastify backend API, auth, stores, task scheduler, runtime spawner, webhooks, MCP server. |
| `apps/web` | Next.js App Router frontend with Ant Design UI, task/repository/settings pages, Socket.IO hooks. |
| `packages/shared-types` | Shared TypeScript domain contracts, permission scopes, task/repository/settings types, provider defaults, UI label helpers. |
| `agent-runtime` | Unified toolbox Docker image and provider runner scripts for Codex and Claude task execution. |
| `hostexec` | Optional host daemon exposing selected host commands to runtime containers via generated shims. |
| `docs` | Existing architecture, product, development, quality, and execution-plan docs. Prefer linking to them instead of duplicating detailed runbooks. |
| `scripts/harness` and `scripts/ci.sh` | Development setup/check/test helpers; `npm run ci` uses `scripts/ci.sh`. |
| `docker-compose.yml`, `deploy/nginx.conf`, `verft.sh` | Local stack orchestration and reverse proxy. |

Primary source references: `README.md`, `ARCHITECTURE.md`, `docs/index.md`, `docs/architecture/domains.md`, `package.json`, and `docker-compose.yml`.

## Running locally

1. Copy sample environment values:

   ```bash
   cp .env.example .env
   ```

2. Build the toolbox runtime image and start the Docker stack:

   ```bash
   ./verft.sh init
   ```

3. Open `http://localhost:3217/login`.
4. Configure provider and GitHub credentials in **Settings**, then add a repository in **Repositories** and create a task in **Tasks**.

The Compose stack runs Redis, Postgres, server, web, and nginx proxy. Only nginx publishes the public port by default; server, Redis, and Postgres stay on the internal Compose network (`docker-compose.yml`).

## Common verification commands

Use the repository’s Dockerized CI as the default agent/human check:

```bash
npm run ci
```

That invokes `scripts/ci.sh`, which runs `npm ci --include=dev`, lint, build, and tests inside `node:22-bookworm`. Other useful commands from `package.json` and `docs/development/commands.md`:

- `npm test` — server and web tests.
- `npm run lint` — TypeScript no-emit checks for server and web.
- `npm run build` — shared-types, server, then web builds.
- `node ./scripts/harness/boundary-check.mjs` — mechanical architecture boundary checks.
- `./scripts/harness/start.sh` — start the dev stack and wait for health.

## Product vocabulary

Key terms are defined in `docs/product/terminology.md` and represented in `packages/shared-types/src/index.ts`:

- **Task**: unit of AI work against a repository.
- **Build task**: change-producing agent run.
- **Ask task**: read/answer-oriented run.
- **Task workspace**: isolated filesystem checkout under `task-workspaces/` or the configured container mount.
- **Checkpoint / change proposal**: reviewable snapshot of build changes before apply/reject/revert.
- **Provider**: `codex` or `claude` runtime.
- **Repository MCP server / Host command**: per-repository runtime capabilities exposed to tasks and terminals.

## Change guidance for future agents

- Preserve boundaries: web and server must not import each other; both should import shared contracts through `@verft/shared-types` only. See `docs/architecture/boundaries.md` and `scripts/harness/boundary-check.mjs`.
- Validate all request and external payloads at server boundaries; route modules generally use Zod (`apps/server/src/routes/tasks.ts`, `repositories.ts`, `settings.ts`).
- Treat task execution as a multi-system flow: UI action → API validation/auth → Postgres task state → Redis queue → Docker runtime → task logs/runs/proposals → Socket.IO updates.
- Be cautious with privileged runtime surfaces: Docker socket mounts, repository secrets/env files, provider auth state, GitHub tokens, MCP servers, and hostexec command shims.
- Add or update tests for behavior changes. Existing backend tests cover many scheduler/spawner/store/webhook/MCP helpers; frontend tests cover utility logic and auth smoke E2E.
- Do not commit `task-workspaces/` or runtime payloads.

## Current git context at initialization

The inspected HEAD is `22d3dc16dd9ad529d4541cb51e7f0323e8f7d387` (`ci: add OpenWiki init workflow`). The working tree has an uncommitted modification to `.github/workflows/openwiki-update.yml`: it removes the `Build` environment and changes the update run from OpenAI/gpt-5.5/no tracing to OpenRouter `z-ai/glm-5.2` with LangSmith tracing env vars. Treat this as working-tree state, not committed baseline.
