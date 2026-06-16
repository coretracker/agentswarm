# Execution Plan Draft

## Title
- Multi-Repository Task Workspaces

## Goal
- Allow a task to access additional repositories alongside its root repository so agents can inspect, compare, migrate, or reference code across repos during a single task.
- Keep the root repository as the task's primary workspace for task ownership, branching, checkpointing, review, and follow-up continuity.
- Start with a conservative v1: one writable root repository plus read-only attached repositories.

## Problem
- Some tasks require context from more than one repository even though only one repository owns the requested change.
- Example: migrating React components from a web repository into SwiftUI components in an iOS repository. The iOS repository is the root and receives the changes, but the agent needs read access to the React repository as source material.
- Today a task is scoped to one repository, so users must manually copy context, create separate tasks, or make the root workspace contain code it should not own.

## Non-goals
- No multi-repository commits or pull requests in v1.
- No writable auxiliary repositories in v1.
- No cross-repository checkpoint apply/reject behavior in v1.
- No automatic repository relationship inference.
- No automatic sharing of repository secrets, environment variables, or MCP servers from attached repositories.
- No change to single-repository task behavior when no additional repositories are attached.
- No repository mirroring, vendoring, or dependency synchronization feature.

## Current State
- Tasks are created against one repository.
- Task workspaces, branch handling, checkpoint review, and task detail surfaces assume a single root repository.
- Repository configuration owns runtime environment variables, secrets, and potentially repository-scoped integrations.
- Follow-up work continues from the same task context and workspace assumptions.
- There is no first-class way to attach another registered repository as read-only context for a task.

## Proposed Model
- Add a task workspace model with:
- `rootRepositoryId`: the existing repository that owns the task.
- `attachedRepositories`: optional read-only repository mounts available to the task runtime.
- Each attached repository has:
- `repositoryId`
- `mountName`
- `accessMode`, initially only `read-only`
- optional `purpose` label such as `source`, `reference`, `target-context`, or `design-system`
- optional pinned branch/ref behavior if the repository checkout logic already supports it safely.

## Runtime Layout
- Keep the root repository at the existing task workspace path or expose it through a stable alias.
- Mount attached repositories under a predictable directory, for example:
- `/workspace/root`
- `/workspace/repos/react-source`
- `/workspace/repos/design-system`
- Expose stable environment variables:
- `TASK_ROOT=/workspace/root`
- `TASK_REPOS_DIR=/workspace/repos`
- `TASK_REPO_<MOUNT_NAME>=/workspace/repos/<mount-name>` where practical.
- Add an automatically generated workspace map to the task prompt/session context so agents know which repositories are available and which paths are read-only.

## Post-Creation Updates
- Allow attached repositories to be added after task creation when no task run or interactive terminal session is active.
- For draft/not-started tasks, allow adding, removing, and editing attached repositories freely.
- For paused, waiting, or completed tasks, allow adding new read-only attached repositories for follow-up work.
- Do not allow workspace attachment changes while a task run is active.
- Do not remove or rename existing mounts after a task has run, unless a later design includes safe history and transcript handling.
- Record workspace changes as task history events/messages so follow-up context explains when a repository became available.

## Access and Policy
- A user must have access to the root repository and each attached repository.
- Attached repositories are read-only in v1 at the filesystem and task API levels.
- Checkpoints include changes from the root repository only.
- Branch creation, commits, checkpoint apply/reject, and PR flows remain scoped to the root repository.
- Root repository configuration remains the runtime source for task secrets, env vars, provider settings, and MCP servers unless a separate repository-scoped integration design explicitly changes that.
- Attached repository paths and mount names must be validated to avoid path traversal, collisions, reserved names, and ambiguous aliases.

