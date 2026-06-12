# Execution Plan Draft

## Title
- AgentSwarm MCP Server

## Goal
- Add an MCP server that lets external agents inspect and operate AgentSwarm tasks through a controlled, typed tool surface.
- Enable workflows such as:
- "List my recent tasks."
- "Find the repository I want to use."
- "Create a draft task for this feature."
- "Start this draft."
- "Continue task X with these instructions."
- "Turn auto-apply on for task X."

## Vision
- Agents should be able to use AgentSwarm as their task execution backend without scraping the UI or calling undocumented internals.
- The MCP server should expose the same task lifecycle concepts that humans use in the web app: drafts, queued/running work, messages, runs, checkpoints, auto-apply, and review actions.
- The tool surface should be safe by default: read tools first, write tools scoped by auth, destructive actions explicit, and no direct database/store access from MCP clients.

## Non-goals
- No replacement for the existing web UI.
- No direct access to Redis, Postgres, workspace filesystem internals, or raw provider credentials.
- No broad "execute arbitrary server method" tool.
- No public unauthenticated MCP endpoint.
- No multi-tenant access bypass; MCP callers must see only what their AgentSwarm identity can access.
- No streaming terminal control in the first phase.
- No checkpoint apply/reject/revert tools in the first phase.
- No push/merge/archive tools in the first phase.
- No prompt attachment upload support in the first phase.
- No server-side summarization tool in the first phase; MCP clients should summarize from structured task data.
- No repository import/settings/admin/user-management tools in the first phase beyond personal access token management and repository discovery.

## Current State
- The backend exposes task lifecycle operations through `apps/server/src/routes/tasks.ts`.
- Task storage and lifecycle state live behind `TaskStore`, `SchedulerService`, and `SpawnerService`.
- Existing HTTP routes already implement auth scopes, repository access checks, archived-task guards, mutation blockers, queue semantics, checkpoint apply/reject/revert, config changes, and attachment persistence.
- Shared task contracts live in `packages/shared-types/src/index.ts`.
- There is no MCP entrypoint, MCP auth model, MCP tool registry, or typed MCP response shaping.
- There is no personal access token model for non-browser API/MCP authentication.
- Existing examples from the rough draft are task-centric and map well to current routes:
- List/recent/pinned/latest tasks.
- Discover repositories.
- Create draft or active task.
- Start draft.
- Continue work on a task.
- Change AI settings.
- Toggle auto-apply.
- Inspect checkpoints in later phases.

## Product Scope
- Phase 1 should support personal access token auth, repository discovery, task discovery, draft creation, task start, follow-up messages, and auto-apply configuration.
- Phase 2 should add checkpoint review operations: list checkpoints, inspect checkpoint/diff, apply checkpoint, reject checkpoint, and possibly file-level revert.
- Phase 3 can add push/merge, richer repository/settings helpers, prompt attachments, terminal/session support, and optional deterministic summaries if proven useful.

## Phase 1 Tool Surface
- `agentswarm_list_repositories`
- Inputs: `query?: string`, `limit?: number`
- Output: compact repository list with `id`, `name`, `url`, `defaultBranch`, and access metadata safe for the caller.
- Notes: required because task creation needs `repoId`.

- `agentswarm_list_tasks`
- Inputs: `view?: "all" | "active" | "archived"`, `limit?: number`, `pinnedOnly?: boolean`, `query?: string`
- Output: compact task list with `id`, `title`, `repoName`, `status`, `workflowStatus`, `executionStatus`, `taskType`, `pinned`, `hasPendingCheckpoint`, `autoApplyCheckpoints`, `updatedAt`.

- `agentswarm_get_task`
- Inputs: `taskId: string`, `include?: ["messages", "runs", "checkpoints", "logs"]`
- Output: task detail plus requested related records, with large fields summarized/truncated by default.

