# Execution Plan

## Title
- Make Auto-Apply Checkpoints Non-Blocking and Flicker-Free

## Goal
- Fix auto-apply checkpoint mode so checkpoint creation never blocks task progress or briefly surfaces manual checkpoint UI while auto-apply is enabled.
- Ensure a task only enters manual checkpoint recovery when auto-apply definitively fails.

## Non-goals
- No redesign of manual checkpoint review mode.
- No change to applied checkpoint history, revert, or reapply behavior except where needed to preserve recovery.
- No global or repository-level auto-apply preference.
- No attempt to auto-resolve git conflicts beyond the existing checkpoint apply behavior.

## Current State
- `autoApplyCheckpoints` is persisted on tasks and defaults to manual review when false.
- Build-run and interactive-terminal flows create `TaskChangeProposal` rows with `status: "pending"` first, then call server-side auto-apply.
- `TaskStore.createChangeProposal` hides `task.hasPendingCheckpoint` when `task.autoApplyCheckpoints` is true, but it still publishes a `task:change_proposal` event containing the transient pending proposal.
- `useTaskChangeProposals` merges every proposal event into UI state immediately, so task detail can briefly render pending checkpoint cards or review affordances before the later applied event arrives.
- Server guards such as `taskStore.hasPendingChangeProposal(taskId)` still treat the transient pending proposal as blocking, so scheduler, follow-up starts, postflight starts, and route-level immediate starts can pause or fail during the auto-apply window.
- The existing recovery path disables auto-apply after apply failure and leaves the checkpoint pending for manual recovery, which should remain visible.

## Acceptance Criteria
- With `autoApplyCheckpoints === true`, newly created checkpoints from build-run and interactive-terminal flows do not emit user-visible pending checkpoint state before auto-apply succeeds.
- With `autoApplyCheckpoints === true`, pending proposal guards do not block queued follow-ups, postflight, or immediate task starts solely because an auto-apply checkpoint is in progress.
- Auto-apply success persists and publishes the proposal as `applied`, preserving checkpoint history and revert support.
- Auto-apply failure disables `autoApplyCheckpoints`, publishes a clear pending checkpoint recovery state, logs the failure, and lets the user manually apply or reject the checkpoint.
- Manual mode behavior remains unchanged: pending checkpoints are visible and block later work until applied or rejected.
- The task detail UI, task list, and sidebar do not flicker into checkpoint review state when auto-apply succeeds.
- Regression tests cover the no-flicker event contract and no-blocking guard contract.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/services/task-store.test.ts`
- `apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `apps/web/components/task-detail-page.tsx`
- `apps/web/src/utils/task-history.ts`
- `apps/web/src/utils/task-history.test.ts`

## Step-by-Step Plan
1. Introduce an explicit auto-apply transition state.
- Add a server-side distinction between "pending for manual review" and "pending while system auto-apply is running."
- Prefer adding a proposal status such as `applying` or metadata such as `autoApplyState: "applying"` rather than relying on `task.autoApplyCheckpoints` plus `status: "pending"`.
- Keep the externally visible recovery state as ordinary `pending` only after auto-apply fails.

2. Make checkpoint creation atomic from the user's perspective.
- Replace direct `createChangeProposal(... status: "pending")` usage in auto-apply flows with a helper such as `createAutoApplyChangeProposal`.
- That helper should persist the proposal without publishing a user-visible pending event, or persist it as `applying` and publish only a non-review state.
- On apply success, publish the final `applied` proposal event.
- On apply failure, transition the proposal to `pending`, disable `autoApplyCheckpoints`, publish task/proposal updates, and append recovery logs.

3. Centralize pending checkpoint policy.
- Add a store/helper method such as `hasUserVisiblePendingChangeProposal(taskId)` or extend `hasPendingChangeProposal` with options.
- Use it anywhere the intent is "block user/task progression because manual review is required."
- Keep a separate strict query for operations that must prevent concurrent checkpoint mutation against any unresolved proposal.

4. Update scheduler and route guards to use user-visible pending semantics.
- Update `SchedulerService.triggerAction`, `triggerPostflight`, and queue draining decisions so auto-apply-in-progress does not block later queued work once the task execution is otherwise idle.
- Update route-level immediate-start logic in `apps/server/src/routes/tasks.ts` to avoid treating auto-apply-in-progress as a manual blocker.
- Update `getMutationBlocked` to return `pending_checkpoint` only for manual/recovery pending checkpoints.

5. Harden auto-apply sequencing in `SpawnerService`.
- Ensure build-run and terminal checkpoint creation await auto-apply completion before triggering queue continuation paths.
- Avoid duplicate starts by choosing one continuation trigger point after auto-apply reaches a terminal state.
- Preserve the current fallback commit subject and failure log behavior.