## Acceptance Criteria
- Users can attach one or more registered repositories to a task as read-only context.
- Users can choose a stable mount name for each attached repository.
- Task creation supports optional attached repositories.
- Task detail shows the root repository and attached repository workspace map.
- Draft/not-started tasks can add, remove, or edit attached repositories.
- Paused, waiting, or completed tasks can add new read-only attached repositories for follow-up work.
- Running tasks and active interactive terminal sessions reject workspace attachment changes.
- Existing mounts cannot be renamed or removed after a task has run.
- Task runtime workspaces include attached repositories at predictable read-only paths.
- Agents receive a workspace map that identifies root and attached repositories.
- Checkpoints and review flows remain scoped to the root repository.
- Follow-up tasks/runs retain the same attached repository configuration.
- Existing single-repository task behavior is unchanged.
- Server and web tests cover task creation, task updates, authorization, runtime workspace layout, read-only enforcement, and UI rendering.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/routes/tasks.ts`
- `apps/server/src/services/task-store.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/lib/task-start-orchestrator.ts`
- `apps/server/src/lib/workspace-provisioning.ts` or equivalent workspace setup helpers if present
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/server/src/mcp/tools.ts` if MCP task create/detail should expose attached repositories
- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useTask.ts`
- `apps/web/components/task-create-page.tsx` or task creation components
- `apps/web/components/task-detail-page.tsx`
- `apps/web/components/repositories-page.tsx` if repository picker helpers are reused
- `README.md`
- `docs/product/user-flows.md`
- `docs/development/testing.md` if workspace test expectations change

## Step-by-Step Plan
1. Confirm existing workspace provisioning and task persistence boundaries.
- Identify where task repository checkout, branch setup, checkpoint scope, and interactive terminal workspace mounting are implemented.
- Confirm how task creation and follow-up currently preserve repository context.

2. Define shared task workspace contracts.
- Add attached repository types to shared task create/update/detail contracts.
- Validate mount names and enforce read-only-only access mode for v1.
- Preserve backward compatibility for tasks without attached repositories.

3. Persist attached repository configuration.
- Store attached repository metadata with the task.
- Ensure task listing/detail APIs return the workspace map.
- Add authorization checks for all referenced repositories.

4. Update task creation and task update APIs.
- Allow attached repositories during task creation.
- Add a controlled update path for adding read-only repositories after creation.
- Reject updates while a run or interactive terminal is active.
- Reject removal/rename after the task has run.

5. Update runtime workspace provisioning.
- Checkout or mount attached repositories under stable read-only paths.
- Enforce filesystem read-only behavior for attached repositories.
- Add workspace map environment variables and prompt/session context.
- Ensure checkpoint detection ignores attached repositories.

6. Update web UI.
- Add an "Additional repositories" section to task creation.
- Add a repository picker, mount name field, and read-only access indicator.
- Show root and attached repositories on task detail.
- Allow adding read-only repositories for eligible paused/waiting/completed tasks.

7. Update MCP/API surfaces where appropriate.
- Include attached repository configuration in task detail.
- Consider adding attached repository support to MCP task creation and draft update.
- Keep mutation rules aligned across web/API/MCP.

8. Add tests.
- Server tests for validation, authorization, persistence, update state rules, and checkpoint scope.
- Runtime tests for workspace layout and read-only attached repo enforcement.
- Web tests or focused component coverage for create/update/detail rendering.
- MCP tests if MCP surfaces are changed.

9. Update docs.
- Document multi-repository task workspaces.
- Explain that v1 supports one writable root and read-only attached repositories.
- Document when attached repositories can be added after task creation.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: TODO
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
- `node --import tsx --test apps/server/src/services/task-store.test.ts`
- `node --import tsx --test apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `node --import tsx --test apps/server/src/lib/task-start-orchestrator.test.ts`
- `node --import tsx --test apps/server/src/mcp/tools.test.ts`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Writable behavior can accidentally leak into attached repositories if filesystem permissions are not enforced.
- Checkpoint detection may include attached repository changes unless root boundaries are explicit.
- Mount name changes can break prior prompts, terminal transcripts, and follow-up context.
- Large attached repositories can slow task startup and consume workspace storage.
- Repository-scoped secrets and MCP servers can become confusing if users expect attached repositories to bring their own runtime configuration.
- Multi-repo access expands the security surface because a task can read code from more repositories than the root.

## Open Questions
- Should attached repositories be per-task only, or should repositories define reusable relationships/templates?
- Should users be able to pin an attached repository to a branch, tag, or commit in v1?
- How many attached repositories should a task allow by default?
- Should attached repositories be visible in all task history and audit views?
- Should MCP task creation support attached repositories in the first implementation slice?
- Should interactive terminals be allowed after attaching new read-only repositories to completed tasks?

## Rollback Plan
- Remove attached repository fields from task create/update/detail contracts.
- Disable runtime mounting of attached repositories.
- Hide additional repository UI controls.
- Keep existing single-repository task behavior unchanged.
- Leave any persisted attached repository metadata ignored until a cleanup migration is chosen.

## Progress Log
- 2026-06-16 00:00 UTC: Created draft from multi-repository task workspace discussion.

## Decisions
- 2026-06-16: Treat the root repository as the only writable/checkpointed repository in v1.
- 2026-06-16: Allow read-only repositories to be attached after task creation only when no run or interactive terminal session is active.
- 2026-06-16: Defer writable auxiliary repositories, multi-repo commits, and multi-repo PR flows.

## Completion Notes
- Draft only.
