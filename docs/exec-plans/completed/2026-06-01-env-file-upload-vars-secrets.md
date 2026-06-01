# Execution Plan

## Title
- File Upload Support for Repository Environment Variables and Secrets

## Goal
- Add file upload controls to repository environment variable and environment secret inputs so users can load values from files while preserving manual entry.

## Non-goals
- Adding a new backend file-storage service.
- Parsing file formats into structured config objects.
- Changing provider-specific runtime injection behavior (already shared for Codex and Claude).

## Current State
- Repository editor supports manual text entry for env vars and env secrets.
- Backend enforces value length constraints (max 8192 chars).
- Repository env vars and env secrets are injected into both Codex and Claude task runtimes.

## Acceptance Criteria
- Users can upload file content into both env var and env secret value fields.
- Upload keeps existing manual editing behavior.
- UI clearly states upload behavior and limits.
- Empty, unreadable, or oversize uploads show clear user-facing errors.
- Clarify upload handling: UTF-8 files are stored as text; non-UTF-8 files are Base64-encoded.
- Resulting values continue to apply to both Codex and Claude environments.

## Affected Files
- `apps/web/components/repository-editor-page.tsx`
- `docs/exec-plans/completed/2026-06-01-env-file-upload-vars-secrets.md`

## Step-by-Step Plan
1. Add shared constants and helpers for file upload read/validation.
2. Add upload controls to environment variables rows and wire value field updates.
3. Add upload controls to environment secrets rows and wire value field updates.
4. Add clear guidance text for provider targets (Codex + Claude), file handling mode, and constraints.
5. Run lint/build checks and targeted tests.
6. Update execution-plan evidence and move plan to completed.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES (decided UTF-8 text with Base64 fallback for binary files)
- Human Review Completed: TODO (awaiting maintainer review)
- User Approval To Start: YES (issue request)
- Baseline Checks Run: YES (`REMOTE_BUILD=0 ./scripts/harness/check.sh`)
- Visible Task List Updated: YES
- Task-Level Tests/Lint/Build: YES (`npm run build -w @agentswarm/web`, `npm run lint -w @agentswarm/web`, `npm run test -w @agentswarm/web`, harness check)
- Self Review Complete: YES
- Code Review Complete: TODO (awaiting maintainer review)
- Final Verification Complete: YES (repository check pipeline completed successfully)
- Security/Privacy Review Complete: YES (secret write-only behavior preserved, explicit UX copy)
- Docs/Changelog Updated: YES (execution plan documentation updated)

## Validation Commands
- `npm run lint -w @agentswarm/web`
- `npm run build -w @agentswarm/web`
- `REMOTE_BUILD=0 ./scripts/harness/check.sh`

## Risks
- Confusion if users upload binary files expecting raw binary storage.
- Oversize uploads exceeding backend limits.

## Rollback Plan
- Remove upload controls and helper code in repository editor.
- Re-run lint/build to restore previous behavior.

## Progress Log
- 2026-06-01 09:00 UTC: Created execution plan and scoped upload handling behavior.
- 2026-06-01 09:12 UTC: Added file upload controls and value import logic for both env vars and env secrets.
- 2026-06-01 09:24 UTC: Completed lint/build/test validation and harness checks.

## Decisions
- 2026-06-01: Uploaded files are stored as UTF-8 text when decodable, otherwise Base64.

## Completion Notes
- Added upload controls for both environment variables and environment secrets in the repository editor.
- Preserved manual entry behavior for all existing fields.
- Upload handling:
  - Reads UTF-8 text when possible.
  - Falls back to Base64 for binary files.
  - Rejects empty/unreadable files and values over 8192 characters.
- UI now clearly states:
  - Values apply to both Codex and Claude.
  - Upload behavior and backend size limit.
