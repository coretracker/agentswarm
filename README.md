<p align="center">
  <img src="apps/web/public/logo.svg" width="120" alt="Verft logo"/>
</p>

# Verft

Verft is a Docker-based web app for running and managing AI coding work on real Git repositories. It provides one place to create tasks, run Codex or Claude agents, inspect logs and diffs, review checkpoints, manage branches, and continue work in an interactive browser terminal.

The project is built for developers and teams who want agent-assisted coding workflows without losing visibility into Git state, task history, or repository changes.

## Features

- Create build or ask tasks from a blank prompt or reusable snippet.
- Run Codex and Claude tasks in isolated Docker runtime containers.
- Track task status, messages, logs, runs, diffs, checkpoints, and Git operations from the web UI.
- Review pending change proposals before applying, rejecting, reverting, pushing, or merging.
- Open task workspaces in an interactive browser terminal.
- Configure repositories, credentials, roles, users, provider defaults, and snippets.
- Add repository-local postflight checks with `.verft/postflight.yml`.
- Optionally expose selected manually started host commands through hostexec bridge shims.

## Requirements

| Requirement | Notes |
| --- | --- |
| Docker | Required for the main app stack and agent runtime containers. |
| Docker Compose | `docker compose` is preferred; `docker-compose` is also supported. |
| Bash | Required by the helper and harness scripts. |
| Node.js 20+ and npm | Required for local development, checks, tests, and builds. |
| Python 3 | Required when installing local npm dependencies because native modules such as `node-pty` may build from source. |

## Installation

Clone the repository:

```bash
git clone git@github.com:coretracker/verft.git
cd verft
```

Create a local environment file:

```bash
cp .env.example .env
```

Initialize the Docker stack and agent runtime image:

```bash
./verft.sh init
```

For a clean developer checkout that also installs npm dependencies, use the harness setup command instead:

```bash
HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
```

## Quick Start

Start the app:

```bash
./verft.sh start
```

Open the UI:

```text
http://localhost:3217/login
```

Bootstrap credentials come from `.env.example` and are used only when the first admin user is created. Review and change them before exposing the app outside a local development environment.

After signing in:

1. Open **Settings** and add provider credentials for OpenAI/Codex and/or Anthropic/Claude.
2. Open **Repositories** and add a Git repository.
3. Open **Tasks** and create a build or ask task.
4. Review task output, logs, diffs, and checkpoints from the task detail page.

Stop the app:

```bash
./verft.sh stop
```

## Usage

### Common Commands

| Command | Description |
| --- | --- |
| `./verft.sh init` | Build the agent toolbox runtime image, rebuild compose images, and start the stack. |
| `./verft.sh start` | Start the Docker Compose stack in the background. |
| `./verft.sh rebuild` | Rebuild the agent toolbox runtime and compose images, then restart the stack. |
| `./verft.sh stop` | Stop the Docker Compose stack. |
| `./scripts/harness/start.sh` | Start the development stack and wait for health. |

The health endpoint is available at:

```bash
curl -fsS http://localhost:3217/api/health
```

### Creating Tasks

Tasks are the main unit of work in Verft.

- **Build tasks** ask an agent to make repository changes.
- **Ask tasks** ask an agent to inspect and answer without changing code.
- **Snippet tasks** start from reusable prompt templates and variables.

Task definitions include title, repository, prompt, deadline, provider/model settings, branch settings, and optional prompt attachments. Task-specific notes are not part of the task model.

Task workspaces are isolated under `task-workspaces/` and are runtime data. Do not commit them.

### Postflight Checks

Repositories can define post-build automation in `.verft/postflight.yml`. Postflight runs after a successful build task and before the final checkpoint is created.

### Hostexec Bridge Commands

Hostexec lets a manually started host daemon expose selected host commands, such as macOS `xcodebuild`, to agent containers through bridge shims.

1. Start the daemon on the host with `npm run hostexec`.
2. Open a repository and add simple command names to **Host Commands**, for example `xcodebuild`, `xcrun`, or `gradlew`.

