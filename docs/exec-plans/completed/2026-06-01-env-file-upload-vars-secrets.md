# Execution Plan

## Title
- Text/File Support for Repository Environment Variables and Secrets

## Goal
- Let repository environment variables and secrets be either text values or uploaded files, with secure storage and runtime mounting for both Codex and Claude.

## Non-goals
- Parsing uploaded files into structured config objects.
- Changing non-repository secret systems (for example webhook secret handling).

## Current State
- Repository editor supported plain text values and converted uploaded files into inline text/Base64.
- Runtime injected repository env values directly as strings.
- No secure persistent file-backed path existed for repository env values.

## Acceptance Criteria
- Users can choose `Text` or `File` for env vars and env secrets.
- File uploads are stored securely and never returned in plaintext from API/UI.
- Runtime mounts generated files for both Codex and Claude and sets env var values to mounted file paths.
- Manual text behavior remains unchanged.
- Missing/invalid files fail with clear errors.
- Backend enforces constraints and permissions (scope checks already in repository routes).

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/services/repository-env-file-store.ts`
- `apps/server/src/lib/repository-runtime-env.ts`
- `apps/server/src/services/repository-store.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/server/src/lib/task-interactive-terminal-git-env.ts`
- `apps/server/src/lib/task-interactive-terminal.test.ts`
- `apps/web/components/repository-editor-page.tsx`

## Step-by-Step Plan
1. Add shared model types for text/file env entries.
2. Add secure encrypted file store for repository env files.
3. Update repository persistence and API normalization for text/file entries.
4. Update runtime spawning and interactive terminals to materialize/mount file entries.
5. Update repository editor UI with Text/File selector and upload flow.
6. Run lint/build/test/harness verification.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES (selected encrypted-at-rest file storage with runtime materialization)
- Human Review Completed: NO (pending maintainer review)
- User Approval To Start: YES (issue request)
- Baseline Checks Run: YES (`REMOTE_BUILD=0 ./scripts/harness/check.sh`)
- Visible Task List Updated: YES
- Task-Level Tests/Lint/Build: YES (`npm run build -w @verft/server`, `npm run build -w @verft/web`, package tests, harness check)
- Self Review Complete: YES
- Code Review Complete: NO (pending maintainer review)
- Final Verification Complete: YES (repository check pipeline completed successfully)
- Security/Privacy Review Complete: YES (file contents encrypted at rest and never surfaced in API/UI)
- Docs/Changelog Updated: YES (execution plan documentation updated)

## Validation Commands
- `npm run lint -w @verft/server`
- `npm run test -w @verft/server`
- `npm run build -w @verft/server`
- `npm run lint -w @verft/web`
- `npm run test -w @verft/web`
- `npm run build -w @verft/web`
- `REMOTE_BUILD=0 ./scripts/harness/check.sh`
- `REMOTE_BUILD=0 ./scripts/harness/test.sh` (fails in this environment because Docker Compose is unavailable)

## Risks
- Orphaned encrypted files if write failures are not cleaned up.
- Runtime failure if stored file reference is missing on disk.

## Rollback Plan
- Revert shared type changes for env entries.
- Remove repository env file store/materialization and use text-only env injection.
- Re-run lint/build/tests to confirm fallback state.

## Progress Log
- 2026-06-01 09:00 UTC: Created execution plan.
- 2026-06-01 10:10 UTC: Implemented secure repository env file store and updated repository persistence model.
- 2026-06-01 10:40 UTC: Implemented runtime materialization for task runs and interactive terminals.
- 2026-06-01 11:05 UTC: Updated repository editor with Text/File controls and file upload states.
- 2026-06-01 11:30 UTC: Completed lint/build/tests and harness checks.

## Decisions
- 2026-06-01: File-backed env entries are encrypted at rest using the existing server key and materialized only at runtime.
- 2026-06-01: File upload limit set to 256 KiB; text limit remains 8192 characters.

## Completion Notes
- Added full text/file model support for repository env vars and env secrets.
- Added secure encrypted-at-rest file persistence for uploaded values.
- Runtime now mounts generated files and sets env variables to those mounted paths.
- Interactive terminal modes now use the same file-backed behavior.
- UI now supports type selection, file upload, “file set” states, and clear error messaging.
