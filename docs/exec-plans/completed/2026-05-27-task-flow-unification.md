# Execution Plan

## Title
- Task Flow Unification: Start Lifecycle, Mutation Guards, and Git/Checkpoint Actions

## Goal
- Unify task execution behavior across new-task creation, existing build/ask actions, and Git/checkpoint mutations so behavior is consistent, predictable, and easier to debug.

## Non-goals
- No UI redesign beyond behavior consistency and message parity.
- No provider/model behavior changes (Codex/Claude execution internals stay unchanged).
- No large schema rewrite of historical task records in this phase.

## Current State
- Task start logic is split across `createTask`, legacy start-mode handling, scheduler triggers, imports, and webhook entry points.
- Git mutation checks (pull/push/merge/checkpoint actions) are repeated across multiple handlers with similar-but-not-identical conditions.
- Sequence checkpoint resume is implemented as follow-up logic after mutation routes rather than first-class transition handling.
- Task detail behavior has required multiple point-fixes to maintain parity between creation-time execution states.

## Acceptance Criteria
- One shared start orchestration API is used by task create/import/webhook and explicit action triggers.
- One shared mutation guard policy is used by pull/push/merge/checkpoint endpoints and returns stable reason codes.
- Checkpoint resolution and sequence resume run through one explicit transition path.
- Git operation command handling is centralized with consistent response shape and logging.
- Task detail renders from a consistent lifecycle view-model without mode-specific drift.
- Regression tests cover new task, existing build, existing ask, and Git/checkpoint transitions.

