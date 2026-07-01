# Testing

## Canonical Test Command
- `npm run ci`

This is the recommended verification entry point for agents and local development. It runs dependency install, lint, build, and tests inside a single Node Docker container, removes the container and image when done, and does not start Docker Compose.

## Test Levels
The root test command runs the server and web workspace test scripts:
- Server tests: `npm run test -w @agentswarm/server`
- Web tests: `npm run test -w @agentswarm/web`

## Scope Selection
- All current tests: `npm test`
- Server only: `npm run test -w @agentswarm/server`
- Web only: `npm run test -w @agentswarm/web`
- Legacy scoped harness runner: `TEST_SCOPE=unit|integration|e2e ./scripts/harness/test.sh`

## UI Test Harness (Playwright)
Added files:
- `playwright.config.ts`
- `apps/web/e2e/auth.smoke.spec.ts`

Current UI coverage:
- Smoke test: main route (`/`) redirects signed-out users to login.
- Smoke test: login page loads and core inputs are visible.
- Happy-path test: seeded admin signs in and lands on an app page.

Stable selectors used:
- form labels: `Email`, `Password`
- `data-testid="login-submit-button"`

## UI Test Prerequisites
The legacy `test.sh` runner handles most setup automatically for E2E:
1. Checks app health at `/api/health`.
2. Starts the app stack via `./scripts/harness/start.sh` if needed.
3. Installs Chromium headless shell for Playwright unless skipped.
4. In remote mode on musl-based runners, auto-runs Playwright in a container fallback (`mcr.microsoft.com/playwright:v1.60.0-noble` by default).

Useful environment options:
- `AGENTSWARM_UI_BASE_URL` (default: `http://localhost:3217`)
- `AGENTSWARM_E2E_EMAIL` (default: `admin@agentswarm.local`)
- `AGENTSWARM_E2E_PASSWORD` (default: `admin123!`)
- `PLAYWRIGHT_CAPTURE_VIDEO=1` to keep video on failures
- `PLAYWRIGHT_SKIP_INSTALL=1` to skip browser install step
- `PLAYWRIGHT_DOCKER_IMAGE` to override the Playwright fallback container image in remote mode

## Failure Artifacts
On Playwright failures:
- Screenshots are captured automatically.
- Trace files are kept automatically.
- Videos are kept only when `PLAYWRIGHT_CAPTURE_VIDEO=1`.

Artifact locations:
- `test-results/playwright/`
- `playwright-report/`

## Deterministic Behavior
The legacy harness runner sets stable defaults for repeatable runs:
- `CI=1`
- `NODE_ENV=test`
- `TZ=UTC`
- `LANG=C`, `LC_ALL=C`
- `NO_COLOR=1`, `FORCE_COLOR=0`
- `AGENTSWARM_TEST_SEED`

## Troubleshooting
- If E2E cannot boot app: run `./scripts/harness/start.sh` directly and inspect logs.
- If credentials fail: reset local data and use seeded defaults.
- If Playwright launch fails in remote mode: ensure Docker is available in the remote runner image (fallback uses Docker).
- If Playwright browser missing locally: run `npx playwright install chromium --only-shell`.

See also: `docs/development/debugging.md`.
