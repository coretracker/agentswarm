# Quality Scorecard

This scorecard is based on evidence currently visible in the repository.

Scale:
- `1` = weak / largely missing
- `3` = partial / usable
- `5` = strong / consistently enforced
- `unknown` = not enough direct evidence in this repo

## Domain Scores

| Domain or package | Test coverage | Documentation | Architecture compliance | Reliability | Observability | Security | Agent legibility |
|---|---:|---:|---:|---:|---:|---:|---:|
| `apps/server` | 4 | 3 | 4 | 4 | 4 | 4 | 4 |
| `apps/web` | 3 | 3 | 4 | 3 | 2 | 3 | 4 |
| `packages/shared-types` | 1 | 2 | 4 | 3 | unknown | 3 | 3 |
| Runtime (`agent-runtime*`, `tools/codex-web-terminal`) | 1 | 2 | 3 | 2 | 1 | unknown | 2 |
| Deployment (`docker-compose.yml`, `deploy/`, `agentswarm.sh`) | 2 | 3 | 4 | 4 | 3 | 2 | 4 |
| CI (`.github/workflows`) | 3 | 4 | 3 | 3 | 3 | 3 | 4 |

## Evidence Notes

### `apps/server`
- 22 test files across `lib`, `services`, and `routes`.
- Structured startup/request/error logs with request IDs in `apps/server/src/index.ts`.
- Auth + scope checks in `apps/server/src/lib/auth.ts` and `apps/server/src/routes/*`.

### `apps/web`
- 4 utility tests plus 1 Playwright browser spec in `apps/web/e2e/auth.smoke.spec.ts`.
- Architecture boundary checks are available for web/server cross-import checks.
- Limited client-side observability evidence (mostly server-side logs today).

### `packages/shared-types`
- Single shared contract file (`packages/shared-types/src/index.ts`) and no tests found.
- Boundary rules explicitly protect package isolation.
- Observability is `unknown` because this is a type package, not a runtime service.

### Runtime domain
- Runtime scripts and Dockerfiles are present, but no runtime test files were found.
- Limited runtime-specific docs outside `tools/codex-web-terminal/README.md`.
- Security is `unknown` due to limited direct hardening evidence in repo docs/tests.

### Deployment domain
- Local orchestration is documented and scripted (`docker-compose.yml`, `agentswarm.sh`, harness setup/start/doctor).
- Reliability is improved by health checks and doctor checks.
- Security remains low for production use because current repo evidence is mainly local/dev setup.

### CI
- Strong legibility and workflow guidance in `AGENTS.md` and `docs/development/*`.
- Boundary checks remain available through `scripts/harness/boundary-check.mjs`, but are not part of the current default gate.
- CI currently runs `./scripts/ci.sh` in `.github/workflows/lint-and-tests.yml`.

## Summary of Top Gaps
1. Shared contracts have no direct tests.
2. Runtime domain has minimal test/observability/security evidence.
3. Web test depth is still light for core user journeys.
4. CI does not currently run architecture boundary checks.
