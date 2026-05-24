# Execution Plan

## Title
- Replace worktree-based task setup with per-task clone workspaces

## Goal
- Provision every task workspace and ask-run workspace from a dedicated clone, with rollback-controlled rollout and clear operational telemetry/errors.

## Non-goals
- Rewriting unrelated git merge/push logic that already works.
- Changing user-visible branch strategy behavior.
- Removing existing repo cache fetch strategy.

## Current State
- Workspace prep in `SpawnerService` still uses `git worktree add` for build and ask paths.
- Workspace metadata may report `worktree` depending on `.git` layout.
- No explicit workspace-provisioning mode switch in system settings.
- Workspace setup failures are surfaced as generic errors.

## Acceptance Criteria
- Task workspace prepare and ask-run prepare use dedicated clone workspaces.
- Branch behavior remains the same for `work_on_branch` and generated feature branches.
- Workspace metadata is standardized to clone values (`workspace_kind: clone`) including manual postflight context.
- Backend rollout control exists via `workspace_provisioning_mode` (`clone_only`/`hybrid`).
- Ask-run history/file-link behavior remains intact after completion.
- Clone strategy defined in code: fetch depth, base ref selection, fallback when branch ref missing.
- Actionable failure reasons for clone/auth/network/branch errors.
- Analytics events emitted for started/succeeded/failed with workspace kind/task type/failure reason.
- Automated tests cover clone-mode prepare/cleanup/checkout/ask-run/postflight paths.

## Affected Files
- `apps/server/src/services/spawner.ts`
- `apps/server/src/services/settings-store.ts`
- `apps/server/src/routes/settings.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/db/backfill-redis-to-postgres.ts`
- `packages/shared-types/src/index.ts`
- `apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `apps/server/package.json`

## Step-by-Step Plan
1. Add settings/type support for workspace provisioning mode.
2. Implement clone-first provisioning helpers and route both prepare flows through them.
3. Add workspace-prepare analytics and failure classification.
4. Standardize workspace metadata kind and manual postflight values.
5. Update/add automated tests and run validation commands.
6. Move this plan file to `docs/exec-plans/completed/` when done.

## Validation Commands
- `npm --prefix apps/server run lint`
- `npm --prefix apps/server test`
- `npm --prefix apps/web run lint`
- `npm --prefix apps/web test`
- `REMOTE_BUILD=0 ./scripts/harness/doctor.sh` (failed: `docker` missing in environment)

## Risks
- Hybrid fallback still relies on legacy worktree methods; this should be temporary and can hide clone regressions if overused.
- Full-history fetch strategy is safer but may be slower on very large repos.

## Rollback Plan
- Set `workspace_provisioning_mode` to `hybrid` to allow compatibility fallback while diagnosing clone issues.
- Revert spawner clone-only changes if regressions are confirmed.

## Progress Log
- 2026-05-24 07:45 UTC: Created plan and scoped affected server/shared files.
- 2026-05-24 07:56 UTC: Added `workspaceProvisioningMode` to shared types, settings routes, settings persistence, migrations, and Redis->Postgres backfill.
- 2026-05-24 08:11 UTC: Reworked workspace/ask workspace prep to clone model; added clone strategy helpers, actionable setup failure messages, and analytics event emission.
- 2026-05-24 08:18 UTC: Added clone-mode spawner tests (prepare, hybrid fallback, ask clone, cleanup, manual postflight metadata) and wired them into server test script.
- 2026-05-24 08:22 UTC: Ran server/web lint and tests successfully.

## Decisions
- 2026-05-24: Keep managed repo cache fetch strategy; only replace workspace materialization method.
- 2026-05-24: Implement rollout as settings-driven (`workspaceProvisioningMode`) with clone default and optional hybrid fallback.
- 2026-05-24: Keep clone fetch depth unlimited for correctness and predictable branch/diff behavior.

## Completion Notes
- Completed all issue requirements within server/shared scope, including rollout control, clone-mode workspace prep, failure classification, analytics events, and tests.
- Harness scripts could not fully run in this environment because Docker is unavailable.
