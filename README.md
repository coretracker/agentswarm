<p align="center">
  <img src="apps/web/public/logo.svg" width="120" alt="AgentSwarm logo"/>
</p>

<h1 align="center">AgentSwarm</h1>

AgentSwarm is a local-first UI for running coding agents against real Git repositories.

Based on the codebase today, it does four main things:

- lets you connect repositories and create tasks from scratch, from GitHub issues, or from pull requests
- runs automated Codex or Claude tasks inside Docker containers
- prepares per-task workspaces you can later open in an interactive browser terminal
- keeps task history, logs, diffs, checkpoints, and Git actions in one place

The web app is Next.js, the API is Fastify, task state is stored in Redis and/or Postgres depending on configuration, and agent workspaces live on disk under the task workspace root.

## Prerequisites

Docker and Docker Compose.

Node 20+ is optional if you want to run the web/server in host dev mode.

## Start

```bash
./agentswarm.sh start
./agentswarm.sh rebuild
./agentswarm.sh stop
```

What they do:

- `start`: starts the Docker Compose stack in the background
- `rebuild`: rebuilds the compose images, automated runtime images, and interactive terminal images, then restarts the stack
- `stop`: stops the stack

By default the app is available at `http://localhost:3217/login`.

The seeded admin defaults come from `.env.example`:

- email: `admin@agentswarm.local`
- password: `admin123!`

Those values are only used when the admin user is created for the first time.

## Environment Variables

Copy `.env.example` to `.env` and adjust it if needed.

### Core

| Variable | Purpose | Default |
|---|---|---|
| `PUBLIC_PORT` | Public port exposed by the nginx proxy | `3217` |
| `CORS_ORIGIN` | Allowed web origin for the API | `http://localhost:3217` |
| `DEFAULT_ADMIN_NAME` | Bootstrap admin display name | `Administrator` |
| `DEFAULT_ADMIN_EMAIL` | Bootstrap admin email | `admin@agentswarm.local` |
| `DEFAULT_ADMIN_PASSWORD` | Bootstrap admin password | `admin123!` |
| `AUTH_COOKIE_NAME` | Session cookie name | `agentswarm_session` |
| `AUTH_SESSION_TTL_DAYS` | Session lifetime in days | `7` |

### Storage

| Variable | Purpose | Default |
|---|---|---|
| `STORE_BACKEND` | Default durable store backend | `redis` |
| `DATABASE_URL` | Postgres connection string | `postgres://postgres:postgres@localhost:5432/agentswarm` |
| `POSTGRES_AUTO_MIGRATE` | Run Postgres migrations on server start | `true` |
| `TASK_STORE_BACKEND` | Override backend for task data only | inherit |
| `SNIPPET_STORE_BACKEND` | Override backend for snippets | inherit |
| `REPOSITORY_STORE_BACKEND` | Override backend for repositories | inherit |
| `CREDENTIAL_STORE_BACKEND` | Override backend for encrypted credentials | inherit |
| `ROLE_STORE_BACKEND` | Override backend for roles | inherit |
| `USER_STORE_BACKEND` | Override backend for users | inherit |
| `SETTINGS_STORE_BACKEND` | Override backend for settings | inherit |

### Git / Workspace

| Variable | Purpose | Default |
|---|---|---|
| `GIT_USER_NAME` | Git author name used by the server | `AgentSwarm Bot` |
| `GIT_USER_EMAIL` | Git author email used by the server | `agentswarm@local.dev` |
| `TASK_WORKSPACE_HOST_ROOT` | Absolute host path where task workspaces live | unset in `.env.example` |

`TASK_WORKSPACE_HOST_ROOT` matters in Docker setups because the server and runtime containers need to mount the same host workspace directory.

### Frontend API routing

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Explicit public API base URL | empty |
| `NEXT_PUBLIC_SOCKET_URL` | Explicit public Socket.IO URL | empty |

Leave both empty if you want to use the bundled same-origin `/api` proxy.

### Interactive terminal images

| Variable | Purpose | Default |
|---|---|---|
| `GIT_TERMINAL_IMAGE` | Image for the restricted Git terminal | `local/git-terminal:latest` |
| `CODEX_INTERACTIVE_IMAGE` | Image for the interactive Codex terminal | `local/codex-interactive:latest` |
| `CLAUDE_INTERACTIVE_IMAGE` | Image for the interactive Claude terminal | `local/claude-interactive:latest` |

These images are used only for in-browser terminal sessions. Automated agent runs use the runtime images built by `./agentswarm.sh rebuild`.

## Notes

- API credentials such as GitHub, OpenAI, and Anthropic are configured in the AgentSwarm Settings UI, not in `.env`.
- Task workspaces and local plans are runtime data and should not be committed.
- If you are using Postgres, run the server with a valid `DATABASE_URL` and either keep `POSTGRES_AUTO_MIGRATE=true` or run migrations manually.
