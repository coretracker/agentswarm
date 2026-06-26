# Remove Per-User Codex Auth Json And Git Identity

Issue: https://github.com/coretracker/agentswarm/issues/62
Draft PR: https://github.com/coretracker/agentswarm/pull/63
Linked AgentSwarm task: `IuHB3ll1Tsl7RE1UReI72`

## Clarified Goal

Remove per-user Codex `auth.json` and per-user git author information. AgentSwarm should not require or store unique Codex auth files or git author name/email values on each user profile.

The desired direction is:

- Use systemwide Codex credentials instead of per-user Codex `auth.json`.
- Use repository-wide or system git author name/email instead of per-user git author info.
- Preserve temporary runtime files/env vars only as implementation details derived from system/repository configuration.

## Research Findings

- Per-user Codex `auth.json` currently exists in the encrypted credential payload as `codexAuthJsonByUserId` in `apps/server/src/services/credential-store.ts`.
- Global/system Codex credentials also exist today as `codexAuthJson` in the same encrypted singleton payload, alongside the OpenAI API key.
- Profile UI currently exposes per-user Codex `auth.json` and per-user git author name/email in `apps/web/components/app-shell.tsx`.
- Auth/profile APIs currently accept and return per-user credential status and per-user git author fields through `apps/server/src/routes/auth.ts`, user session types, and shared types.
- Task credential selection currently allows `Auto (Profile then Global)`, `Profile auth.json only`, and `Global OpenAI key or auth.json`. This keeps per-user credentials in the normal task flow.
- Runtime credential resolution in `apps/server/src/services/settings-store.ts` currently checks the task owner profile credential before falling back to the global credential for `auto`.
- Automated Codex runs and interactive terminals materialize a temporary `~/.codex/auth.json` inside task/container state because the Codex CLI consumes file credentials. That runtime file can remain, but it should be derived from system/global credentials, not user profile credentials.
- Git commit identity currently resolves from `task.ownerUserId` in `apps/server/src/lib/task-git-identity.ts`, using `user.gitAuthorName/gitAuthorEmail` with profile name/email fallback. That is the per-user git author path to remove.
- Git env injection is transient through `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, and `GIT_CONFIG_*` entries. The desired replacement should populate those from repository-wide or system settings instead of user profile data.

## Proposed Scope

Remove the per-user Codex auth and per-user git author workflow while preserving a system/repository-level way to run tasks.

1. Remove profile-level Codex `auth.json` UI, API inputs, session flags, and encrypted `codexAuthJsonByUserId` storage.
2. Keep or clarify the system/global Codex credential path in Settings, and ensure task runtimes derive any temporary `~/.codex/auth.json` from that system credential only.
3. Remove `Profile auth.json only` and the profile-first behavior from task credential selection.
4. Simplify Codex credential source behavior so user-owned tasks do not resolve credentials from `task.ownerUserId`.
5. Remove per-user git author name/email profile UI, API fields, shared types, persistence, and task-owner lookup behavior.
6. Add or use repository-wide/system git author name/email configuration for commits created by tasks and interactive terminals.
7. Keep git author env injection transient; only the source of name/email should change from per-user profile data to repository/system configuration.
8. Add a migration/backfill strategy for existing per-user Codex auth and per-user git author fields. Mark missing evidence as TODO if product policy should decide whether to delete, ignore, or migrate old values.
9. Update tests for profile/settings APIs, credential resolution, task creation/edit options, runtime credential payloads, git identity resolution, and interactive terminal env injection.

## Acceptance Criteria

- User profile screens no longer show or accept Codex `auth.json`.
- User profile screens no longer show or accept git author name/email overrides.
- Server APIs no longer expose per-user Codex auth configured flags or per-user git author fields unless retained only for backward-compatible migration.
- Codex task runs and interactive terminals do not read `codexAuthJsonByUserId` or task-owner profile Codex auth.
- Any runtime `~/.codex/auth.json` file is temporary task/container state derived from the system/global Codex credential.
- Git commits from tasks use repository-wide or system-configured author name/email, not the task owner's profile fields.
- Existing per-user credential/identity data is handled by an explicit migration or documented cleanup path.
- Tests cover that two different users do not produce different Codex auth or git author values merely because of profile-level configuration.
