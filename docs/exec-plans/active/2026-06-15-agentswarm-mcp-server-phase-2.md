# Execution Plan

## Title
- Verft MCP Server Phase 2

## Goal
- Extend the Verft MCP server with checkpoint review operations so MCP clients can discover pending checkpoints, inspect bounded checkpoint detail, apply checkpoints, and reject checkpoints through the same policy and lifecycle paths as the web UI.
- Make MCP-created tasks default to automatic checkpoint apply so agent-driven task workflows continue without requiring a human to manually toggle task config after creation.

## Non-goals
- No push, merge, archive, or delete tools in this phase.
- No interactive terminal control through MCP.
- No prompt attachment upload support.
- No direct workspace filesystem, Redis, Postgres, or provider credential access from MCP clients.
- No broad "execute arbitrary task action" or "run arbitrary server method" tool.
- No full unbounded diff/log/message responses.
- No change to the default web UI task creation behavior unless explicitly required by implementation.
- No applied-checkpoint revert tool in the first Phase 2 slice unless apply/reject/list coverage is complete and risk remains low.

## Current State
- Phase 1 MCP is implemented at `POST /mcp` with personal access token authentication, `initialize`, `tools/list`, `tools/call`, repository discovery, task discovery/detail, draft/create/start/follow-up, and auto-apply config update.
- The Phase 1 plan is completed at `docs/exec-plans/completed/2026-06-12-verft-mcp-server-phase-1.md`.
- The broader MCP draft already identifies Phase 2 checkpoint review operations in `docs/exec-plans/drafts/verft-mcp-server.md`.
- HTTP task routes already support checkpoint list, apply, reject, revert, and file-level revert through `apps/server/src/routes/tasks.ts`.
- Checkpoint mutation behavior lives behind `SpawnerService` methods such as `applyChangeProposal` and `rejectChangeProposal`.
- MCP currently exposes compact recent checkpoints only through `verft_get_task` with `include: ["checkpoints"]`.
- MCP task creation does not currently accept `autoApplyCheckpoints`; tasks therefore default to manual checkpoint review unless updated after creation.

## Acceptance Criteria
- `verft_create_task` accepts `autoApplyCheckpoints?: boolean`.
- MCP-created tasks default `autoApplyCheckpoints` to `true` when the field is omitted.
- MCP callers can explicitly pass `autoApplyCheckpoints: false` to keep manual checkpoint review.
- `verft_update_draft` can update `autoApplyCheckpoints` before a draft starts.
- `verft_list_checkpoints` lists bounded checkpoint summaries for an accessible task, with optional status filtering and limit clamping.
- `verft_get_checkpoint` returns bounded checkpoint metadata and optionally a truncated diff when explicitly requested.
- `verft_apply_checkpoint` applies a specific checkpoint by id with an optional commit message and returns updated compact task/checkpoint state.
- `verft_reject_checkpoint` rejects a specific checkpoint by id and returns updated compact task/checkpoint state.
- MCP checkpoint mutation tools enforce `task:edit`, existing task access rules, archived-task read-only behavior, pending/running mutation safety, and existing checkpoint transition rules.
- MCP checkpoint tools reuse existing server lifecycle logic instead of duplicating apply/reject/recovery behavior.
- Follow-up queue continuation after checkpoint apply/reject behaves the same for MCP and web/API calls.
- Large checkpoint diffs are truncated with explicit `truncated` metadata.
- Existing web/API behavior remains unchanged.
- README and MCP draft docs are updated to describe Phase 2 tools and MCP auto-apply defaults.

## Affected Files
- `apps/server/src/mcp/tools.ts`
- `apps/server/src/mcp/format.ts`
- `apps/server/src/mcp/tools.test.ts`
- `apps/server/src/routes/tasks.ts` if checkpoint transition helpers need extraction for reuse
- `apps/server/src/services/spawner.ts` only if existing apply/reject APIs need small return-shape support
- `packages/shared-types/src/index.ts`
- `apps/web/src/api/client.ts` if shared types/API client need schema alignment
- `README.md`
- `docs/exec-plans/drafts/verft-mcp-server.md`

## Step-by-Step Plan
1. Confirm existing checkpoint lifecycle behavior and identify route-only helpers that MCP must share.
2. Add shared compact checkpoint detail formatting with bounded/truncated diff support.
3. Extend MCP create/update draft schemas to include `autoApplyCheckpoints`, defaulting MCP-created tasks to `true` only when omitted.
4. Implement read tools: `verft_list_checkpoints` and `verft_get_checkpoint`.
5. Implement mutation tools: `verft_apply_checkpoint` and `verft_reject_checkpoint`, reusing existing `SpawnerService` and checkpoint transition behavior.
6. Add focused tests for MCP schema defaults, task access, checkpoint list/detail, apply, reject, archived tasks, missing scopes, and response truncation.
7. Update README and MCP draft docs.
8. Run focused verification, self-review, and final checks.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: Yes
- Uncertainties Logged: Yes
- Human Review Completed: Yes
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
- `node --import tsx --test apps/server/src/mcp/tools.test.ts`
- `node --import tsx --test apps/server/src/lib/task-start-orchestrator.test.ts apps/server/src/services/scheduler.test.ts apps/server/src/services/task-store.test.ts`
- `npm run lint -w @verft/server`
- `npm run lint -w @verft/web`
- `git diff --check`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Duplicating route logic in MCP could create policy drift between web/API and MCP clients.
- Applying or rejecting a checkpoint from MCP is high-impact because it mutates the task workspace and can resume queued work.
- MCP-created tasks defaulting to auto-apply may surprise callers who expected manual review; explicit opt-out and docs need to be clear.
- Returning checkpoint diffs can exceed MCP client context if truncation is incomplete.
- Checkpoint mutation during active runs, active terminal sessions, or recovery states must not weaken existing safety guarantees.
- Reusing HTTP transition helpers may require small refactors around route-local functions.

## Rollback Plan
- Remove Phase 2 tool registrations from `createMcpTools`.
- Revert MCP create/update draft schema changes for `autoApplyCheckpoints`.
- Keep existing Phase 1 MCP behavior intact.
- Leave web/API checkpoint routes unchanged.
- Revert documentation additions for Phase 2 tools.

## Progress Log
- 2026-06-15 08:42 UTC: Created Phase 2 execution plan from the existing MCP draft and current checkpoint implementation.

## Decisions
- 2026-06-15: Treat apply/reject/list/get checkpoint tools as Phase 2.
- 2026-06-15: Default `autoApplyCheckpoints` to `true` for MCP-created tasks only, with explicit opt-out.
- 2026-06-15: Keep applied-checkpoint revert out of the first Phase 2 slice unless apply/reject/list are complete and verified.

## Completion Notes
- TODO
