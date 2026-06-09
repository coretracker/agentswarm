<p align="center">
  <img src="apps/web/public/logo.svg" width="120" alt="AgentSwarm logo"/>
</p>

# AgentSwarm

AgentSwarm is a Docker-based web app for running and managing AI coding work on real Git repositories. It provides one place to create tasks, run Codex or Claude agents, inspect logs and diffs, review checkpoints, manage branches, and continue work in an interactive browser terminal.

The project is built for developers and teams who want agent-assisted coding workflows without losing visibility into Git state, task history, or repository changes.

## Features

- Create build or ask tasks from a blank prompt, reusable snippet, GitHub issue, or pull request.
- Run Codex and Claude tasks in isolated Docker runtime containers.
- Track task status, messages, logs, runs, diffs, checkpoints, and Git operations from the web UI.
- Review pending change proposals before applying, rejecting, reverting, pushing, or merging.
- Open task workspaces in an interactive browser terminal.
- Configure repositories, credentials, roles, users, provider defaults, and snippets.
- Automate task creation from GitHub webhooks and repository automation rules.
- Add repository-local postflight checks with `.agentswarm/postflight.yml`.

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
git clone git@github.com:coretracker/agentswarm.git
cd agentswarm
```

Create a local environment file:

```bash
cp .env.example .env
```

Initialize the Docker stack and runtime images:

```bash
./agentswarm.sh init
```

For a clean developer checkout that also installs npm dependencies, use the harness setup command instead:

```bash
HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
```

## Quick Start

Start the app:

```bash
./agentswarm.sh start
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
./agentswarm.sh stop
```

## Usage

### Common Commands

| Command | Description |
| --- | --- |
| `./agentswarm.sh init` | Build runtime images, rebuild compose images, and start the stack. |
| `./agentswarm.sh start` | Start the Docker Compose stack in the background. |
| `./agentswarm.sh rebuild` | Rebuild runtime and compose images, then restart the stack. |
| `./agentswarm.sh stop` | Stop the Docker Compose stack. |
| `./scripts/harness/start.sh` | Start the development stack and wait for health. |

The health endpoint is available at:

```bash
curl -fsS http://localhost:3217/api/health
```

### Creating Tasks

Tasks are the main unit of work in AgentSwarm.

- **Build tasks** ask an agent to make repository changes.
- **Ask tasks** ask an agent to inspect and answer without changing code.
- **Snippet tasks** start from reusable prompt templates and variables.
- **GitHub-imported tasks** can be created from issues, pull requests, review comments, and automation rules.

Task workspaces are isolated under `task-workspaces/` and are runtime data. Do not commit them.

### GitHub Webhooks

AgentSwarm supports repository-scoped GitHub webhooks that can create tasks automatically.

For each repository, configure this webhook URL in GitHub:

```text
https://<your-host>/api/webhooks/github/<repositoryId>
```

Use content type `application/json` and subscribe to the events you want to automate, such as Issues, Pull requests, Pull request review comments, Issue comments, and Reactions.

Example repository automation rule:

```json
[
  {
    "id": "ai-issue-opened",
    "name": "AI issue to build task",
    "enabled": true,
    "trigger": "issue_opened",
    "syncStatusEnabled": true,
    "labelFilter": {
      "labelsAny": ["ai"],
      "labelsNone": ["wip"]
    },
    "task": {
      "assigneeEmail": "dev@example.com",
      "taskType": "build",
      "provider": "codex",
      "providerProfile": "high",
      "modelOverride": "gpt-5.4",
      "codexCredentialSource": "profile"
    }
  }
]
```

Supported automation triggers include:

- `issue_opened`
- `pull_request_opened`
- comment or reaction triggers when rule-level comment automation is enabled

### Postflight Checks

Repositories can define post-build automation in `.agentswarm/postflight.yml`. Postflight runs after a successful build task and before the final checkpoint is created.

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

Most runtime configuration starts in `.env`. Provider API keys and GitHub credentials are configured in the AgentSwarm Settings UI, not in `.env`.

### Core Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PUBLIC_PORT` | Public port exposed by nginx. | `3217` |
| `CORS_ORIGIN` | Allowed web origin for the API. | `http://localhost:3217` |
| `DEFAULT_ADMIN_NAME` | Bootstrap admin display name. | `Administrator` |
| `DEFAULT_ADMIN_EMAIL` | Bootstrap admin email. | `admin@agentswarm.local` |
| `DEFAULT_ADMIN_PASSWORD` | Bootstrap admin password. | see `.env.example` |
| `AUTH_COOKIE_NAME` | Session cookie name. | `agentswarm_session` |
| `AUTH_SESSION_TTL_DAYS` | Session lifetime in days. | `7` |
| `APP_ENVIRONMENT` | Runtime environment label. | `local` |

