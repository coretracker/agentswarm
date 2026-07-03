# Debugging

## Quick Triage
1. Run `./scripts/harness/doctor.sh`.
2. Run `./scripts/harness/setup.sh`.
3. Run `./scripts/harness/start.sh`.
4. Check health: `curl -fsS http://localhost:3217/api/health`.
5. Tail logs: `./scripts/harness/logs.sh server`.

## Log Commands
- All services, follow: `./scripts/harness/logs.sh`
- Server only, follow: `./scripts/harness/logs.sh server`
- Snapshot only (no follow): `FOLLOW=0 ./scripts/harness/logs.sh server`
- More history: `TAIL_LINES=500 ./scripts/harness/logs.sh server`

## What To Look For In Logs
Server logs are structured JSON. Useful fields:
- `time`, `level`, `msg`
- `service` (should be `verft-server`)
- `requestId` (correlates request start/end/error)
- `operationId` (when `x-operation-id` header is sent)
- `method`, `url`, `statusCode`, `durationMs`

Important lifecycle messages:
- `Server configuration loaded`
- `Running Postgres migrations` / `Postgres migrations completed`
- `Server started`
- `request.started`, `request.completed`, `request.failed`
- `Unhandled exception`, `Unhandled promise rejection`
- `startup.bootstrap_failed`

## Request / Operation IDs
- Send `x-request-id` to provide your own request ID.
- Send `x-operation-id` for higher-level flow tracing.
- The server echoes `x-request-id` in responses.

## Common Failure Modes

### Docker is not running
Symptoms:
- doctor/setup/logs fails with Docker daemon errors.
- `start.sh` fails with `docker is required but not installed`.

Fix:
- Start Docker Desktop or Docker service.
- Re-run `./scripts/harness/doctor.sh`.
- For Remote Build Runner, ensure Docker is mounted into the runner container using `dockerSocketContainerPath=/var/run/docker.sock` and that the Docker CLI is available.

### Port already in use
Symptoms:
- `start.sh` never reaches healthy state.
- Browser cannot open `http://localhost:3217/login`.
- Setup/start fails with a bind error for the web port.

Fix:
- Change `PUBLIC_PORT` in `.env`.
- Re-run `./scripts/harness/start.sh`.

### Environment file missing or incomplete
Symptoms:
- setup fails creating `.env`.
- app boots with wrong defaults.

Fix:
- Ensure `.env.example` exists.
- Recreate `.env` from `.env.example`.

### Dependency install fails (`npm ci`)
Symptoms:
- `npm ci` fails with `node-gyp` / `Could not find any Python installation to use`.

Fix:
- Install `python3` and retry `npm ci`.
- Then rerun harness checks/tests.

### Local data is stale or inconsistent
Symptoms:
- old users/settings/tasks remain.
- unexpected state after branch switches.

Fix:

```bash
HARNESS_DB_RESET=1 ./scripts/harness/setup.sh
```

### Containers started but health is failing
Symptoms:
- `start.sh` times out waiting on `/api/health`.

Fix:

```bash
./scripts/harness/logs.sh server
./scripts/harness/logs.sh proxy
```

- Confirm required services exist and are up: `server`, `web`, `proxy`, `redis`, `postgres`.

### Login fails with expected default admin
Symptoms:
- Cannot sign in with values from `.env.example`.

Fix:
- Default admin is created only on first boot.
- If local data already exists, reset and bootstrap again:

```bash
HARNESS_DB_RESET=1 ./scripts/harness/setup.sh
```

## Health and Service Checks
- App login URL: `http://localhost:<PUBLIC_PORT>/login`
- API health URL: `http://localhost:<PUBLIC_PORT>/api/health`

Useful commands:

```bash
./scripts/harness/doctor.sh
./scripts/harness/setup.sh
./scripts/harness/start.sh
./scripts/harness/logs.sh server
docker compose ps
```

## External Services and Secrets
- Provider credentials (GitHub/OpenAI/Anthropic) are set in the app Settings UI.
- GitHub token and Git username in Settings are used for authenticated GitHub HTTPS operations from both server-side Git actions and Codex/Claude task runtimes.
- Git author identity comes from the task owner's `Git Author Name` / `Git Author Email`, falling back to the user's profile name/email.
- If agents can edit locally but remote Git commands fail, verify the GitHub token first.
- `could not read Username` usually means the GitHub token is missing, the runtime did not receive `GIT_TOKEN`, or the remote requires a different auth mode than HTTPS PAT.
- `Authentication failed` usually means the token exists but lacks repository permissions or no longer grants access to that repository.
- `Author identity unknown` means the runtime did not receive a usable Git author name/email; check the task owner's profile or user admin record.
- TODO: Document any additional external dependencies required for production-like flows.
