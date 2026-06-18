# Execution Plan

## Title
- Git Access for Codex and Claude Runtime Agents

## Goal
- Give Codex and Claude task runtimes reliable Git identity and authenticated Git access so agents can fetch, pull, commit, and push from task workspaces when the user has configured the required credentials.

## Non-goals
- Replacing the existing server-side Git push/pull/merge flow.
- Adding support for non-GitHub providers in this change.
- Exposing raw GitHub tokens, Codex auth JSON, or Anthropic keys in API/UI responses, logs, task messages, or runtime result files.
- Changing repository ownership or sync policy.
- Automatically creating GitHub tokens for users.
- Adding SSH-key based Git auth unless later selected as a separate feature.

## Current State
- Global GitHub token storage already exists in Settings credentials and is reported only as configured/missing.
- Settings already has a global `gitUsername`, defaulting to `x-access-token`.
- Users already have optional Git commit identity fields (`gitAuthorName`, `gitAuthorEmail`) with profile name/email fallback.
- Server-side Git helpers already build `GIT_ASKPASS`, `GIT_TOKEN`, `GIT_USERNAME`, safe-directory config, and Git author/committer env for managed Git commands.
- Git terminal mode already receives Git token and identity env entries and creates an askpass script inside the terminal container.
- Automated Codex/Claude task containers receive provider credentials, repository env entries, MCP env, Docker env, and workspace mounts, but do not currently have an explicit shared Git runtime env injection path for `GIT_TOKEN`, `GIT_USERNAME`, `GIT_ASKPASS`, `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, and Git config user identity.
- Codex/Claude may therefore fail or behave inconsistently when they run Git directly inside the runtime container, especially for authenticated `pull`/`push` and commits requiring user identity.

## Acceptance Criteria
- Codex and Claude automated task containers receive a consistent Git runtime environment when a GitHub token is configured.
- Runtime Git auth uses write-only stored credentials and does not print or persist the raw token in logs, task output, result files, or API responses.
- Runtime Git identity resolves from the task owner’s Git author fields, then profile name/email, then server fallback identity.
- Runtime containers can run `git pull` and `git push` against HTTPS GitHub remotes without interactive prompts when the configured token has sufficient scopes.
- Runtime containers can create commits with the resolved user identity without relying on global image-level Git config.
- Missing GitHub token and missing/invalid identity states have clear validation or task-log messaging before users expect agents to push/pull.
- Existing server-side Git operations continue to use the same credential source and existing behavior.
- Git terminal behavior remains compatible.
- Tests cover the shared Git runtime env builder, Codex/Claude task container argument injection, identity fallback, and no-token behavior.
- User-facing docs identify where to configure the GitHub token, required token permissions, and Git author identity.

## Affected Files
- `apps/server/src/lib/git-env.ts`
- `apps/server/src/lib/git-env.test.ts`
- `apps/server/src/lib/task-git-identity.ts`
- `apps/server/src/lib/task-git-identity.test.ts`
- `apps/server/src/lib/task-interactive-terminal-git-env.ts`
- `apps/server/src/lib/task-interactive-terminal.test.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `apps/server/src/providers/runtime-definitions.ts`
- `apps/server/src/services/settings-store.ts`
- `apps/web/components/settings-page.tsx`
- `apps/web/components/app-shell.tsx`
- `apps/web/components/users-page.tsx`
- `docs/development/setup.md`
- `docs/development/debugging.md`
- `docs/product/user-flows.md`

## Step-by-Step Plan
1. Confirm credential and identity requirements.
   - Verify whether GitHub token should remain global only or whether per-user/per-repository token support is needed.
   - Define required GitHub token permissions for private repos, branch pushes, PR imports, and status/comment automation.
   - Confirm fallback Git identity values.
2. Add a shared automated-runtime Git env builder.
   - Reuse existing `buildGitProcessEnv`/interactive Git env behavior where practical.
   - Produce env entries suitable for Docker `-e` injection into Codex and Claude task containers.
   - Include `GIT_OPTIONAL_LOCKS=0`, non-interactive askpass auth, safe-directory config, `user.name`, `user.email`, and author/committer variables.
3. Wire Git env into Codex/Claude task container launches.
   - Resolve task-owner Git identity during `runTask`.
   - Inject Git env before provider image in Docker args for both Codex and Claude.
   - Keep server-side Git command env unchanged except for shared helper reuse if it reduces duplication safely.
4. Make missing Git access visible.
   - Add settings/help text that GitHub token is needed for in-agent pull/push.
   - Add task/run log notes when GitHub token is not configured so users understand agent Git network operations may fail.
   - Avoid blocking read-only or no-push workflows unless an explicit Git operation requires auth.
5. Validate secret handling.
   - Check all logs and runtime output paths for accidental token echoing.
   - Ensure Docker arg construction does not surface token values in task logs or API responses.
   - Prefer not to write token-bearing files into mounted workspaces or persisted provider state.
6. Add and update tests.
   - Unit-test env entries for token present, token missing, identity present, and identity fallback.
   - Test task runtime Docker args include Git env for both providers without exposing values in logged strings.
   - Retain existing Git terminal tests and add coverage only if helper changes affect it.
