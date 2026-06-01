# Execution Plan

## Title
- Scheduled Tasks: Start Mode Visibility and macOS Calendar Alignment

## Goal
- Make scheduled task start behavior obvious at a glance and improve scheduler UI familiarity using a macOS Calendar-like visual pattern.

## Non-goals
- Adding automatic task execution at scheduled time.
- Replacing the existing task creation/edit backend flow.

## Current State
- Scheduler supports month/week/day and scheduled task create/edit/run-now.
- Scheduled cards do not show start mode.
- Task objects do not currently expose a stable persisted `startMode` field for scheduler rendering.

## Acceptance Criteria
- Scheduler cards show each scheduled task start mode without opening task details.
- Start mode labels are standardized and reusable.
- Scheduler visuals are cleaner and closer to macOS Calendar pattern while preserving dense readability.
- Start mode is exposed from backend task data as a stable task property.

## Affected Files
- packages/shared-types/src/index.ts
- apps/server/src/services/task-store.ts
- apps/server/src/services/task-store.test.ts
- apps/web/components/scheduler-page.tsx
- apps/web/components/scheduler-task-edit-page.tsx

## Step-by-Step Plan
1. Add task-level start mode property + shared start mode label helper.
2. Persist and normalize task start mode in task store for Redis/Postgres, including fallback for legacy tasks.
3. Update scheduler UI to display start mode in month/week/day entries.
4. Refine scheduler visual styling and selected-task behavior for a macOS-like calendar experience.
5. Run lint/tests for changed packages and fix issues.

## Human-Gated Flow Evidence
- Requirements Read: DONE
- Requirements Understood: DONE
- Repository Research Complete: DONE
- Uncertainties Logged: DONE
- Human Review Completed: TODO
- User Approval To Start: DONE
- Baseline Checks Run: DONE
- Visible Task List Updated: DONE
- Task-Level Tests/Lint/Build: DONE
- Self Review Complete: DONE
- Code Review Complete: TODO
- Final Verification Complete: DONE
- Security/Privacy Review Complete: DONE
- Docs/Changelog Updated: DONE

## Validation Commands
- npm run lint -w @agentswarm/server
- npm run lint -w @agentswarm/web
- npm --workspace @agentswarm/server exec -- node --import tsx --test src/services/task-store.test.ts
- npm --workspace @agentswarm/web test

## Risks
- Over-styling could reduce density/readability if spacing is too large.
- Legacy tasks without a stored start mode need a safe fallback to avoid blank labels.

## Rollback Plan
- Revert scheduler component and task model changes in a single commit if regressions appear.

## Progress Log
- 2026-06-01 13:35 UTC: Created execution plan and scoped backend + frontend implementation.
- 2026-06-01 13:52 UTC: Added task-level `startMode` persistence + normalization fallback in Redis/Postgres stores.
- 2026-06-01 13:58 UTC: Updated scheduler calendar UI to show start modes in month/week/day with selected-task preview and cleaner calendar styling.
- 2026-06-01 14:03 UTC: Completed lint and targeted tests for server/web updates.

## Decisions
- 2026-06-01: Persist `startMode` on task objects and use shared label helpers to keep naming consistent.

## Completion Notes
- Implemented start mode visibility for scheduled tasks in scheduler cards and selected-task preview.
- Added shared start mode labels and persisted start mode on task records for backend reliability.
- Refined scheduler visual hierarchy and spacing toward a macOS Calendar-like look while keeping dense schedules readable.
