## Title
- Scheduler for Planned Tasks

## Goal
- Add a calendar-based scheduler so users can create, view, edit, and manually start planned tasks without automatic execution.

## Non-goals
- Automatic task start when scheduled time arrives.
- Changes to existing permission model beyond applying existing task visibility/access rules.
- Replacing current task detail UX for non-scheduled tasks.

## Current State
- Tasks support run states (queued, active, open, archived, etc.) but no explicit planned/scheduled status.
- Task creation supports immediate or workspace-prep starts; no scheduler-specific datetimes.
- Navigation does not include a Scheduler destination.
- No calendar UI exists in the web app.

## Acceptance Criteria
- Main navigation includes `Scheduler`.
- Scheduler page shows calendar with `Month`, `Week`, and `Day` views; default view is `Week`.
- Scheduler creation uses existing task creation fields plus scheduler-only `start datetime` and `end datetime`.
- Datetime fields appear only in scheduler creation flow.
- Scheduled tasks appear in correct calendar time slots.
- Scheduled tasks can be edited while still scheduled and not started.
- If task already started (or no longer scheduled), scheduler edit redirects to task detail.
- Scheduler edit includes `Run task now` to manually start task.
- Scheduler visibility respects existing ownership/permissions.
- Backend defines fields/status for scheduled vs started tasks.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/lib/task-status.ts`
- `apps/server/src/lib/task-status.test.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/auth/access.ts`
- `apps/web/components/app-shell.tsx`
- `apps/web/components/task-definition-fields.tsx`
- `apps/web/components/task-create-modal.tsx`
- `apps/web/components/task-create-page.tsx`
- `apps/web/components/scheduler-page.tsx` (new)
- `apps/web/components/scheduler-task-edit-page.tsx` (new)
- `apps/web/app/scheduler/page.tsx` (new)
- `apps/web/app/scheduler/tasks/[id]/page.tsx` (new)

## Step-by-Step Plan
1. Add shared task scheduling model (`scheduled` status and datetime fields) and normalize status handling.
2. Extend task create/list/edit/run API behavior for scheduled lifecycle and manual run-now.
3. Add scheduler navigation route and web API helpers.
4. Build scheduler calendar UI (Month/Week/Day) with default Week and scheduled task rendering.
5. Reuse task creation form in scheduler mode with scheduler-only datetime fields.
6. Add scheduled-task edit page with Run now and redirect guard.
7. Add/adjust tests and run targeted checks.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: Yes
- Uncertainties Logged: Yes (noted environment constraints: missing `python3`, no Docker Compose)
- Human Review Completed: TODO
- User Approval To Start: Implicit from task request
- Baseline Checks Run: `REMOTE_BUILD=0 ./scripts/harness/doctor.sh` (blocked: python3 missing)
- Visible Task List Updated: Yes (execution plan + progress log)
- Task-Level Tests/Lint/Build: Yes (`harness/check.sh`, `harness/test.sh` with `TEST_SCOPE=unit` and `TEST_SCOPE=integration`, plus workspace lint/test)
- Self Review Complete: In progress
- Code Review Complete: TODO
- Final Verification Complete: In progress
- Security/Privacy Review Complete: TODO
- Docs/Changelog Updated: TODO

## Validation Commands
- `./scripts/harness/test.sh`
- `./scripts/harness/check.sh`
- `npm --workspace @agentswarm/server test -- task-status.test.ts`
- `npm --workspace @agentswarm/web test -- task-lifecycle-view-model.test.ts`

## Risks
- Introducing new status can break existing status assumptions in UI and services.
- Scheduled creation may conflict with current start-mode behavior.
- Calendar rendering quality may regress on small screens if layout is not constrained.

## Rollback Plan
- Revert scheduler route/UI files.
- Revert shared type and task-store status changes.
- Revert task routes for schedule fields/endpoints.
- Confirm existing tasks lifecycle tests pass after rollback.

## Progress Log
- 2026-06-01 12:05 UTC: Reviewed task model/routes/UI; identified integration points for scheduled status, scheduler page, and scheduler-only creation fields.
- 2026-06-01 12:07 UTC: Created execution plan and queued implementation steps.
- 2026-06-01 12:34 UTC: Added backend scheduling model (`scheduled` status, `scheduledStartAt`, `scheduledEndAt`) and schedule-specific task APIs (`PATCH /tasks/:id/schedule`, `POST /tasks/:id/schedule/run-now`).
- 2026-06-01 12:47 UTC: Added scheduler navigation route and new pages (`/scheduler`, `/scheduler/tasks/:id`) with Month/Week/Day calendar UI and scheduled-task edit/run-now flow.
- 2026-06-01 12:55 UTC: Ran lint/build checks; full `harness/check.sh` passed locally with `REMOTE_BUILD=0`.
- 2026-06-01 13:01 UTC: Ran `harness/test.sh` for `unit` and `integration`; both passed. Full `all` scope blocked at e2e boot due missing Docker Compose in environment.

## Decisions
- 2026-06-01: Use explicit `scheduled` task status plus `scheduledStartAt`/`scheduledEndAt` fields for planner visibility and editability checks.
- 2026-06-01: Build scheduler UI without adding external calendar dependencies; implement Month/Week/Day using existing UI stack.

## Completion Notes
- Implemented scheduler end-to-end for planned tasks with manual run semantics.
- Full e2e phase (`TEST_SCOPE=all`) could not run in this container because Docker Compose is unavailable.