- `agentswarm_create_task`
- Inputs: task creation fields aligned with existing `createTaskSchema`: `title`, `repoId`, `prompt`, `draft`, `taskType`, provider config, branch config, notes, deadline.
- Output: created task.
- Notes: uses existing task creation/orchestration logic. Draft creation is first-class. For Phase 1, prefer `draft: true` by default unless the caller explicitly asks to start immediately.

- `agentswarm_update_draft`
- Inputs: fields aligned with existing draft update route: title, prompt, notes, task type, provider config, base branch, branch strategy, deadline.
- Output: updated task.
- Notes: only valid for draft tasks.

- `agentswarm_start_task`
- Inputs: `taskId`, `action?: "build" | "ask"`.
- Output: updated queued/running task or a structured blocker.
- Notes: starts drafts or open tasks using existing scheduler/start semantics.

- `agentswarm_add_task_message`
- Inputs: `taskId`, `content`, `action?: "build" | "ask" | "comment"`.
- Output: updated task and created message id.
- Notes: non-comment actions queue/trigger follow-up work exactly like the web chat.

- `agentswarm_update_task_config`
- Inputs: `taskId`, `autoApplyCheckpoints`.
- Output: updated task.
- Notes: Phase 1 only exposes auto-apply toggling. Broader provider/model/branch configuration can be added later after MCP write behavior is proven safe.

## Deferred Tool Surface
- `agentswarm_list_checkpoints`
- Inputs: `taskId`, `limit?: number`.
- Output: checkpoint summaries with `id`, `status`, `sourceType`, `createdAt`, `resolvedAt`, `changedFiles`, `diffStat`, `diffTruncated`.
- Phase: 2.

- `agentswarm_get_checkpoint`
- Inputs: `taskId`, `checkpointId`, `includeDiff?: boolean`.
- Output: checkpoint metadata and optionally truncated diff.
- Phase: 2.

- `agentswarm_apply_checkpoint`
- Inputs: `taskId`, `checkpointId`, `commitMessage?: string`.
- Output: updated task/checkpoint transition result.
- Phase: 2. Treat as high-impact and require explicit checkpoint id.

- `agentswarm_reject_checkpoint`
- Inputs: `taskId`, `checkpointId`.
- Output: updated task/checkpoint transition result.
- Phase: 2. Treat as high-impact and require explicit checkpoint id.

- `agentswarm_update_task_runtime_config`
- Inputs: provider/model/credential/branch strategy fields.
- Output: updated task.
- Phase: 2 or 3.

- `agentswarm_push_task_branch`
- Inputs: `taskId`, `commitMessage?: string`.
- Output: push result.
- Phase: 3.

- `agentswarm_merge_task_branch`
- Inputs: `taskId`, target branch, merge options.
- Output: merge result.
- Phase: 3.

## Architecture Approach
- Add an MCP module under `apps/server/src/mcp/`.
- Keep MCP tool handlers thin and call existing application services or route-equivalent service functions.
- Do not duplicate task mutation rules. Extract reusable task action functions from `routes/tasks.ts` if necessary so HTTP and MCP share the same policy.
- Register the MCP endpoint from `apps/server/src/index.ts` after stores/services/auth are created.
- Prefer a streamable HTTP MCP endpoint for remote clients. If local stdio support is useful, add it as a separate CLI entrypoint later.
- Shape MCP outputs for agent consumption rather than returning full raw task records by default.
- Add truncation for logs, diffs, messages, and result markdown. Provide explicit include flags for heavier data.
- Add personal access token storage and authentication before enabling write tools.
- Keep repository discovery read-only and scoped to the authenticated user.

