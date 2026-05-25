# Execution Plan

## Title
- Remove separate ask-run workspaces

## Goal
- Make every task use exactly one workspace: the task workspace. Ask mode should reuse that workspace and remain read-only through runtime enforcement only.

## Non-goals
- Changing build-task write behavior.
- Reworking merge/push/pull flows beyond the workspace path changes needed for ask mode.
- Redesigning task history outside the workspace-link behavior affected by `.ask-runs`.

## Current State
- Ask runs create and use a separate workspace under `.ask-runs/<taskId>/<runId>`.
- Backend file listing, search, and preview can target either the task workspace or an ask-run workspace via `executionId`.
- The web files tab and file-preview flows expose the separate execution workspace concept.

## Acceptance Criteria
- Ask runs reuse the task workspace and do not create `.ask-runs` workspace folders.
- Ask mode remains read-only by Docker mount/runtime behavior.
- Backend workspace file APIs always resolve to the task workspace.
- UI file links and file browsing no longer present separate ask-run workspace context.
- Cleanup no longer removes `.ask-runs` folders because they are no longer created for task execution.
- Tests reflect one-workspace-per-task behavior.

## Affected Files
- `apps/server/src/services/spawner.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/utils/workspace-file-links.ts`
- `apps/web/src/utils/workspace-file-links.test.ts`
- `apps/web/components/task-files-tab.tsx`
- `apps/web/components/task-detail-page.tsx`
- `apps/server/src/services/spawner.workspace-provisioning.test.ts`

## Step-by-Step Plan
1. Remove ask-workspace pathing and ask-run provisioning from backend runtime flow.
2. Simplify workspace file APIs and frontend link parsing to a single task workspace.
3. Update tests and run focused validation if dependencies are available.

## Validation Commands
- `npm --prefix apps/server test`
- `npm --prefix apps/web test`

## Risks
- Older message/file links that point to `.ask-runs` paths may no longer map to a preserved snapshot.
- If any hidden code path still depends on `executionId`, it may fail after API simplification.

## Rollback Plan
- Restore ask-workspace path resolution and `executionId`-based workspace selection in server and web code.

## Progress Log
- 2026-05-25 04:29 UTC: Created plan after tracing ask-workspace provisioning, API routing, and frontend file-link usage.
- 2026-05-25 04:41 UTC: Removed separate ask-run workspace resolution from backend task execution and workspace file APIs.
- 2026-05-25 04:46 UTC: Simplified web file-link parsing and files tab behavior to always use the task workspace.
- 2026-05-25 04:48 UTC: Updated workspace provisioning tests for ask-mode reuse of the task workspace.
- 2026-05-25 04:49 UTC: Attempted `npm --prefix apps/server test`, but local dev dependencies are missing in this environment (`tsx` not installed), so automated validation could not run.

## Decisions
- 2026-05-25: Treat "prevent writes" as the only ask-mode requirement; preserve read-only mounts but remove separate ask-run workspaces.

## Completion Notes
- Ask runs now reuse the task workspace instead of creating a second workspace under `.ask-runs`.
- Workspace file list/search/preview paths now always resolve against the task workspace.
- Old `.ask-runs/...` links are still parsed, but they now open the current task workspace path rather than a per-run snapshot.
- Automated validation still needs to run in an environment with installed Node dependencies.
