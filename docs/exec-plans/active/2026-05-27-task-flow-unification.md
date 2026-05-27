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
- Task start logic is split across `createTask`, `applyTaskStartMode`, scheduler triggers, imports, and webhook entry points.
- Git mutation checks (pull/push/merge/checkpoint actions) are repeated across multiple handlers with similar-but-not-identical conditions.
- Sequence checkpoint resume is implemented as follow-up logic after mutation routes rather than first-class transition handling.
- Task detail behavior has required multiple point-fixes to maintain parity between `run_now` and `prepare_workspace` states.

## Acceptance Criteria
- One shared start orchestration API is used by task create/import/webhook and explicit action triggers.
- One shared mutation guard policy is used by pull/push/merge/checkpoint endpoints and returns stable reason codes.
- Checkpoint resolution and sequence resume run through one explicit transition path.
- Git operation command handling is centralized with consistent response shape and logging.
- Task detail renders from a consistent lifecycle view-model without mode-specific drift.
- Regression tests cover new task, existing build, existing ask, and Git/checkpoint transitions.

## Affected Files
- `apps/server/src/lib/task-start-mode.ts`
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
- Validate key scenarios: new run-now, prepare-workspace, existing build, existing ask, checkpoint blocked, post-checkpoint resume, pull/push/merge guard outcomes.

## Step 1 Inventory Snapshot
- New task create route:
`POST /tasks` in `apps/server/src/routes/tasks.ts` (creates task, applies start mode, optionally initializes sequence execution).
- Existing task manual action route:
`POST /tasks/:id/actions` in `apps/server/src/routes/tasks.ts` (manual build/ask triggers through scheduler).
- Import routes:
`POST /imports/issue` and `POST /imports/pull-request` in `apps/server/src/routes/imports.ts` (create task from GitHub import, then apply start mode).
- Webhook routes:
`POST /github/webhooks/:repositoryId` in `apps/server/src/routes/github-webhooks.ts` (issues/PR/comment/reaction paths that create tasks and apply start mode).
- Git mutation routes:
`POST /tasks/:id/push`, `POST /tasks/:id/pull`, `POST /tasks/:id/merge` in `apps/server/src/routes/tasks.ts`.
- Checkpoint mutation routes:
`POST /tasks/:id/change-proposals/:proposalId/apply|revert|revert-file|reject` in `apps/server/src/routes/tasks.ts`.

## Validation Commands
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
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
- 2026-05-27 17:47 UTC: Step 1 started. Added baseline start-mode coverage in `apps/server/src/lib/task-start-mode.test.ts` (run_now default/order/failure + idle + prepare_workspace + trigger action mapping).
- 2026-05-27 17:48 UTC: Captured task-entry inventory snapshot for create/import/webhook/manual actions and git/checkpoint mutation endpoints.
- 2026-05-27 17:53 UTC: Started Step 3 incrementally by introducing shared mutation guard reason codes in `apps/server/src/lib/task-mutation-guards.ts` and wiring `/tasks` mutation/action endpoints to return `{ message, reasonCode }` for blocked mutations.
- 2026-05-27 17:54 UTC: Added guard coverage in `apps/server/src/lib/task-mutation-guards.test.ts` for blocker code priority (`pending_checkpoint` over `active_terminal_session`).
- 2026-05-27 17:56 UTC: `npm run test -w @agentswarm/server` completed with one existing environment-sensitive failure in `spawner.workspace-provisioning.test.ts` (ask workspace path assertion), unrelated to changed files.
- 2026-05-27 18:02 UTC: Step 2 started. Added shared start orchestrator in `apps/server/src/lib/task-start-orchestrator.ts` and baseline tests in `apps/server/src/lib/task-start-orchestrator.test.ts`.
- 2026-05-27 18:03 UTC: Refactored task start entry points to use orchestrator: `POST /tasks`, import routes, and webhook-created task starts.
- 2026-05-27 18:04 UTC: `npm run lint -w @agentswarm/server` and targeted orchestrator/start/guard tests passed; full server test run still has the same existing `spawner.workspace-provisioning.test.ts` environment-sensitive failure.
- 2026-05-27 18:08 UTC: Began Step 4 consolidation by introducing a shared checkpoint transition helper in `apps/server/src/routes/tasks.ts` so apply/reject/revert/revert-file now all follow one continuation path (resume-check + refreshed response).
- 2026-05-27 18:09 UTC: Re-ran server lint and full server tests; lint passed and full test run still only fails at the same known environment-sensitive `spawner.workspace-provisioning.test.ts` assertion.

## Decisions
- 2026-05-27: Use incremental refactor with contract-preserving route APIs first, then internal consolidation.
- 2026-05-27: Introduce stable internal guard reason codes now, while preserving existing `message` field in route responses for backward compatibility.

## Completion Notes
- In progress.
