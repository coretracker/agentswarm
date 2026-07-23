# Docker-Managed Task Homes

## Goal
- Store persistent task homes in a Docker named volume so container-owned state uses native Linux filesystem semantics on macOS and Linux.
- Migrate existing local `./task-homes` data into an empty named volume without deleting the source.

## Non-goals
- Moving task workspaces into a named volume.
- Changing task-home lifecycle or provider session behavior.
- Removing the existing configurable task-home source override.

## Current State
- Compose bind-mounts `./task-homes` into the server.
- Docker Desktop exposes that macOS directory through a filesystem bridge that can reject Linux ownership changes.
- Task runtimes require task-home files to be writable by UID/GID 1000.

## Acceptance Criteria
- Default Compose deployments use the `verft_task_homes` named volume at `/task-homes`.
- Existing `./task-homes` content is copied only when the named volume is empty; source data remains untouched.
- Migrated content is owned by UID/GID 1000 inside the Docker-managed volume.
- Server and spawned runtime containers resolve and mount the same named volume.
- Harness defaults no longer force the legacy host directory as the Docker source.
- Tests and documentation describe the storage and migration behavior.

## Affected Files
- `docker-compose.yml`
- `scripts/harness/*.sh`
- `apps/server/src/lib/task-home.ts`
- `apps/server/src/services/spawner.ts`
- relevant tests and documentation

## Step-by-Step Plan
1. Add a one-shot Compose initializer and named task-home volume.
2. Align harness defaults and restore strict ownership initialization on Docker-managed storage.
3. Add static/configuration regression coverage and update operator documentation.
4. Run focused tests, lint, build, CI fallback, and self-review.

## Human-Gated Flow Evidence
- Requirements Read: Complete — user requested the recommended named-volume design.
- Requirements Understood: Complete — container-owned homes move off the macOS bind mount with non-destructive migration.
- Repository Research Complete: Complete — Compose, environment mount discovery, harness defaults, and Docker guidance reviewed.
- Uncertainties Logged: Complete — migration runs only for an empty destination to avoid merging conflicting state.
- Human Review Completed: Complete — recommendation and migration requirement were presented before implementation.
- User Approval To Start: Complete — “do the change”.
- Baseline Checks Run: Complete — `npm run ci` blocked by denied Docker socket before checks started.
- Visible Task List Updated: Complete
- Task-Level Tests/Lint/Build: Complete — focused tests, Compose config, shell syntax, lint, build, and diff checks pass.
- Self Review Complete: Complete — acceptance, tests, docs, boundaries, errors, security, simplicity, and maintainability reviewed.
- Code Review Complete: Complete — final diff and mount-source flow reviewed.
- Final Verification Complete: Complete except containerized CI, which cannot access the Docker socket in this environment.
- Security/Privacy Review Complete: Complete — migration is read-only on the legacy source, empty-destination-only, preserves modes, and logs no content.
- Docs/Changelog Updated: Complete — README, setup guide, environment template, and this plan updated.

## Validation Commands
- `node --import tsx --test apps/server/src/lib/task-interactive-terminal.test.ts apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `npm run lint`
- `npm run build`
- `npm run ci`

## Risks
- An automatic migration could overwrite newer volume state; initialization must copy only into an empty volume.
- A Compose project-prefixed volume name could disagree with spawned runtime mounts; the volume must have the explicit name `verft_task_homes`.
- Credential files must remain inside Docker-managed storage and must not be logged.

## Rollback Plan
- Restore the `./task-homes:/task-homes` bind mount. The migration leaves the original directory untouched.

## Progress Log
- 2026-07-23 UTC: User approved the named-volume design and non-destructive migration.
- 2026-07-23 UTC: Baseline CI could not access `/var/run/docker.sock`.
- 2026-07-23 UTC: Added the named volume, one-shot empty-only migration, strict ownership initialization, harness defaults, regression coverage, and documentation.
- 2026-07-23 UTC: Focused tests, `docker compose config --quiet`, shell syntax, lint, build, and `git diff --check` passed; final CI remained blocked by Docker socket permissions.

## Decisions
- 2026-07-23: Keep host-visible task workspaces bind-mounted; move only opaque agent-home state to a named volume.
- 2026-07-23: Use a one-shot Compose service so direct Compose users and harness users receive the same migration behavior.

## Completion Notes
- Default Compose task homes now live in `verft_task_homes`; `./task-homes` is retained only as a read-only migration source.
- The initializer copies legacy content only into an empty volume and assigns UID/GID 1000 on Docker-native storage.
- Runtime home ownership setup is strict again; macOS bind-mount permission exceptions are no longer part of the default path.