Verft autodetects the daemon at the default host URLs. Repository **Host Commands** decide which command shims Verft mounts for each repository. The daemon reads `HOSTEXEC_HOST`, `HOSTEXEC_PORT`, and `HOSTEXEC_TOKEN` from `.env`.

See `hostexec/README.md` for the host daemon details.

At runtime Verft creates a read-only shim directory, mounts it at `/hostexec/bin`, and prepends that directory to `PATH`. Existing container bin directories are not overwritten; configured command names only shadow matching commands through `PATH` order.

Bridge commands execute on the host with the task workspace as `cwd`. Nested workspace directories preserve their relative `cwd`, and execution is rejected if the resolved host directory escapes the task workspace. v1 requires the task workspace path to be visible to the host daemon.

Example:

```yaml
version: 1
enabled: true

when:
  task_types: ["build"]
  providers: ["codex", "claude"]

runner:
  image: "mcr.microsoft.com/playwright:v1.52.0-jammy"
  timeout_seconds: 1800

steps:
  - run: "npm ci"
  - run: "npx playwright test tests/mobile-screenshots.spec.ts --project=mobile-web --update-snapshots"

on_failure: "fail_task"
```

## Configuration

Most runtime configuration starts in `.env`. Provider API keys and GitHub credentials are configured in the Verft Settings UI, not in `.env`.

### Core Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PUBLIC_PORT` | Public port exposed by nginx. | `3217` |
| `CORS_ORIGIN` | Allowed web origin for the API. | `http://localhost:3217` |
| `DEFAULT_ADMIN_NAME` | Bootstrap admin display name. | `Administrator` |
| `DEFAULT_ADMIN_EMAIL` | Bootstrap admin email. | `admin@verft.local` |
| `DEFAULT_ADMIN_PASSWORD` | Bootstrap admin password. | see `.env.example` |
| `AUTH_COOKIE_NAME` | Session cookie name. | `verft_session` |
| `AUTH_SESSION_TTL_DAYS` | Session lifetime in days. | `7` |

### Storage

Durable application data is stored in Postgres. Redis is still required for sessions, queues, webhook jobs, and realtime pub/sub. In the Docker stack, Verft owns the server database connection string, and only the nginx proxy publishes a host port; Redis, Postgres, server, and web stay on the internal Compose network.

### Runtime Images

| Variable | Description | Default |
| --- | --- | --- |
| `AGENT_RUNTIME_IMAGE` | Unified toolbox image for automated Codex/Claude runs, interactive terminals, utility runs, and Git worker containers. | `verft-agent-toolbox:latest` |

The toolbox image includes Codex CLI, Claude Code, Git, GitHub CLI (`gh`), Docker CLI, Python, Node/npm, shell tools, and common build dependencies. Runtime image contents and mounted capabilities are part of the operator security boundary. GitHub CLI authentication is supplied at runtime from configured GitHub credentials; credentials are not baked into the image.

### Docker Socket Access

Docker socket access is enabled by default in the local Docker Compose setup so toolbox containers can run Docker-backed checks and nested containers. Set `DOCKER_SOCKET_ACCESS_ENABLED=false` to opt out.

| Variable | Description | Default |
| --- | --- | --- |
| `DOCKER_SOCKET_ACCESS_ENABLED` | Mount Docker socket into toolbox runtime containers. | `true` |
| `DOCKER_SOCKET_HOST_PATH` | Host Docker socket path. | `/var/run/docker.sock` |
| `DOCKER_SOCKET_CONTAINER_PATH_CODEX` | In-container socket path for Codex runtimes. | `/var/run/docker.sock` |
| `DOCKER_SOCKET_CONTAINER_PATH_CLAUDE` | In-container socket path for Claude runtimes. | `/var/run/docker.sock` |

Mounting `docker.sock` is highly privileged and can effectively grant host-level control from inside the runtime container.

## Project Structure

