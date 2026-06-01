# Execution Plan

## Title
- Repository Environment Secrets (Write-Only)

## Goal
- Add repository environment secrets that can be created, updated, deleted, and listed without ever exposing secret values through API/UI responses.

## Non-goals
- Adding a new repository environment model (for example dev/staging/prod objects).
- Encrypting stored repository secrets at rest (not currently implemented for repository env vars either).
- Changing existing webhook secret behavior.

## Current State
- Repositories support `envVars` with plaintext values in API responses and UI.
- Task runtimes inject repository env vars into containers.
- No repository environment secret model exists yet.

## Acceptance Criteria
- Repository APIs support managing `envSecrets` alongside `envVars`.
- Secret values are accepted on create/update but never returned by list/get API responses.
- UI provides a familiar env management flow with masked existing state and clear “set” indication.
- Editing supports keeping existing secrets, replacing them, and deleting them.
- Runtime injection includes repository environment secrets for task and interactive terminal execution.
- Authorization continues to be enforced server-side by existing repository scopes and access checks.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/server/src/services/repository-store.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/db/backfill-redis-to-postgres.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/server/src/lib/task-interactive-terminal-git-env.ts`
- `apps/server/src/lib/task-interactive-terminal.test.ts`
- `apps/web/components/repository-editor-page.tsx`
- `apps/web/components/repositories-page.tsx`

## Step-by-Step Plan
1. Extend shared repository types for environment secret input/output with write-only semantics.
2. Add backend schema validation, store normalization, persistence, and response redaction for repository env secrets.
3. Add runtime retrieval/injection path so task and interactive runs receive secret values.
4. Update repository UI to manage secrets with masked existing states and explicit configured indicators.
5. Add/adjust tests and run targeted validations.
6. Final self-review, then move this plan to `completed/`.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES (environment scope model not present; implemented aligned with current repository-level env-var model)
- Human Review Completed: TODO (awaiting maintainer review)
- User Approval To Start: YES (issue request)
- Baseline Checks Run: PARTIAL (`doctor.sh` blocked in this environment: Docker Compose missing)
- Visible Task List Updated: YES (this execution plan)
- Task-Level Tests/Lint/Build: YES (`check.sh` passed; `npm run test -w @agentswarm/server` and `npm run test -w @agentswarm/web` passed)
- Self Review Complete: YES
- Code Review Complete: TODO (awaiting maintainer review)
- Final Verification Complete: PARTIAL (`harness/test.sh` reached e2e boot and failed due missing Docker Compose)
- Security/Privacy Review Complete: YES (API responses redact secret values; runtime-only secret access path)
- Docs/Changelog Updated: YES (execution plan and product terminology/flow notes updated)

## Validation Commands
- `npm run lint -w @agentswarm/shared-types`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `npm run test -w @agentswarm/server`
- `npm run test -w @agentswarm/web`

## Risks
- Secret value handling regressions in update semantics (keep vs replace vs delete).
- Accidental exposure through API response mapping or UI default values.
- Runtime secret injection missed in one execution path.

## Rollback Plan
- Revert schema/type changes and migrations for env secrets.
- Revert store/runtime/UI changes.
- Confirm repository API/UI behavior returns to env-var-only flow.

## Progress Log
- 2026-06-01 07:39 UTC: Created execution plan after repository/env-var architecture review.
- 2026-06-01 08:17 UTC: Implemented shared types, repository route/store support, runtime secret injection, UI masked secret management, and migration/backfill updates.
- 2026-06-01 08:28 UTC: Validation complete for lint/build and unit/integration tests; harness e2e blocked by missing Docker Compose in this environment.

## Decisions
- 2026-06-01: Keep scope aligned to current repository-level env model; no new environment object added.

## Completion Notes
- Added repository `envSecrets` end-to-end with write-only semantics.
- `GET /repositories` and `GET /repositories/:id` now return secret key + configured state only (no values).
- Repository create/update supports secret add/replace/keep/delete patterns using value-optional updates.
- Task runtime and interactive terminal now inject repository env vars plus env secrets.
- UI includes an Environment Secrets section with masked placeholders and “Secret set” indicators.
- Postgres migration/backfill now supports `env_secrets`.