7. Update docs.
   - Document configuration path: Settings credentials for GitHub token, Settings Git Username, user profile/admin Git author identity.
   - Document recommended GitHub token scopes/permissions and expected GitHub username value for PAT auth.
   - Add troubleshooting notes for `could not read Username`, `Authentication failed`, and `Author identity unknown`.
8. Run validation and self-review.
   - Run targeted package tests first.
   - Run canonical harness checks where available.
   - Complete security/privacy review before moving this plan to completed.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES (kept current global GitHub token model; SSH and per-user/per-repository Git auth remain out of scope)
- Human Review Completed: YES
- User Approval To Start: YES
- Baseline Checks Run: PARTIAL (`./scripts/harness/check-human-gated-flow.sh` passed; `./scripts/harness/doctor.sh` is blocked here because Docker daemon is not reachable)
- Visible Task List Updated: YES
- Task-Level Tests/Lint/Build: YES (`node --import tsx --test apps/server/src/lib/task-interactive-terminal.test.ts`, `node --import tsx --test apps/server/src/lib/task-git-identity.test.ts`, `node --check agent-runtime-codex/run-task.mjs`, `node --check agent-runtime-claude/run-task.mjs`, `npm run build -w @agentswarm/server`, `npm run build -w @agentswarm/web`, `TEST_SCOPE=unit ./scripts/harness/test.sh`)
- Self Review Complete: YES
- Code Review Complete: NO (pending maintainer review)
- Final Verification Complete: PARTIAL (`./scripts/harness/test.sh` unit phase passed; `./scripts/harness/check.sh` still fails on pre-existing docs link issues in `docs/repomix.md`, and `doctor.sh` needs a reachable Docker daemon)
- Security/Privacy Review Complete: YES (runtime askpass scripts reference env vars instead of writing token values to disk; UI/API remain write-only for credentials)
- Docs/Changelog Updated: YES

## Validation Commands
- `./scripts/harness/doctor.sh`
- `./scripts/harness/check-human-gated-flow.sh`
- `npm run test -w @agentswarm/server -- git-env`
- `npm run test -w @agentswarm/server -- task-git-identity`
- `npm run test -w @agentswarm/server -- task-interactive-terminal`
- `npm run test -w @agentswarm/server -- spawner`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `npm run build -w @agentswarm/server`
- `npm run build -w @agentswarm/web`
- `./scripts/harness/check.sh`
- `TEST_SCOPE=unit ./scripts/harness/test.sh`
- `./scripts/harness/test.sh`

## Risks
- Token values may become visible through Docker process arguments on the host while containers are running.
- Provider CLIs may persist environment-derived Git configuration into provider state directories if startup scripts are changed carelessly.
- A global GitHub token may push as a service account while commits are authored as the task owner; this may be intentional but needs clear UI/docs.
- A token without correct repository permissions will still fail at push/pull time; validation can only check configuration presence unless GitHub API checks are added.
- Some repositories may use SSH remotes, which PAT askpass does not authenticate unless remotes are normalized or rewritten.
- Existing tests may mock Docker args and need updates to account for new env injection.

## Rollback Plan
- Remove automated-runtime Git env injection from `SpawnerService.runTask`.
- Revert any shared helper changes and restore previous Git terminal/server Git env behavior.
- Revert UI/docs changes about in-agent Git access.
- Re-run server/web lint and targeted tests to confirm previous behavior.

## Progress Log
- 2026-06-11 12:48 UTC: Created active execution plan after repository research into credential storage, Git identity resolution, server Git helpers, Git terminal env, and task container launch flow.
- 2026-06-11 12:55 UTC: Implemented shared automated-runtime Git env injection, wired it into `SpawnerService.runTask`, updated Codex/Claude runtime scripts to create in-container askpass helpers, added targeted tests, and documented credential/identity setup and troubleshooting.
- 2026-06-11 13:00 UTC: Ran remaining feasible harness validation. `TEST_SCOPE=unit ./scripts/harness/test.sh` passed. `./scripts/harness/doctor.sh` is blocked by unavailable Docker daemon. `./scripts/harness/check.sh` still fails on existing broken links reported from `docs/repomix.md`.

## Decisions
- 2026-06-11: Treat server-side Git operations and in-agent Git operations as separate surfaces; preserve server-side behavior while adding explicit Git env to automated Codex/Claude containers.
- 2026-06-11: Plan for PAT/askpass-based HTTPS GitHub auth first because the existing settings model already stores a GitHub token and username.

## Completion Notes
- Automated Codex and Claude task containers now receive Git auth and Git identity env entries derived from the task owner plus configured GitHub token/username.
- Codex and Claude runtime scripts now create an in-container askpass helper when `GIT_TOKEN` is present, avoiding raw token persistence in files.
- Claude runtime no longer overwrites injected `GIT_CONFIG_*` entries with a hardcoded single safe-directory config.
- Settings/profile/user docs and UI copy now explain where GitHub token, Git username, and Git author identity are configured.
- Harness unit tests pass after the runtime Git env changes.
- Remaining verification blockers in this environment are unrelated to this change: Docker daemon unavailable for `doctor.sh`, and existing broken docs links under `docs/repomix.md` cause `check.sh` to fail.
