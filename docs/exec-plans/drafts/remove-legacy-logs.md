# Execution Plan Draft

## Title
- Remove Legacy Task Log Output

## Goal
- Remove the legacy task-level log output stream from Verft.
- Stop exposing task/run `logs` arrays and `task:log` realtime events as a user-facing history surface.
- Keep the newer structured execution history surfaces: task messages, task runs, run timelines, checkpoint records, git operations, terminal transcripts, and server operational logs.

## Clarification
- "Legacy logs" means the stored task/run log lines produced through `TaskStore.appendLog`, `appendLogForRun`, `task.logs`, `TaskRun.logs`, `task:log`, `task_logs`, and `task_run_logs`.
- This does not mean removing server process logs, harness logs, runtime raw JSON event files, terminal transcripts, or structured run timeline events.
- The problem is duplicated low-level log output in the product UI/API. It creates noisy history, duplicates timeline data, and makes users inspect implementation details instead of task outcomes.

## Current State
- Shared types expose `Task.logs` and `TaskRun.logs`.
- Realtime includes `TaskLogEvent` with type `task:log`.
- `TaskStore.appendLog` and `appendLogForRun` persist log lines to Redis/Postgres task log stores and publish `task:log`.
- Postgres has `task_logs` and `task_run_logs`; Redis has `verft:task_logs:*` and `verft:task_run_logs:*`.
- `useTask` listens for `task:log` and appends lines to `task.logs`.
- `useTaskRuns` listens for `task:log` and appends run-scoped lines to `run.logs`.
- Several UI updates preserve old `logs` arrays when merging refreshed tasks/runs.
- MCP `verft_get_task` can include `logs`.
- Backfill code migrates Redis task/run logs into Postgres.
- Newer run history already has structured events through normalized agent timelines and terminal transcript loading.

## Acceptance Criteria
- `Task.logs` and `TaskRun.logs` are removed from shared public contracts.
- `TaskLogEvent` and `task:log` realtime handling are removed.
- User-facing web code no longer subscribes to or preserves legacy logs.
- MCP task detail no longer supports `include: ["logs"]`.
- New task/run records no longer write to `task_logs` or `task_run_logs`.
- Legacy `appendLog` call sites are either removed, converted to structured task messages/run summaries/events, or kept only as server process logging where appropriate.
- Existing database log tables are ignored by application code and may be dropped in a later migration after one release cycle.
- Task deletion still cleans up any legacy log rows opportunistically until tables are dropped.
- Runtime raw event parsing, timeline display, terminal transcripts, and server/harness logs remain intact.
- Tests verify that task/run DTOs no longer include logs and that socket clients do not handle `task:log`.

## Non-goals
- No removal of operational server logs or `./scripts/harness/logs.sh`.
- No removal of terminal transcript storage or display.
- No removal of raw provider event files used to build run timelines.
- No removal of task messages, run records, checkpoint history, or git operation history.
- No immediate destructive deletion of historical log database rows unless a migration decision is made separately.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/scheduler.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/lib/task-start-orchestrator.ts`
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/mcp/tools.ts`
- `apps/server/src/db/migrations.ts`
- `apps/web/src/hooks/useTask.ts`
- `apps/web/src/hooks/useTaskRuns.ts`
- `apps/web/components/task-detail-page.tsx`
- `apps/web/components/app-sidebar.tsx`
- `apps/web/components/tasks-page.tsx`
- `apps/web/components/tasks-kanban-board-page.tsx`
- Server/web tests that construct `Task` or `TaskRun` fixtures with `logs: []`.
- Docs that describe task history or log output.

## Step-by-Step Plan
1. Inventory legacy log usages.
- Categorize every `appendLog` and `appendLogForRun` call as user-facing status, runtime stdout/stderr, warning/recovery event, or debug-only line.
- Decide replacement per category:
- User-facing status becomes task message, run summary, checkpoint/git operation status, or structured timeline event.
- Runtime stdout/stderr stays in raw provider event/timeline storage if available, otherwise is omitted from product UI.
- Debug-only lines move to server logger where useful.