```text
.
+-- apps/
|   +-- server/          # Backend API, orchestration, stores, routes, schedulers
|   +-- web/             # Next.js web app
+-- packages/
|   +-- shared-types/    # Shared TypeScript types used by server and web
+-- agent-runtime/       # Unified agent toolbox runtime
+-- tools/               # Supporting runtime and terminal tooling
+-- docs/                # Architecture, development, product, and quality docs
+-- scripts/harness/     # Canonical setup, check, test, and PR scripts
+-- task-workspaces/     # Runtime task workspaces; do not commit
+-- docker-compose.yml   # Local Docker stack
+-- verft.sh        # Main stack helper script
```

## Development

Install dependencies on a clean checkout:

```bash
HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
```

Useful development commands:

| Command | Description |
| --- | --- |
| `./scripts/harness/doctor.sh` | Verify required tooling and harness availability. |
| `./scripts/harness/setup.sh` | Initialize the Docker stack and runtime folders. |
| `./scripts/harness/check.sh` | Run docs checks, boundary checks, lint, and build. |
| `./scripts/harness/test.sh` | Run the canonical test suite. |
| `./scripts/harness/pr-ready.sh` | Run pull request readiness checks. |
| `npm run dev` | Run server and web dev processes together. |
| `npm run lint` | Run TypeScript no-emit checks for server and web. |
| `npm run build` | Build shared types, server, and web. |
| `npm run test` | Run `./scripts/harness/test.sh`. |

Workspace-specific commands:

```bash
npm run dev -w @verft/server
npm run dev -w @verft/web
npm run build -w @verft/shared-types
```

Before opening a pull request, run:

```bash
./scripts/harness/pr-ready.sh
```

The repository uses execution-plan and human-gated-flow checks for non-trivial changes. Useful references:

- `docs/development/setup.md`
- `docs/development/commands.md`
- `docs/development/testing.md`
- `docs/development/pr-workflow.md`
- `docs/development/agent-review.md`

## MCP Server

Verft exposes a Phase 1 MCP-compatible HTTP JSON-RPC endpoint at `/mcp`.

Authentication uses user personal access tokens:

1. Create a token with `POST /auth/personal-access-tokens` while signed in.
2. Store the returned `token` securely; it is only returned once.
3. Call `/mcp` with `Authorization: Bearer <token>`.
4. Revoke tokens with `DELETE /auth/personal-access-tokens/:id`.

Supported MCP methods:

- `initialize`
- `tools/list`
- `tools/call`

Phase 1 tools:

- `verft_list_repositories`
- `verft_list_tasks`
- `verft_get_task`
- `verft_create_task`
- `verft_update_draft`
- `verft_start_task`
- `verft_add_task_message`
- `verft_link_pull_request`
- `verft_update_task_config`

Task agents receive the Verft MCP server automatically at runtime through an internal stdio bridge and a short-lived run token.

Repository-specific MCP servers are configured on each repository. Task runs and interactive terminals receive only the MCP servers configured for the task repository, plus the internal Verft MCP bridge. Legacy global MCP server settings are no longer used; recreate any previously global MCP server on each repository that should expose it.

Checkpoint mutation, push/merge, attachments, terminal control, and summarization are intentionally deferred to later phases.

## FAQ

### Where do I configure API keys?

Configure GitHub, OpenAI, and Anthropic credentials in the Verft Settings UI. Credentials are write-only from the UI and are not returned by the API.

### Can I run without Docker?

The documented and supported path is Docker-based. Some server and web commands can run locally with Node.js, but the full task execution flow depends on Docker runtime containers.

### How do I reset local data?

Run setup with a database reset:

```bash
HARNESS_DB_RESET=1 ./scripts/harness/setup.sh
```

## Contributing

1. Read the relevant docs in `docs/index.md`.
2. Keep changes scoped and update docs when behavior changes.
3. Run the canonical checks before opening a pull request:

   ```bash
   ./scripts/harness/pr-ready.sh
   ```

4. Use the pull request template in `.github/pull_request_template.md`.

## License

No license file is currently present in this repository. Treat the code as private/proprietary unless a license is added by the project owner.