## Affected Files
- Legacy task-start helper code, since removed
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/routes/imports.ts`
- `apps/server/src/routes/github-webhooks.ts`
- `apps/server/src/lib/task-mutation-guards.ts`
- `apps/server/src/services/scheduler.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/sequence-execution-service.ts`
- `apps/web/components/task-detail-page.tsx`
- `apps/web/src/api/client.ts`
- `apps/server/src/services/*.test.ts`
- `apps/web/components/*.test.*` (as needed)
- `docs/product/user-flows.md`

## Step-by-Step Plan
1. Baseline and Test Inventory
- Enumerate all task-entry paths (create/import/webhook/manual actions).
- Add/expand failing-first tests for inconsistencies in start and mutation behavior.

2. Start Orchestrator Extraction
- Introduce a single server-side orchestrator for task start intents.
- Refactor `/tasks`, `/imports/*`, and webhook-triggered task starts to call the orchestrator.
- Preserve current external API contracts.

3. Shared Mutation Guard Policy
- Define one guard API returning machine-readable reason codes plus user-facing messages.
- Replace ad-hoc pull/push/merge/checkpoint condition checks with shared guard calls.

4. Checkpoint + Sequence Transition Unification
- Consolidate checkpoint resolution and auto-apply sequence resume into one transition function.
- Ensure apply/reject/revert all use the same continuation contract.

5. Git Command Unification
- Add an internal shared command handler for pull/push/merge operations.
- Normalize operation logging, retries, and response payload assembly.

6. Lifecycle View-Model Unification (Web)
- Drive task detail sections from one lifecycle model mapping (`status`, `enqueued`, blockers).
- Remove duplicated conditional rendering paths that diverge by mode.

7. Hardening and Regression Pass
- Run full harness checks/tests.
- Validate key scenarios: new task creation, existing build, existing ask, checkpoint blocked, post-checkpoint resume, pull/push/merge guard outcomes.

## Step 1 Inventory Snapshot
- New task create route:
`POST /tasks` in `apps/server/src/routes/tasks.ts` (creates task, starts execution, optionally initializes sequence execution).
- Existing task manual action route:
`POST /tasks/:id/actions` in `apps/server/src/routes/tasks.ts` (manual build/ask triggers through scheduler).
- Import routes:
`POST /imports/issue` and `POST /imports/pull-request` in `apps/server/src/routes/imports.ts` (create task from GitHub import, then start execution).
- Webhook routes:
`POST /github/webhooks/:repositoryId` in `apps/server/src/routes/github-webhooks.ts` (issues/PR/comment/reaction paths that create tasks and start execution).
- Git mutation routes:
`POST /tasks/:id/push`, `POST /tasks/:id/pull`, `POST /tasks/:id/merge` in `apps/server/src/routes/tasks.ts`.
- Checkpoint mutation routes:
`POST /tasks/:id/change-proposals/:proposalId/apply|revert|revert-file|reject` in `apps/server/src/routes/tasks.ts`.

## Validation Commands
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`
- `npm run lint -w @verft/server`
- `npm run lint -w @verft/web`
- Targeted tests for scheduler/task-store/routes/sequence execution.

## Risks
- Behavior drift during refactor of route handlers.
- Hidden coupling between scheduler queue semantics and UI assumptions.
- Sequence auto-apply regressions if checkpoint transitions are not fully covered by tests.

## Rollback Plan
- Keep refactor split into small commits by phase.
- If regressions appear, rollback phase commits in reverse order while preserving test additions.
- Feature-flag orchestrator/guard usage if partial rollout is required.

## Progress Log
- 2026-05-27 19:20 UTC: Plan created; no implementation changes started yet.
- 2026-05-27 17:47 UTC: Step 1 started. Added baseline coverage for the previous start-mode helper behavior.
- 2026-05-27 17:48 UTC: Captured task-entry inventory snapshot for create/import/webhook/manual actions and git/checkpoint mutation endpoints.
- 2026-05-27 17:53 UTC: Started Step 3 incrementally by introducing shared mutation guard reason codes in `apps/server/src/lib/task-mutation-guards.ts` and wiring `/tasks` mutation/action endpoints to return `{ message, reasonCode }` for blocked mutations.
- 2026-05-27 17:54 UTC: Added guard coverage in `apps/server/src/lib/task-mutation-guards.test.ts` for blocker code priority (`pending_checkpoint` over `active_terminal_session`).
- 2026-05-27 17:56 UTC: `npm run test -w @verft/server` completed with one existing environment-sensitive failure in `spawner.workspace-provisioning.test.ts` (ask workspace path assertion), unrelated to changed files.
- 2026-05-27 18:02 UTC: Step 2 started. Added shared start orchestrator in `apps/server/src/lib/task-start-orchestrator.ts` and baseline tests in `apps/server/src/lib/task-start-orchestrator.test.ts`.
- 2026-05-27 18:03 UTC: Refactored task start entry points to use orchestrator: `POST /tasks`, import routes, and webhook-created task starts.
- 2026-05-27 18:04 UTC: `npm run lint -w @verft/server` and targeted orchestrator/start/guard tests passed; full server test run still has the same existing `spawner.workspace-provisioning.test.ts` environment-sensitive failure.
- 2026-05-27 18:08 UTC: Began Step 4 consolidation by introducing a shared checkpoint transition helper in `apps/server/src/routes/tasks.ts` so apply/reject/revert/revert-file now all follow one continuation path (resume-check + refreshed response).
- 2026-05-27 18:09 UTC: Re-ran server lint and full server tests; lint passed and full test run still only fails at the same known environment-sensitive `spawner.workspace-provisioning.test.ts` assertion.
- 2026-05-27 18:17 UTC: Completed Step 5 by adding shared Git mutation handling helpers in `apps/server/src/routes/tasks.ts` (`ensureGitMutationAllowed`, `runGitCommand`) and applying them to pull/push/merge routes with consistent error responses.
- 2026-05-27 18:19 UTC: Completed Step 6 by introducing lifecycle mapping utility `apps/web/src/utils/task-lifecycle-view-model.ts` and updating `apps/web/components/task-detail-page.tsx` to consume one lifecycle view-model.
- 2026-05-27 18:21 UTC: Added lifecycle utility coverage in `apps/web/src/utils/task-lifecycle-view-model.test.ts` and included it in `apps/web/package.json` test command.
- 2026-05-27 18:24 UTC: Extended shared start orchestration coverage for explicit task action triggers via `orchestrateTaskActionStart` in `apps/server/src/lib/task-start-orchestrator.ts`, applied in `/tasks/:id/actions`.
- 2026-05-27 18:25 UTC: Added `orchestrateTaskActionStart` tests in `apps/server/src/lib/task-start-orchestrator.test.ts`.
- 2026-05-27 18:27 UTC: Fixed `spawner.workspace-provisioning.test.ts` host-path assertion setup to match current workspace host path resolution and restored full server test pass.
- 2026-05-27 18:29 UTC: Hardening run complete: `./scripts/harness/check.sh` passed; `TEST_SCOPE=integration ./scripts/harness/test.sh` passed; `npm run test -w @verft/server` passed; `npm run test -w @verft/web` passed.

## Decisions
- 2026-05-27: Use incremental refactor with contract-preserving route APIs first, then internal consolidation.
- 2026-05-27: Introduce stable internal guard reason codes now, while preserving existing `message` field in route responses for backward compatibility.
- 2026-05-27: Route-level Git mutation handling should use shared helpers for guarding and operation error mapping to keep responses uniform.
- 2026-05-27: Task detail lifecycle UI state should come from a dedicated utility to avoid mode-specific rendering drift.

## Completion Notes
- Completed.
- Acceptance criteria met:
- Shared start orchestration is used across task create/import/webhook paths and explicit task action triggers.
- Shared mutation guard policy with reason codes is applied across pull/push/merge/checkpoint mutation endpoints.
- Checkpoint mutation continuation (resume + refresh) is unified through one helper path.
- Git operation route handling is centralized for guard/error/response consistency.
- Task detail lifecycle rendering now uses one lifecycle view-model mapping.
- Regression coverage expanded with new server/web tests; all local server/web test suites passed.
- Environment note:
- `./scripts/harness/test.sh` with full scope (`TEST_SCOPE=all`) still requires Docker for app boot in this environment, so integration scope was used for harness regression validation.
