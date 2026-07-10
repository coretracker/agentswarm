# Architecture Overview

Verft is a TypeScript monorepo with a Docker-first runtime. The main architectural split is:

- `apps/web`: browser UI and realtime clients.
- `apps/server`: backend API, orchestration, stores, scheduler, runtime spawner, webhooks, MCP server.
- `packages/shared-types`: public contracts and shared domain helpers.
- `agent-runtime` and `hostexec`: execution substrate for AI agents and optional host command bridging.

Existing source docs to consult first: `README.md`, `ARCHITECTURE.md`, `docs/architecture/index.md`, `docs/architecture/domains.md`, and `docs/architecture/boundaries.md`.

## Service topology

Local deployment is defined in `docker-compose.yml`:

```text
browser
  -> nginx proxy on PUBLIC_PORT, default 3217
      -> Next.js web app
      -> Fastify server API/WebSocket/MCP
server
  -> Postgres for durable application state
  -> Redis for sessions, task queue, realtime pub/sub, webhook jobs
  -> Docker daemon for toolbox runtime containers
  -> task workspace and runtime payload volumes/bind mounts
```

`apps/server/src/index.ts` logs this split explicitly as `durableStores: "postgres"` and `runtimeServices: "redis"`. It also registers CORS/cookies, raw JSON parsing for signature-verified webhooks, Sentry, Socket.IO, Postgres migrations, stores, routes, terminal WebSocket upgrades, and `/mcp`.

## Monorepo boundaries

`docs/architecture/boundaries.md` defines the boundary rules:

1. `apps/web` must not import from `apps/server`.
2. `apps/server` must not import from `apps/web`.
3. `packages/shared-types` must not import from apps.
4. apps must import shared contracts from `@verft/shared-types`, not by relative filesystem path.
5. no deep imports from `@verft/shared-types/...`.

Run `node ./scripts/harness/boundary-check.mjs` to check these mechanically. This is not currently part of the default lint/test CI gate, so future agents should run it when moving code across layers.

## Core runtime flow

A typical build task crosses almost every major subsystem:

1. Web UI submits a task through `apps/web/src/api/client.ts`.
2. `apps/server/src/routes/tasks.ts` validates the request with Zod and checks auth/repository/task permissions.
3. `apps/server/src/services/task-store.ts` persists task state, messages, logs, runs, Git operations, and change proposals in Postgres tables defined by `apps/server/src/db/migrations.ts`.
4. `apps/server/src/services/scheduler.ts` writes a Redis queue entry and drains subject to `settings.maxAgents`.
5. `apps/server/src/services/spawner.ts` prepares a task workspace, Git branch/worktree state, runtime manifests, env/secrets, MCP config, Docker mounts, and provider state.
6. `agent-runtime/run-task-codex.mjs` or `agent-runtime/run-task-claude.mjs` invokes the provider CLI inside the toolbox image and writes normalized results/raw events.
7. The server records logs/runs/results, creates pending checkpoints for build changes, and publishes events through Redis/Socket.IO.
8. Web hooks merge/refetch realtime updates and render task history, diffs, run timelines, and review actions.

Ask tasks follow the same broad path but are read-oriented; build tasks are writable and can create reviewable checkpoints.

## Data and event model

Postgres migrations (`apps/server/src/db/migrations.ts`) create these durable areas:

- Auth/RBAC: `users`, `roles`, `user_roles`, personal access tokens.
- Repository configuration: `repositories`, repository env vars/secrets, MCP servers, GitHub/Slack/harness/default-agent settings.
- System settings and encrypted credentials: `system_settings`, `credentials`, `user_notes`.
- Tasks and execution history: `tasks`, `task_messages`, `task_logs`, `task_runs`, `task_run_logs`, `task_change_proposals`, `task_git_operations`, terminal session/transcript tables.
- Queue state is in Redis via `apps/server/src/services/task-queue-store.ts`; durable task execution state is still mirrored in Postgres.

Realtime events are published from stores/services through `EventBus` (`apps/server/src/lib/events.ts`) and forwarded by Socket.IO in `apps/server/src/index.ts`. Frontend hooks such as `useTask`, `useTasks`, `useTaskMessages`, `useTaskRuns`, and `useRepositories` subscribe to the corresponding events.

## Shared contracts

`packages/shared-types/src/index.ts` is the canonical shared API/domain surface. It defines:

- providers (`codex`, `claude`), models, effort/profile options, and label helpers;
- task status dimensions: legacy/current `TaskStatus`, `TaskWorkflowStatus`, `TaskExecutionStatus`, `TaskAction`, review reasons, terminal modes;
- `Task`, `TaskMessage`, `TaskRun`, `TaskChangeProposal`, workspace file/diff/Git types;
- `Repository` with env vars/secrets, MCP servers, host commands, GitHub/Slack integration fields, harness fields, and default provider settings;
- permission scopes and user/role/settings contracts.

When adding fields, update shared types first, then server persistence/formatting/routes, then web forms/hooks/components.

## Security and privilege boundaries

Important operational boundaries are source-enforced by convention and helper modules, not a single policy engine:

- Runtime containers may receive Docker socket access when enabled (`.env.example`, `apps/server/src/config/env.ts`, `apps/server/src/lib/docker-socket-access.ts`). This effectively grants host-level control to the toolbox container.
- Repository env secrets and file secrets are write-only in UI/API reads and are materialized only into task runtime environments (`apps/server/src/services/repository-store.ts`, `apps/server/src/lib/repository-runtime-env.ts`).
- Hostexec exposes only configured command names through read-only shims under `/hostexec/bin`; both proxy and daemon check workspace containment (`agent-runtime/hostexec-proxy.mjs`, `hostexec/daemon.mjs`).
- MCP runtime tokens are scoped personal access tokens with task/repository context, injected into task runtimes by `SpawnerService` and checked by `/mcp` routes/tools.
- Webhook signature validation relies on raw request body capture in `apps/server/src/index.ts`; changing JSON parsing can break GitHub/Slack verification.

## Known architecture watchpoints

- `SchedulerService` capacity tracking is in-memory (`activeExecutionCount`), so multi-server deployments would need a distributed capacity/lock design.
- Redis queue loss can leave Postgres task execution state and Redis queue entries out of sync; `unstickTaskQueue` exists for targeted recovery but queue-loss behavior deserves tests.
- `Task` data is partly duplicated between indexed Postgres columns and `task_data` JSONB; store updates must keep them aligned.
- `apps/web/components/task-detail-page.tsx` and `apps/server/src/services/spawner.ts` are large, cross-cutting files with high regression risk.
