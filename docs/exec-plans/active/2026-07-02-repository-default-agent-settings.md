# Execution Plan

## Title
- Repository Default Agent Settings

## Goal
- Allow each repository to define nullable default agent provider, model, and effort profile settings.
- Apply task creation fallback in this order:
  - provider = task-level ?? repository default ?? system default
  - model = task-level ?? repository default ?? system default for resolved provider
  - effort profile = task-level ?? repository default ?? system default for resolved provider

## Non-goals
- No change to task update/config behavior after a task is created.
- No repository-specific credential changes.
- No provider/model catalog changes beyond reusing existing selectors and defaults.

## Current State
- Repository types and persistence do not store provider/model/profile defaults.
- HTTP task creation currently resolves provider/model/profile only from task payload and system settings.
- MCP task creation uses the same system-only fallback.
- Task creation UI initializes from system settings and does not prefill from repository defaults.

## Acceptance Criteria
- Repositories can persist nullable `defaultProvider`, `defaultModel`, and `defaultProviderProfile`.
- HTTP task creation respects the required 3-tier fallback.
- MCP task creation respects the required 3-tier fallback.
- Repository editor exposes nullable provider/model/effort controls using existing UI patterns.
- Task creation UI pre-populates from repository defaults when a repository is selected.
- Repositories with null defaults behave exactly like today.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/services/repository-store.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/mcp/tools.ts`
- `apps/web/components/repository-editor-page.tsx`
- `apps/web/components/task-definition-fields.tsx`
- Related focused tests under `apps/server/src/**/*.test.ts` and `apps/web/src/**/*.test.ts`

## Step-by-Step Plan
1. Add nullable repository default fields to shared types and repository API schemas.
2. Add append-only Postgres migration columns and wire both Redis and Postgres repository stores.
3. Refactor task-create provider/model/profile resolution so HTTP and MCP both use repository-aware fallback.
4. Add repository editor controls for default provider, model, and effort.
5. Update task definition form initialization/prefill logic to use selected repository defaults without breaking system-default behavior.
6. Add or update focused tests for repository persistence and task creation fallback behavior.
7. Run focused verification, complete self-review, and commit/push the branch changes.

## Human-Gated Flow Evidence
- Requirements Read: 2026-07-02 UTC - Read repository task request and standing harness guidance.
- Requirements Understood: 2026-07-02 UTC - Confirmed nullable repository defaults and 3-tier task creation fallback across HTTP, MCP, and UI.
- Repository Research Complete: 2026-07-02 UTC - Reviewed shared types, migrations, repository store, repository routes, task routes, MCP create flow, and task/repository UI components.
- Uncertainties Logged: 2026-07-02 UTC - Task form prefill must avoid clobbering user edits when repository selection changes.
- Human Review Completed: 2026-07-02 UTC - User provided the concrete goal and acceptance criteria in this task thread.
- User Approval To Start: 2026-07-02 UTC - Current request supplies the implementation scope to proceed.
- Baseline Checks Run: 2026-07-02 UTC - `git diff --check` passed before verification; initial focused test/lint attempts were blocked because this checkout had no `node_modules`.
- Visible Task List Updated: 2026-07-02 UTC - Plan and task list captured in this execution plan and conversation.
- Task-Level Tests/Lint/Build: 2026-07-02 UTC - `node --import tsx --test apps/server/src/lib/task-create-defaults.test.ts apps/server/src/services/repository-store.test.ts apps/server/src/mcp/tools.test.ts`, `node --import tsx --test apps/web/components/task-definition-fields.test.ts`, `npm run lint -w @agentswarm/server`, and `npm run lint -w @agentswarm/web` passed after installing dependencies with `npm ci --include=dev`.
- Self Review Complete: 2026-07-02 UTC - Reviewed the fallback chain across shared types, repository persistence, HTTP task creation, MCP task creation, and task/repository UI behavior.
- Code Review Complete: 2026-07-02 UTC - Checked for fallback-order regressions, nullable repository-default handling, and task-form clobbering risks when repository selection changes.
- Final Verification Complete: 2026-07-02 UTC - `git diff --check` and `./scripts/harness/check-human-gated-flow.sh` passed. `npm run ci` failed for a repository-level baseline issue because `./scripts/ci.sh` runs `npm ci` in a Node 22 container, but this repository currently has no `package-lock.json`.
- Security/Privacy Review Complete: 2026-07-02 UTC - Repository defaults only store non-secret provider/model/profile metadata and do not change credential handling paths.
- Docs/Changelog Updated: 2026-07-02 UTC - Added this execution plan with current validation evidence; no product-doc copy changes were required for the behavior itself.

## Validation Commands
- `node --import tsx --test apps/server/src/services/repository-store.test.ts`
- `node --import tsx --test apps/server/src/lib/task-create-defaults.test.ts`
- `node --import tsx --test apps/server/src/routes/tasks.test.ts apps/server/src/mcp/tools.test.ts`
- `node --import tsx --test apps/web/components/task-definition-fields.test.ts`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `git diff --check`
- `./scripts/harness/check-human-gated-flow.sh`

## Risks
- Repo defaults must not override explicit task-level values.
- Model fallback must be computed after provider fallback resolves, or provider/model pairs can become inconsistent.
- UI auto-prefill must not unexpectedly reset fields the user already changed manually.
- Null repository defaults must serialize consistently across Redis, Postgres, HTTP, and UI.

## Rollback Plan
- Revert repository default fields from types, migration, store, routes, MCP, and UI.
- Leave system-level defaults as the only active resolution path.

## Progress Log
- 2026-07-02 UTC: Reviewed the affected server and UI paths and created this implementation plan before code changes.
- 2026-07-02 UTC: Implemented nullable repository default provider/model/profile fields, repository-aware task fallback resolution, repository editor controls, and task form repository-prefill behavior.
- 2026-07-02 UTC: Installed workspace dependencies, ran focused server/web tests plus lint, and confirmed the aggregate `npm run ci` failure is a pre-existing repo baseline problem caused by a missing `package-lock.json`.

## Decisions
- 2026-07-02: Repository defaults are nullable and represent fall-through behavior, not required configuration.
- 2026-07-02: HTTP and MCP task creation should share the same repository-aware resolution logic.

## Completion Notes
- Repository-level default provider, model, and effort settings are implemented across shared types, persistence, HTTP task creation, MCP task creation, and UI prefill.
- Focused validation passed; aggregate `npm run ci` remains blocked by the repository's missing `package-lock.json`.