6. Make the UI resilient to transient backend states.
- If an `applying` proposal status or auto-apply metadata is exposed, filter it out of manual checkpoint review rendering.
- Keep applied checkpoint history visible after success.
- Show pending checkpoint recovery only when auto-apply has failed and the task flag has been disabled.
- Add a defensive filter in `useTaskChangeProposals` or task detail derivation so a future transient backend event cannot show manual checkpoint UI for auto-apply tasks.

7. Add regression tests.
- Task store: creating an auto-apply proposal does not publish a user-visible pending checkpoint event and does not set `hasPendingCheckpoint`.
- Mutation guards: auto-apply-in-progress is not reported as `pending_checkpoint`; recovery pending is reported.
- Scheduler: queued follow-up can continue across an auto-apply checkpoint and does not hang on the transient proposal.
- Spawner: auto-apply success transitions proposal to `applied`; auto-apply failure disables auto-apply and leaves manual recovery pending.
- Web: proposal hook/detail derivation does not render pending checkpoint UI for auto-apply transient states.

8. Run verification.
- Run focused server tests for task store, scheduler, mutation guards, and spawner checkpoint auto-apply paths.
- Run focused web tests for lifecycle/history rendering.
- Run `./scripts/harness/check-human-gated-flow.sh`.
- Run `./scripts/harness/check.sh` and `./scripts/harness/test.sh` if environment prerequisites are available.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: Yes
- Uncertainties Logged: Yes
- Human Review Completed: Yes
- User Approval To Start: Yes
- Baseline Checks Run: Yes; focused baseline tests passed before implementation
- Visible Task List Updated: Yes
- Task-Level Tests/Lint/Build: Focused server/web tests passed; server and web TypeScript lint passed
- Self Review Complete: Yes
- Code Review Complete: Agent self-review only
- Final Verification Complete: Partial; focused verification passed, `check.sh` is blocked by pre-existing broken links in `docs/repomix.md`
- Security/Privacy Review Complete: Yes; no new credential or external data paths
- Docs/Changelog Updated: Yes; this execution plan documents the behavior change

## Validation Commands
- `node --import tsx --test apps/server/src/services/task-store.test.ts`
- `node --import tsx --test apps/server/src/lib/task-mutation-guards.test.ts`
- `node --import tsx --test apps/server/src/services/scheduler.test.ts`
- `node --import tsx --test apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `npm test --workspace apps/web -- src/utils/task-lifecycle-view-model.test.ts`
- `npm test --workspace apps/web -- src/utils/task-history.test.ts`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Adding a new proposal status affects shared types, persistence normalization, and UI status labels; missing one path could break older proposal rendering.
- Suppressing pending events too aggressively could hide recovery if auto-apply fails before the final failure transition publishes.
- Relaxing pending checkpoint guards must not allow manual mutations against a checkpoint that is actively being auto-applied.
- Queue continuation must remain single-shot; both checkpoint apply completion and existing scheduler code can attempt to start the next pending action.

## Rollback Plan
- Revert the auto-apply transition-state additions.
- Restore checkpoint creation to the existing pending-first behavior.
- Restore all guards to use strict `hasPendingChangeProposal`.
- Keep the task-level `autoApplyCheckpoints` setting unchanged if rollback is only for the flicker/nonblocking fix.

## Progress Log
- 2026-06-12 08:57 UTC: Investigated current auto-apply plan, spawner auto-apply path, task-store proposal publication, scheduler guards, route start guards, and web proposal rendering.
- 2026-06-12 08:57 UTC: Created focused repair plan for auto-apply flicker and nonblocking behavior.
- 2026-06-12 09:18 UTC: Implemented `applying` checkpoint status, moved build auto-apply before execution idle transitions, preserved manual recovery on failure, and filtered transient applying proposals from task history/UI.
- 2026-06-12 09:18 UTC: Verified focused server tests, web history tests, server/web TypeScript lint, human-gated flow check, and `git diff --check`; `check.sh` remains blocked by existing broken links in `docs/repomix.md`.

## Decisions
- 2026-06-12: Auto-apply success should be user-visible only as an applied historical checkpoint, not as a pending checkpoint review state.
- 2026-06-12: Auto-apply failure should intentionally fall back to manual recovery by disabling auto-apply and publishing an ordinary pending checkpoint.
- 2026-06-12: Server-side policy must be authoritative; UI filtering is a defensive layer, not the primary fix.

## Completion Notes
- Implemented using an explicit `applying` checkpoint status for system auto-apply. Applying checkpoints are unresolved for duplicate-checkpoint safety, but they are not manual pending checkpoints and are hidden from task history/manual checkpoint rendering.
- Build and postflight auto-apply now runs before execution is marked idle, closing the race where queued work could observe an idle task before the checkpoint was applied.
- If auto-apply fails, the task disables auto-apply and transitions the proposal back to ordinary `pending` recovery state.
