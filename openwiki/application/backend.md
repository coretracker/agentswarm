# Backend Guide

The backend is a Fastify TypeScript service in `apps/server`. It owns authentication, RBAC, repository/settings/task APIs, Postgres stores, Redis runtime coordination, Docker-based provider execution, webhooks, interactive terminal upgrades, and the Verft MCP server.

## Entrypoint and bootstrap

`apps/server/src/index.ts` is the main entrypoint. It:

- configures Fastify logging with request IDs and optional operation IDs;
- registers cookies and CORS;
- installs a custom JSON parser that preserves `request.rawBody` for webhook signature verification;
- creates Redis clients, `EventBus`, and a Postgres pool;
- auto-runs Postgres migrations (`AUTO_RUN_POSTGRES_MIGRATIONS = true` in `apps/server/src/config/env.ts`);
- creates Postgres-backed stores with Redis support via `createPostgresStores`;
- ensures default admin role/user;
- registers auth, users, roles, tasks, snippets, repositories, GitHub PR webhooks, Slack webhooks, settings, and MCP routes;
- attaches task/settings terminal WebSocket upgrades;
- starts the scheduler and webhook delivery service.

Health is exposed at `/health` inside the server; nginx proxies `/api/health` in the deployed stack.

## Configuration

`apps/server/src/config/env.ts` validates environment with Zod. Important defaults:

- `PORT=4000`, `REDIS_URL`, `DATABASE_URL`, `EVENT_CHANNEL`;
- repository cache/runtime payload/task workspace roots and Docker volume names;
- `AGENT_RUNTIME_IMAGE` defaulting to `verft-agent-toolbox:latest`;
- bootstrap admin values and session settings;
- Sentry enablement/DSN;
- Docker socket access settings.

`.env.example` lists local-development names and calls out Docker socket access as high-risk. Provider API keys and GitHub credentials are configured in the Settings UI, not in `.env` (`README.md`).

## Persistence and stores

Postgres migrations in `apps/server/src/db/migrations.ts` define the durable schema. Store implementations live in `apps/server/src/services/*-store.ts`:

- `task-store.ts`: task data, messages, runs, logs, proposals, Git operations, terminal sessions/transcripts, event publication, history pagination, lifecycle normalization.
- `repository-store.ts`: repositories, environment variables/secrets/file secrets, MCP servers, host commands, GitHub/Slack integration fields, harness fields, default provider settings.
- `settings-store.ts`: singleton system settings plus credential configured status.
- `credential-store.ts`: encrypted provider/GitHub/Slack credential payload.
- `task-queue-store.ts`: Redis-backed queue list (`verft:queue`) and replace/remove operations.
- `user-store.ts`, `role-store.ts`, `session-store.ts`, `personal-access-token-store.ts`: auth and RBAC.
- `webhook-delivery-store.ts` and service: webhook delivery jobs.

The code still contains some legacy Redis key constants in `task-store.ts`, but current durable storage is Postgres with Redis used for queue/session/pub-sub runtime services.

## Routes and API surface

Route modules validate input with Zod and call services/stores:

- `routes/auth.ts`: login/session/profile/logout/PATs.
- `routes/users.ts`, `routes/roles.ts`: admin/user/RBAC management.
- `routes/repositories.ts`: repository CRUD and repository-scoped runtime capabilities.
- `routes/settings.ts`: system settings, credentials, models, hostexec check, notes.
- `routes/snippets.ts`: reusable prompt snippets.
- `routes/tasks.ts`: the largest API surface: task CRUD/start/cancel/archive/delete, messages/runs/change proposals, task config/state/assignee/deadline, Git actions, workspace files, diff assist, prompt magic, terminal status/transcript/kill.
- `routes/github-pr-webhooks.ts`, `routes/slack-webhooks.ts`: external automation entrypoints.

Capability checks are implemented through auth helpers and task/repository ownership helpers (`apps/server/src/lib/task-capability-access.ts`, `task-ownership.ts`). Client-side hiding in the web app is not sufficient; backend route enforcement is the security boundary.

## Scheduler

`apps/server/src/services/scheduler.ts` decides whether and when a task action runs. Key rules:

- reject missing, archived, draft, queued, preparing, or running tasks;
- reject tasks with pending change proposals;
- reject tasks with active interactive terminal sessions;
- mark queued state in Postgres and replace the Redis queue entry;
- drain while below `settings.maxAgents`;
- recover interrupted active executions on bootstrap;
- cancel queued/running tasks and ask the spawner to stop active work;
- trigger postflight and follow-up action messages.

Watchpoint: `activeExecutionCount` is process-local. Multi-instance deployment would require distributed capacity coordination.

## Spawner and execution orchestration

`apps/server/src/services/spawner.ts` is the backend’s execution engine. It coordinates:

- repository cache/workspace clone and branch preparation;
- Git identity, locks, branch names, pull/push/merge/reset/revert helpers;
- runtime manifests and payload directories;
- provider env/config for Codex and Claude;
- repository env vars/secrets and env files;
- prompt attachments and harness guidance;
- Docker socket policy and nested container notices;
- linked workspace mounts;
- hostexec runtime config;
- internal Verft MCP endpoint/token injection;
- provider event parsing and task run/log/result persistence;
- checkpoint/change proposal creation and application paths;
- interactive terminal runtime behavior.

The actual provider process runs in Docker (`spawn("docker", args, ...)`) using `agent-runtime/run-task-codex.mjs` or `agent-runtime/run-task-claude.mjs` inside the toolbox image.

## MCP server

`apps/server/src/mcp/server.ts` exposes JSON-RPC MCP at `/mcp` with bearer-token auth. `apps/server/src/mcp/tools.ts` defines tools with required scopes and Zod validation:

- `verft_list_repositories`
- `verft_list_tasks`
- `verft_get_task`
- `verft_create_task`
- `verft_create_subtask`
- `verft_update_draft`
- `verft_start_task`
- `verft_add_task_message`
- `verft_link_pull_request`
- `verft_link_issue`
- `verft_reply_slack_thread`
- `verft_update_task_config`

Task runtimes receive a scoped PAT and runtime context so agents can create subtasks, add messages, start work, or reply to Slack threads without broad user credentials.

## Backend tests

`apps/server/package.json` enumerates Node test files. Coverage includes provider/postflight config, task status/mutation guards, Git helpers, Docker/hostexec/workspace mounts, linked workspaces, managed Git hooks, task identity/provider state/start orchestration/interactive terminal, MCP config/server/tools, GitHub and Slack webhooks, repo sync, scheduler, stores, webhook delivery, and spawner workspace provisioning.

Default commands:

```bash
npm run test -w @verft/server
npm run lint -w @verft/server
npm run build -w @verft/server
```

Prefer root `npm run ci` before PRs.

## Change watchpoints

- Preserve raw body parsing if touching Fastify content parsing or webhook routes.
- Keep shared types, route schemas, store normalization, and frontend API calls in sync.
- Do not return secret values after they are stored; return configured flags/placeholders only.
- Add tests when changing scheduler state transitions, Git operations, MCP scopes, webhook filters/templates, repository secret materialization, and spawner Docker mount behavior.
- Avoid growing `routes/tasks.ts` and `services/spawner.ts` further without extracting focused helpers; both are high-complexity files.