## Auth and Access Model
- MCP must use the existing AgentSwarm auth identity and scope system.
- Phase 1 should add personal access tokens for users.
- MCP clients authenticate with `Authorization: Bearer <personal_access_token>`.
- Tokens are stored hashed at rest, never retrievable after creation, and can be revoked.
- Token creation/revocation should be exposed through the web UI or existing user/settings area, not through the MCP server itself in Phase 1.
- Token metadata should include id, name, owner user id, created time, last-used time, optional expiration, and revoked time.
- Token scopes should map to existing auth scopes. The first version can create all allowed user scopes by default for trusted local usage, but the data model should allow narrower scopes.
- Every tool must declare and enforce required scopes:
- Repository discovery: `repo:list`.
- Read tools: `task:list` or `task:read`.
- Create tools: `task:create` plus repository access.
- Mutating task tools: `task:edit`.
- Auto-apply config toggle: `task:edit`.
- Checkpoint apply/reject tools in Phase 2: `task:edit`.
- Non-admin users must remain scoped to accessible tasks/repositories.
- Tool errors should return structured blockers, not raw stack traces.

## Response Limits
- Default task list limit: 20; maximum: 100.
- Default repository list limit: 20; maximum: 100.
- Default messages returned by `agentswarm_get_task`: latest 20; maximum: 100.
- Default runs returned by `agentswarm_get_task`: latest 10; maximum: 50.
- Default checkpoints returned by `agentswarm_get_task`: latest 10; maximum: 50.
- Logs are omitted by default. If requested, return latest 100 lines maximum.
- Result markdown, notes, diffs, and message content should be truncated with explicit `truncated: true` metadata when over the configured character limit.
- Full checkpoint diffs are deferred to Phase 2 and must require explicit include flags.

## Acceptance Criteria
- An authenticated MCP client can list accessible tasks.
- An authenticated MCP client can list accessible repositories for task creation.
- An authenticated MCP client can fetch task detail with optional messages/runs/checkpoints.
- An authenticated MCP client can create a draft task.
- An authenticated MCP client can start a draft task.
- An authenticated MCP client can add a build/ask follow-up to an existing task and receive the same queue behavior as the web UI.
- An authenticated MCP client can toggle `autoApplyCheckpoints`.
- MCP authentication uses personal access tokens stored hashed at rest and mapped to a user identity.
- Personal access tokens can be created and revoked by users through non-MCP application flows.
- Unauthorized or insufficient-scope MCP calls fail with clear structured errors.
- Large responses are bounded and do not dump full logs/diffs unless explicitly requested.
- Existing web/API behavior remains unchanged.

