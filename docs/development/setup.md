# Development Setup

## Goal
Bring a clean checkout to a running app with one predictable flow.

## Prerequisites
- Docker with Docker Compose.
- Bash shell.
- Optional for Docker-only startup: Node 20+ and npm.
- Required for Dockerized CI: Docker.
- Required for host-local lint/test flows: Node 20+ and npm.
- Required when installing dependencies locally: `python3` (needed by `node-gyp` for native modules such as `node-pty`).

## Remote Build Environment
If your environment sets `REMOTE_BUILD=1`, harness scripts execute in Remote Build Runner.

Before running harness commands in that mode:
- Set `REMOTE_BUILD_IMAGE`.
- Optional: set `REMOTE_BUILD_RUNNER_URL` if not using the default endpoint.
- Ensure the remote image includes: `bash`, `node`, `npm`, `python3`, `docker`, and Docker Compose.

To run commands locally instead, set `REMOTE_BUILD=0`.
If the web host port is already in use, set `PUBLIC_PORT`. The Docker stack publishes only the proxy port; Redis and Postgres remain on the internal Compose network.

## 1) Setup Command (Clean Checkout)
Run from repository root:

```bash
HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
```

What it does:
- Creates `.env` from `.env.example` if missing.
- Ensures the runtime workspace and persistent agent-home folders exist (`task-workspaces`, `task-homes`).
- Runs `./verft init` (builds the unified agent toolbox runtime image and starts required containers).
- Installs npm dependencies (because `HARNESS_INSTALL_NPM_DEPS=1` is set above).

If you only need Docker services and do not plan to run local checks/tests:

```bash
./scripts/harness/setup.sh
```

Optional flags:
- Reset local DB/cache volumes first:

```bash
HARNESS_DB_RESET=1 ./scripts/harness/setup.sh
```

- Also install npm dependencies:

```bash
HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh
```

If you plan to run `npm run ci`, host dependencies are not required. If you plan to run `npm run lint` or `npm test` directly on the host, install dependencies first.

## 2) Environment Template
Use `.env.example` as the template.

If `.env` is missing, setup creates it automatically.

Important values in template:
- `PUBLIC_PORT` (default `3217`)
- `AGENT_RUNTIME_IMAGE` (default `verft-agent-toolbox:latest`)
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`

## 3) Local Database Setup / Reset
Default Docker flow starts Redis and Postgres from `docker-compose.yml`. They are available to other Compose services by service name and are not published to the host. The Docker stack owns the server database connection string; it is not configured per user in `.env`.

Reset data when needed:

```bash
HARNESS_DB_RESET=1 ./scripts/harness/setup.sh
```

This removes local Docker volumes for the stack and recreates services.

## 4) Seed Data
On first boot, the server creates the admin user using:
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`

Defaults are in `.env.example`.

No separate seed command is required for this default admin bootstrap.

## 5) Start Command
Start the app and wait for health:

```bash
./scripts/harness/start.sh
```

## 6) Health Check
`start.sh` automatically waits for:

- `http://localhost:<PUBLIC_PORT>/api/health`

Manual check example:

```bash
curl -fsS http://localhost:3217/api/health
```

## External Credentials
GitHub/OpenAI/Anthropic/Slack credentials are configured in the app Settings UI, not in `.env`.

For Git access from server-side actions and from Codex/Claude task runtimes:
- Set a GitHub personal access token in `Settings -> Credentials -> GitHub Token`.
- Keep `Settings -> Git & Branching -> Git Username` as `x-access-token` for standard GitHub PAT HTTPS auth unless your Git host requires another username.
- Set `Git Author Name` and `Git Author Email` in your profile or in the Users admin page if you want agent-created commits to use something other than the account name/email.

Recommended GitHub token permissions:
- Repository contents read/write for clone, fetch, pull, commit push, and branch deletion on private repositories.
- Pull request read/write if you also use PR-related automation and outbound updates.
- Metadata read so repository access checks succeed consistently.

For Slack app setup, configure the Slack Signing Secret and Bot Token in `Settings -> Slack`, copy the global Slack Event URL from that tab, and configure repository-specific Slack Channel IDs in repository settings. See [Slack setup](slack-setup.md).

## TODO
- TODO: Document a fully verified host-only (non-Docker) local startup path end-to-end.
- TODO: Document any required external service accounts for production-like runs.
