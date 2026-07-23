# Persistent Task Homes

## Goal
- Give every task a persistent `/task-homes/<task-id>` mounted at `/home/agent` for autonomous and interactive agent containers, with safe legacy migration, provider-session reset, rebuild, deletion, tests, and documentation.

## Non-goals
- Migrating unrelated `.task-state` data.
- Rebuilding task homes during ordinary runs, restarts, workspace rebuilds, or provider session resets.
- Changing repository workspace lifecycle or provider authentication semantics.

## Current State
- Provider state is stored under `/task-workspaces/.task-state/<task-id>/agent-home`.
- Runtime containers stage host provider state and copy it into each container instead of mounting a persistent full home.
- “New Session” removes provider resumable-session metadata.
- Permanent task deletion cleans workspace artifacts but there is no independent task-home lifecycle or rebuild action.

## Acceptance Criteria
- Valid task IDs resolve to matching server and Docker-source paths under configured task-home roots.
- A task home is created once, initially seeded with configured `.codex`, `.claude`, and `.claude.json` host state, with correct ownership and restrictive permissions.
- Existing `.task-state/<task-id>/agent-home` wins over fresh provisioning and migrates safely.
- Autonomous and interactive containers mount the same task home read/write at `/home/agent`; normal runs do not recopy provider state.
- “New Session” removes only the selected task provider’s resumable-session metadata and preserves the task home.
- Rebuild creates and seeds a replacement before an atomic swap, is blocked for active tasks/terminals, and preserves the old home on failure.
- The UI exposes a destructive-confirmed “Rebuild task home” action and reports success/failure.
- Permanent deletion removes the task home; other lifecycle operations retain it.
- Automated tests cover path validation, provisioning/reuse, migration, session reset, mounts, rebuild safety/blocking, and deletion.
- Documentation describes configuration, layout, lifecycle, rebuild behavior, and session loss.

## Affected Files
- `apps/server/src/config/env.ts`
- `apps/server/src/lib/task-provider-state.ts` and tests
- `apps/server/src/services/spawner.ts` and provisioning tests
- `apps/server/src/lib/task-interactive-terminal.ts` and tests
- `apps/server/src/routes/tasks.ts` and route tests
- `apps/web/src/api/client.ts`
- `apps/web/components/task-detail-page.tsx` and relevant tests
- `docker-compose.yml`, harness scripts, and development/product documentation

## Step-by-Step Plan
1. Add and validate task-home server/Docker-source configuration and path helpers.
2. Implement one-time provisioning, host-state seeding, ownership/permissions, and legacy migration.
3. Mount the persistent home in autonomous and interactive containers and remove per-container copy/staging.
4. Narrow provider session reset to resumable metadata inside the selected provider state.
5. Add safe rebuild and deletion lifecycle operations plus the guarded server endpoint.
6. Add the confirmed UI action and feedback.
7. Add focused tests and documentation, run CI, self-review, and final verification.

## Human-Gated Flow Evidence
- Requirements Read: Complete — user supplied the full ten-part plan.
- Requirements Understood: Complete — persistent task-scoped home with initial-only seeding and explicit destructive rebuild.
- Repository Research Complete: Complete
- Uncertainties Logged: Complete — both runtime adapters use `.codex|.claude/verft-session-id.txt` as the resumable marker.
- Human Review Completed: Complete — user explicitly asked to continue the supplied plan.
- User Approval To Start: Complete — “continue”.
- Baseline Checks Run: Complete — `npm run ci` attempted; Docker socket access was denied before checks started.
- Visible Task List Updated: Complete
- Task-Level Tests/Lint/Build: Complete — local lint, full tests, and production build pass.
- Self Review Complete: Complete
- Code Review Complete: Complete — final diff and lifecycle call sites reviewed.
- Final Verification Complete: Complete, except containerized CI could not start without Docker socket access.
- Security/Privacy Review Complete: Complete — strict task IDs, contained roots, restrictive home mode, no credential logging, existing authorization retained.
- Docs/Changelog Updated: Complete — README, setup guide, environment template, and execution plan.

## Validation Commands
- `npm run test -w @verft/server`
- `npm run test -w @verft/web`
- `npm run ci`

## Risks
- An incorrect host/server path mapping could mount or delete the wrong directory; all task IDs and containment must be validated before filesystem or Docker operations.
- Copying credentials with loose permissions could expose secrets; preserve safe file modes and make the task home agent-owned.
- A failed rebuild could lose state; replacement must be fully prepared before swap and rollback must restore the prior home.
- Provider metadata formats can change; session reset should remove only known resumable metadata and leave unrelated settings/plugins intact.

## Rollback Plan
- Revert the task-home mount/configuration changes. Migrated homes remain independently recoverable under the configured task-home root; do not delete legacy state until migration and swap complete.

## Progress Log
- 2026-07-23 UTC: User approved the full plan; initial research found current provider state under `.task-state/<task-id>/agent-home` and no existing task-home plan.
- 2026-07-23 UTC: Implemented persistent provisioning/migration, shared mounts, provider reset, rebuild UI/API, permanent-delete lifecycle, and documentation.
- 2026-07-23 UTC: `npm test` passed (254 server tests, 34 web tests), `npm run lint` passed, `npm run build` passed, and `git diff --check` passed.
- 2026-07-23 UTC: `npm run ci` could not start because this environment cannot access `/var/run/docker.sock`; the configured remote build runner was also unreachable.

## Decisions
- 2026-07-23: Use a dedicated task-home root parallel to task workspaces and one shared home for both providers and terminal/autonomous containers.
- 2026-07-23: Reuse the repository’s existing task mutation guards for active-run and terminal blocking.
- 2026-07-23: Seed through the toolbox container so configured Docker-host provider paths remain usable even when they are not directly visible in the server container.
- 2026-07-23: Serialize task-home provision/rebuild/delete operations per task and use prepare-then-swap replacement.

## Completion Notes
- Persistent homes now live under the configured task-home root and are mounted read/write at `/home/agent` for every task runtime.
- Existing legacy `agent-home` data migrates before fresh seeding; normal runs never recopy configured provider state.
- New Session preserves the home and clears only the active provider marker. Rebuild is destructive, confirmed in the UI, mutation-guarded, and failure-safe.
- Permanent user deletion and archived-task expiry remove the home; archive, publish, runs, restarts, and workspace rebuilds retain it.
- Full local verification passed. Containerized CI remains an environment limitation, not a code failure.