## Affected Files
- `apps/server/src/index.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/lib/auth.ts`
- `apps/server/src/routes/auth.ts` or user/settings routes for personal access token management
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/services/user-store.ts` or a new token store
- `apps/server/src/services/create-postgres-stores.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/scheduler.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/mcp/*`
- `packages/shared-types/src/index.ts`
- `apps/web/components/settings-page.tsx` or user settings UI for token management
- `apps/server/package.json`
- Server tests for MCP tools/auth/policy.
- Docs: `README.md`, `docs/development/commands.md`, and this execution plan if promoted to active.

## Step-by-Step Plan
1. Confirm protocol and runtime shape.
- Choose HTTP MCP transport for the first implementation.
- Decide endpoint path, for example `/mcp`.
- Decide whether MCP is always enabled or gated by `MCP_SERVER_ENABLED`.

2. Add personal access tokens.
- Add Postgres table/migration for user personal access tokens.
- Store only token hashes.
- Add token create/list/revoke APIs.
- Add minimal UI for creating and revoking tokens.
- Extend `AuthService` to authenticate bearer tokens and return the same user/scope shape used by HTTP routes.
- Add audit-friendly last-used timestamp updates.

3. Extract reusable task application actions.
- Identify task route logic that should be shared by HTTP and MCP.
- Extract helpers for list/get/create/update draft/start/add message/update config/checkpoint operations.
- Preserve existing route responses and behavior.

4. Build MCP server skeleton.
- Add MCP server package dependency.
- Add `apps/server/src/mcp/server.ts` for server construction and tool registration.
- Add `apps/server/src/mcp/context.ts` for authenticated request context and dependency injection.
- Add `apps/server/src/mcp/errors.ts` for structured tool errors.
- Register the endpoint in `index.ts`.

5. Implement Phase 1 read-only tools.
- `agentswarm_list_repositories`
- `agentswarm_list_tasks`
- `agentswarm_get_task`
- Add truncation helpers and compact response mappers.

6. Implement Phase 1 write tools.
- `agentswarm_create_task`
- `agentswarm_update_draft`
- `agentswarm_start_task`
- `agentswarm_add_task_message`
- `agentswarm_update_task_config`
- Ensure blockers are returned for archived tasks, active terminal sessions, active runs, and pending checkpoints where applicable.
- Restrict `agentswarm_update_task_config` to `autoApplyCheckpoints` in Phase 1.

7. Defer checkpoint mutation tools to Phase 2.
- Keep checkpoint apply/reject/revert out of Phase 1 implementation.
- Use Phase 1 task detail output to expose checkpoint status only as read context.

8. Add tests.
- Unit-test tool input schemas and output truncation.
- Integration-test MCP auth failures.
- Integration-test personal access token create/list/revoke and bearer auth.
- Integration-test repository discovery access control.
- Integration-test task read/write happy paths using test stores.
- Regression-test that MCP and HTTP share mutation blockers and queue semantics.

9. Add documentation.
- Document enabling MCP, personal access token setup, endpoint URL, and example client configuration.
- Document the tool list and response-size defaults.
- Add troubleshooting notes for common auth/scope errors.

## Open Decisions
- Should personal access tokens support user-selected scopes in the first UI, or start with all scopes available to that user?
- What default token expiration should we use: none, 30 days, 90 days, or configurable?
- Should MCP be enabled by default in local development?
- Should immediate task creation default to draft mode unless the tool input explicitly says `draft: false`?
- Should Phase 1 expose read-only checkpoint summaries through `agentswarm_get_task`, or omit checkpoints entirely until Phase 2?
- Which MCP SDK/package should be used and does it support the desired HTTP transport cleanly?

## Validation Commands
- `node --import tsx --test apps/server/src/mcp/*.test.ts`
- `node --import tsx --test apps/server/src/lib/auth.test.ts`
- `node --import tsx --test apps/server/src/routes/auth.test.ts`
- `node --import tsx --test apps/server/src/routes/repositories.test.ts`
- `node --import tsx --test apps/server/src/routes/tasks.test.ts`
- `node --import tsx --test apps/server/src/services/task-store.test.ts`
- `node --import tsx --test apps/server/src/services/scheduler.test.ts`
- `npm run lint -w @agentswarm/server`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Duplicating route logic in MCP could create policy drift between web/API and MCP clients.
- Overly broad MCP tools could let agents perform destructive actions too easily.
- Large diffs/logs/messages can exceed MCP client context limits unless responses are bounded.
- Personal access token design can accidentally bypass existing task ownership and repository access checks if it does not reuse `AuthService` and route-equivalent policy.
- Personal access tokens are long-lived credentials; hashes, revocation, last-used metadata, and UI disclosure matter.
- Long-running actions may confuse MCP clients if tool responses do not clearly distinguish queued, running, blocked, and completed states.

## Rollback Plan
- Disable MCP endpoint with an environment flag.
- Remove MCP route registration from `apps/server/src/index.ts`.
- Disable personal access token authentication path while keeping the token table for audit/revocation cleanup.
- Keep extracted task helper functions if they are useful for HTTP route maintainability.
- Revert package dependency and MCP-specific files if the feature is abandoned.

## Draft Status
- Requirements captured from initial user examples.
- Repository research completed at a high level.
- Open decisions remain before promotion to `docs/exec-plans/active/`.
- Phase 1 narrowed to personal access token auth, repository discovery, task discovery, draft/start/follow-up, and auto-apply toggling.
- Checkpoint mutations, push/merge, attachments, terminal support, and summarization are deferred.
- Next step: decide token expiration/scope UI and MCP transport package, then promote to an active execution plan.
