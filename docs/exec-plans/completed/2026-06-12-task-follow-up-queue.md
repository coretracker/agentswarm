# Execution Plan

## Title
- Task-Scoped Follow-Up Queue for Ask/Build Continuations

## Goal
- Let users queue follow-up `ask` and `build` prompts on a task while the agent is already working, then execute those follow-ups sequentially on the same task whenever the task becomes ready.

## Non-goals
- No GitHub-triggered enqueueing in this phase.
- No cross-task or repository-level queue UX in this phase.
- No queue reordering or in-place editing in v1.
- No per-queued-item snapshot of provider/model settings in v1.
- No change to interactive terminal semantics beyond respecting existing blockers.

## Current State
- Task detail already lets users add `ask`, `build`, and `comment` messages.
- `POST /tasks/:id/messages` starts `ask`/`build` immediately or returns `409` if the task is already busy, except for the current parallel-ask exception.
- The runtime scheduler queue is task-level and internal; it does not model multiple follow-up prompts on one task.
- Task history is built from messages, runs, and change proposals, with auto-run grouping based mostly on timestamp and action.
- Build completion may leave the task in a pending checkpoint state, which blocks further mutations until apply/reject.

## Acceptance Criteria
- Users can append multiple follow-up `ask`/`build` prompts to a task while the current run is active.
- Queued follow-ups appear in task history immediately as pending.
- Follow-ups run FIFO per task.
- If the task is idle and has no older pending follow-ups, a new `ask`/`build` message starts immediately.
- After a successful run, the next queued follow-up starts automatically.
- If a build ends with a pending checkpoint, later queued follow-ups stay pending and auto-resume after the checkpoint is resolved.
- If a run fails or is cancelled, later queued follow-ups remain pending and the queue pauses.
- Task detail exposes `Run next queued item` for paused queues after failure/cancel.
- Pending queued follow-ups can be removed before they start, and removal deletes them from history.
- Existing comment behavior remains unchanged.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/task-queue-store.ts`
- `apps/server/src/services/scheduler.ts`
- `apps/server/src/lib/task-start-orchestrator.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/utils/task-history.ts`
- `apps/web/components/task-detail-page.tsx`
- Related server/web tests for task routes, scheduler, task store, and task history

## Step-by-Step Plan
1. Extend task message and run types to model queued follow-ups.
- Add queue metadata to `TaskMessage` for pending follow-up prompts.
- Add `promptMessageId` to `TaskRun` so a run can be linked to the exact queued prompt it consumed.
- Add realtime support for deleting a pending queued message.

2. Make follow-up prompts message-backed queue items.
- Treat a queued follow-up as a normal user task message plus queue metadata.
- Add task-store helpers to fetch the oldest pending follow-up, mark it started, delete it if still pending, and detect whether pending follow-ups remain.

3. Change message submission semantics.
- Keep `comment` unchanged.
- For `ask`/`build`, stop rejecting solely because the task is already running or checkpoint-blocked.
- Start immediately only when the task is idle and no older pending follow-ups exist.
- Otherwise persist the message as a pending queued follow-up and return the refreshed task.

4. Upgrade the runtime queue to target a specific prompt.
- Extend scheduler queue entries to carry `promptMessageId` in addition to `taskId`, `action`, and input.
- Preserve current immediate/manual trigger behavior for promptless reruns by allowing `promptMessageId = null`.
- Ensure the scheduler starts the exact queued prompt that was selected.

5. Add automatic continuation rules.
- After a successful ask/build run, enqueue the oldest pending follow-up on that task if the task is ready.
- After checkpoint apply/reject clears the pending checkpoint, auto-enqueue the oldest pending follow-up on that task.
- Do not auto-continue after failure or cancel; mark the queue paused for that task until the user resumes.

6. Add paused-queue resume and pending-item removal.
- Add `POST /tasks/:id/queue/run-next` to start the next pending follow-up after failure/cancel pause.
- Add `DELETE /tasks/:id/messages/:messageId/queue` to remove a pending queued follow-up before it starts.
- Reject removal once the queued item has already been consumed into a run.

7. Update task history and task detail UX.
- Render pending queued `ask`/`build` messages in history as queued entries.
- Delete pending history entries fully when they are removed.
- Group runs to prompts by `TaskRun.promptMessageId` instead of timestamp-only matching.
- Replace current busy/conflict success messaging with queue-aware messaging such as `Follow-up queued`.
- Show `Run next queued item` when later pending follow-ups exist but the queue is paused after failure/cancel.
- Keep v1 queue controls to append and remove only; no reorder UI.

8. Tighten route behavior around direct actions.
- Keep `/tasks/:id/actions` for immediate reruns.
- Refuse direct action starts while older queued follow-ups exist, so v1 never silently skips queue order.
- Remove or disable the current parallel-ask fast path in favor of strict in-task sequential queue semantics.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: Yes
- Uncertainties Logged: Yes
- Human Review Completed: Yes
- User Approval To Start: Yes
- Baseline Checks Run: Yes
- Visible Task List Updated: Yes
- Task-Level Tests/Lint/Build: In progress
- Self Review Complete: In progress
- Code Review Complete: N/A
- Final Verification Complete: In progress
- Security/Privacy Review Complete: N/A in planning-only phase
- Docs/Changelog Updated: Plan updated during implementation

## Validation Commands
- `node --import tsx --test apps/server/src/services/scheduler.test.ts`
- `node --import tsx --test apps/server/src/services/task-store.test.ts`
- `node --import tsx --test apps/server/src/lib/task-start-orchestrator.test.ts`
- `node --import tsx --test apps/web/src/utils/task-history.test.ts`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Message-backed queue state can complicate task history grouping unless run-to-message linkage is explicit.
- Auto-resume after checkpoint resolution can create duplicate starts if queue consumption is not atomic.
- Preserving later queued follow-ups across failure/cancel requires a clear paused-state model so users understand why nothing started.
- Removing the current parallel-ask path may change existing expectations for users who relied on concurrent asks.

## Rollback Plan
- Revert queue metadata additions on `TaskMessage` and `TaskRun`.
- Revert task message route changes so busy tasks return immediate `409` again.
- Revert scheduler queue entries back to task-level triggers without `promptMessageId`.
- Revert task detail queue UX and restore current history rendering.

## Progress Log
- 2026-06-12 00:00 UTC: Reviewed task message route, scheduler, task store, realtime hooks, and task history assembly to map the current execution path.
- 2026-06-12 00:00 UTC: Confirmed product decisions for v1: always queue follow-ups on busy tasks, FIFO per task, auto-resume after checkpoint resolution, append/remove queue controls only, show pending items in history, pause after failure/cancel, and explicit resume via `Run next queued item`.
- 2026-06-12 00:00 UTC: Produced decision-complete implementation plan.
- 2026-06-12 09:45 UTC: Implemented message-backed queue metadata, prompt-to-run linkage, queue-aware scheduler entries, queue pause/resume routes, and task-detail queue controls.
- 2026-06-12 10:05 UTC: Added targeted tests for task-store pending messages, task-history prompt linkage, and scheduler queued-prompt consumption/auto-advance.
- 2026-06-12 10:15 UTC: Verified `@verft/server` TypeScript build/lint, verified `@verft/web` production build, and re-ran focused server/web tests. Known unrelated failures remain in docs checks and the sandboxed `spawner.workspace-provisioning` test.

## Decisions
- 2026-06-12: Queue scope is per task, not global.
- 2026-06-12: Follow-up prompts are stored as task messages with queue metadata rather than a separate public queue resource.
- 2026-06-12: Pending queued follow-ups appear in task history immediately.
- 2026-06-12: Pending queued follow-ups can be removed before start, and removal deletes the history entry entirely.
- 2026-06-12: Queue auto-resumes after checkpoint resolution but pauses after failure/cancel until the user explicitly runs the next queued item.
- 2026-06-12: v1 queue controls are append and remove only; no reorder or in-place edit.
- 2026-06-12: The current parallel-ask exception is removed so in-task queue order stays strict.

## Completion Notes
- Implemented message-backed task follow-up queues with FIFO scheduler execution, prompt-to-run linkage, pending queue history entries, removal before start, auto-continuation after successful runs, checkpoint-resolution continuation, and paused queue recovery controls.
- Focused server and web verification passed during implementation. Full harness checks remained blocked by unrelated existing docs/sandbox issues noted in the progress log.
