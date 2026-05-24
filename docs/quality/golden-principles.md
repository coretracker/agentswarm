# Golden Principles For Agents

These rules are based on recurring patterns already used in this repository.

## 1) Preserve architectural layering
- Rule: Keep web, server, and shared-types separated by the documented boundaries.
- Rationale: Cross-layer imports create fragile coupling and break deploy/runtime assumptions.
- Good behavior: In `apps/web`, call server APIs or use `@agentswarm/shared-types` instead of importing from `apps/server`.
- Bad behavior: Importing `apps/server/*` directly into `apps/web/*`.
- Mechanically enforced: Yes (`scripts/harness/boundary-check.mjs`, run by `scripts/harness/check.sh` and CI).

## 2) Prefer existing shared contracts and utilities
- Rule: Reuse `@agentswarm/shared-types` and existing helper modules before creating new ad-hoc copies.
- Rationale: Shared contracts keep server and web behavior aligned and reduce drift.
- Good behavior: Import `Task`, enums, and shared limits from `@agentswarm/shared-types` in routes/components.
- Bad behavior: Duplicating task status enums or payload shapes in individual files.
- Mechanically enforced: Partly (shared-types import boundaries are enforced; utility reuse choice is not).

## 3) Validate data at boundaries
- Rule: Validate incoming request data and external payloads at entry points.
- Rationale: Boundary validation prevents unsafe state and unclear runtime failures.
- Good behavior: Route schemas using `zod` + `safeParse` (for example in `apps/server/src/routes/tasks.ts`, `repositories.ts`, `settings.ts`).
- Bad behavior: Reading `request.body` fields directly without validation.
- Mechanically enforced: No direct global rule; enforced by convention and code review.

## 4) Avoid guessed external API shapes
- Rule: Do not assume external providers always return expected fields.
- Rationale: External responses change; defensive handling prevents outages.
- Good behavior: Handle API failures with fallback behavior (for example model fallback in `apps/server/src/routes/settings.ts`).
- Bad behavior: Relying on one unvalidated response shape and crashing when fields differ.
- Mechanically enforced: No.

## 5) Use canonical harness commands
- Rule: Use `scripts/harness/*` as the default workflow for setup, checks, tests, startup, and logs.
- Rationale: Harness commands standardize behavior across local runs and agents.
- Good behavior: Run `./scripts/harness/doctor.sh`, `check.sh`, `test.sh`, and `pr-ready.sh` before PR.
- Bad behavior: Running ad-hoc subsets only and skipping required checks.
- Mechanically enforced: Partly (`pr-ready.sh` and CI enforce subsets; full usage is policy-driven).

## 6) Add tests for bug fixes and behavior changes
- Rule: Every bug fix or meaningful behavior change should include or update tests.
- Rationale: Regression protection is especially important for agent-driven edits.
- Good behavior: Add/update unit/integration tests in `apps/server/src/**` or `apps/web/src/**`, and E2E when user flow is affected.
- Bad behavior: Fixing logic without any test coverage update.
- Mechanically enforced: No (recommended policy; not currently mandatory per change).

## 7) Update docs when behavior changes
- Rule: Keep development, debugging, and quality docs aligned with runtime behavior.
- Rationale: Agent effectiveness depends on accurate operational docs.
- Good behavior: Update `docs/development/*`, `AGENTS.md`, and quality docs when scripts or workflows change.
- Bad behavior: Changing commands or flows without updating docs.
- Mechanically enforced: No (policy + PR template expectation).

## 8) Keep files within agreed size limits
- Rule: Avoid growing files beyond agreed limits; split when they become hard to reason about.
- Rationale: Smaller modules improve maintainability and reduce agent error rates.
- Good behavior: Extract focused helpers when a route/component becomes too large.
- Bad behavior: Continuously appending logic to already very large files.
- Mechanically enforced: No.
- Current agreed limit: TODO (not yet defined in repository policy).

## 9) Keep runtime behavior observable
- Rule: Ensure startup, request flow, and failures remain visible in logs.
- Rationale: Local debugging depends on clear, correlated logs.
- Good behavior: Use structured server logs with `requestId` and optional `operationId`, and inspect via `./scripts/harness/logs.sh`.
- Bad behavior: Silent failures or unstructured prints that cannot be correlated.
- Mechanically enforced: Partly (logging patterns exist in `apps/server/src/index.ts`; consistency elsewhere is policy-driven).
