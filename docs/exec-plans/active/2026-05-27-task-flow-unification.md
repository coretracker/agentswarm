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

## Decisions
- 2026-05-27: Use incremental refactor with contract-preserving route APIs first, then internal consolidation.

## Completion Notes
- Pending implementation.