### Storage

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string. | see `.env.example` |
| `POSTGRES_AUTO_MIGRATE` | Run Postgres migrations on server start. | `true` |
| `REDIS_HOST_PORT` | Host port for Redis in local Docker setups. | `6379` |
| `POSTGRES_HOST_PORT` | Host port for Postgres in local Docker setups. | `5432` |

Durable application data is stored in Postgres. Redis is still required for sessions, queues, webhook jobs, and realtime pub/sub.

### Git and Workspaces

| Variable | Description | Default |
| --- | --- | --- |
| `GIT_USER_NAME` | Git author name used by the server. | `AgentSwarm Bot` |
| `GIT_USER_EMAIL` | Git author email used by the server. | `agentswarm@local.dev` |
| `TASK_WORKSPACE_HOST_ROOT` | Absolute host path for task workspaces. | unset |
| `LOCAL_PLANS_HOST_ROOT` | Absolute host path for local plan storage. | unset |

`TASK_WORKSPACE_HOST_ROOT` is important in Docker setups because the server and runtime containers must mount the same host workspace directory.

### Frontend API Routing

| Variable | Description | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Explicit public API base URL. | empty |
| `NEXT_PUBLIC_SOCKET_URL` | Explicit public Socket.IO URL. | empty |

Leave these empty to use the bundled same-origin `/api` proxy.

### Runtime Images

| Variable | Description | Default |
| --- | --- | --- |
| `CODEX_RUNTIME_IMAGE` | Automated Codex runtime image. | `agentswarm-agent-runtime-codex:latest` |
| `CLAUDE_RUNTIME_IMAGE` | Automated Claude runtime image. | `agentswarm-agent-runtime-claude:latest` |
| `GIT_TERMINAL_IMAGE` | Restricted Git terminal image. | `local/git-terminal:latest` |
| `CODEX_INTERACTIVE_IMAGE` | Interactive Codex terminal image. | `local/codex-interactive:latest` |
| `CLAUDE_INTERACTIVE_IMAGE` | Interactive Claude terminal image. | `local/claude-interactive:latest` |

### Docker Socket Access

Docker socket access is disabled by default and should stay disabled unless a runtime must start nested containers.

| Variable | Description | Default |
| --- | --- | --- |
| `DOCKER_SOCKET_ACCESS_ENABLED` | Mount Docker socket into Codex/Claude runtime containers. | `false` |
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
+-- agent-runtime-codex/ # Automated Codex task runtime
+-- agent-runtime-claude/# Automated Claude task runtime
+-- tools/               # Supporting runtime and terminal tooling
+-- docs/                # Architecture, development, product, and quality docs
+-- scripts/harness/     # Canonical setup, check, test, and PR scripts
+-- task-workspaces/     # Runtime task workspaces; do not commit
+-- docker-compose.yml   # Local Docker stack
+-- agentswarm.sh        # Main stack helper script
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
npm run dev -w @agentswarm/server
npm run dev -w @agentswarm/web
npm run build -w @agentswarm/shared-types
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

After any agent-generated repository edit, refresh the Repomix context bundle:

```bash
npx repomix --style markdown --output docs/repomix.md
```

## FAQ

### Where do I configure API keys?

Configure GitHub, OpenAI, and Anthropic credentials in the AgentSwarm Settings UI. Credentials are write-only from the UI and are not returned by the API.

### Can I run without Docker?

The documented and supported path is Docker-based. Some server and web commands can run locally with Node.js, but the full task execution flow depends on Docker runtime containers.

### What does a `202` response from a GitHub webhook mean?

It means AgentSwarm accepted the webhook payload. Whether tasks were created depends on repository automation rules, label filters, trigger type, and actor restrictions.

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
