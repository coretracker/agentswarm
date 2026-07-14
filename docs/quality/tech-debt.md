# Tech Debt Register

Top gaps are prioritized from `docs/quality/scorecard.md`.

## 1) Shared Types Have No Direct Tests
- Impact: contract regressions can break both server and web at once.
- Evidence: `packages/shared-types/src/index.ts` has no `*.test.*` files.
- Suggested fix: add a small contract test suite (shape/enum compatibility checks) and run it from `npm run ci`.

## 2) Runtime Domain Has Very Low Verification
- Impact: agent runtime failures are harder to detect before real task execution.
- Evidence: no runtime tests found under `agent-runtime*` or `tools/codex-web-terminal`.
- Suggested fix: add smoke checks for runtime startup + command execution, and include them in PR readiness.

## 3) Web Coverage Is Shallow For Core Flows
- Impact: high-risk UI flows can regress even when utility tests pass.
- Evidence: current browser coverage is one file (`apps/web/e2e/auth.smoke.spec.ts`) with login-focused checks.
- Suggested fix: add e2e happy-path tests for task creation, task detail load, and repository flow.

## 4) CI Does Not Run Architecture Checks
- Impact: merges can pass CI without proving architecture boundary rules.
- Evidence: `.github/workflows/lint-and-tests.yml` runs `./scripts/ci.sh`, which runs lint, build, and tests only.
- Suggested fix: decide whether boundary checks should return to the required gate after the lint/test/build-only period.

## 5) Documentation Drift Exists In Quality Docs
- Impact: agents and maintainers can follow outdated guidance.
- Evidence: `docs/quality/known-issues.md` still states no CI workflow exists.
- Suggested fix: align `known-issues.md` with current repository state and keep it updated with each harness change.

## 6) Legacy Task Status Is Overloaded
- Impact: task lifecycle UI has to interpret a single `status` field that mixes workflow state, execution state, and legacy result state.
- Evidence: tasks now expose `workflowStatus`, `executionStatus`, `executionAction`, and `reviewReason`, but `status` remains for compatibility.
- Suggested fix: migrate callers to the new fields, backfill persisted tasks if needed, then remove legacy `completed`/`answered`/`accepted` values and eventually retire overloaded `status`.

## TODO
- TODO: assign owner and target date for each item.
- TODO: track status (`open`, `in progress`, `done`) for each item.