2. Remove public log fields and events.
- Remove `logs` from `Task` and `TaskRun` shared types.
- Remove `TaskLogEvent` from `RealtimeEvent`.
- Update task/run fixture builders in tests.
- Update API formatters and compact task shapes that still include `logs`.

3. Stop websocket log handling in the web app.
- Remove `TaskLogPayload` and `task:log` listeners from `useTask`.
- Remove `TaskLogPayload` and `task:log` listeners from `useTaskRuns`.
- Remove merge logic that preserves `logs` arrays across task/run updates.
- Remove any UI labels or panels that show legacy run logs.

4. Replace or remove write call sites.
- Remove log writes for scheduler queue bookkeeping where the state is already represented by task execution state or queue messages.
- Convert checkpoint/git-operation status log lines to structured messages or existing operation/proposal status where needed.
- Remove runtime stdout/stderr writes to `appendLogForRun`; rely on normalized provider event timeline and raw transcript artifacts.
- Keep failure messages in run `errorMessage`, task `errorMessage`, assistant messages, or checkpoint proposal state.

5. Simplify task-store persistence.
- Remove runtime reads/writes/trimming of task logs and run logs.
- Keep cleanup of existing legacy rows during task deletion until database tables are dropped.
- Stop Redis-to-Postgres backfill from copying task/run logs.
- Decide whether to leave old tables unused or add a migration to drop them.

6. Update MCP surface.
- Remove `"logs"` from `verft_get_task.include`.
- Remove response shaping for task logs.
- Update tests and README/MCP docs accordingly.

7. Update tests.
- Server: task-store create/list/get/update tests assert no `logs` field.
- Server: scheduler/spawner tests use replacement status assertions instead of captured appendLog arrays.
- Web: hooks no longer subscribe to `task:log`.
- Web: task history tests continue to cover messages/runs/timelines without legacy logs.

8. Verification.
- Run focused shared/server/web tests.
- Run server and web TypeScript lint.
- Run harness checks if the environment supports them.

## Human-Gated Flow Evidence
- Requirements Read: TODO
- Requirements Understood: TODO
- Repository Research Complete: TODO
- Uncertainties Logged: TODO
- Human Review Completed: TODO
- User Approval To Start: TODO
- Baseline Checks Run: TODO
- Visible Task List Updated: TODO
- Task-Level Tests/Lint/Build: TODO
- Self Review Complete: TODO
- Code Review Complete: TODO
- Final Verification Complete: TODO
- Security/Privacy Review Complete: TODO
- Docs/Changelog Updated: TODO

## Validation Commands
- `node --import tsx --test apps/server/src/services/task-store.test.ts`
- `node --import tsx --test apps/server/src/services/scheduler.test.ts`
- `node --import tsx --test apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `node --import tsx --test apps/server/src/mcp/tools.test.ts`
- `npm test --workspace apps/web -- src/utils/task-history.test.ts`
- `npm run lint -w @verft/server`
- `npm run lint -w @verft/web`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Some failure details currently exist only as legacy log lines; removing them without replacement could make debugging harder.
- Runtime stdout/stderr may disappear from user-facing history unless normalized timelines cover the same information.
- Removing shared `logs` fields touches many fixtures and merge paths.
- Dropping database tables immediately could remove useful forensic data before replacements are proven sufficient.

## Rollback Plan
- Restore `Task.logs`, `TaskRun.logs`, `TaskLogEvent`, and `task:log` websocket handling.
- Restore task-store log persistence and append call sites.
- Keep any replacement structured events/messages; they can coexist temporarily with legacy logs if rollback is needed.

## Open Questions
- Should old `task_logs` and `task_run_logs` tables be dropped immediately, or left unused for one release?
- Which current `appendLog` lines must become task messages because users still need to see them?
- Do we need a dedicated structured "run diagnostics" artifact for stdout/stderr that is separate from the task history UI?
- Should MCP expose any bounded diagnostic artifact after `include: ["logs"]` is removed?

## Completion Notes
- Draft only.
