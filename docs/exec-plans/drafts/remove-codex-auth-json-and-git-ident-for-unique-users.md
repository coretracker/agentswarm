# Remove Codex Auth Json And Git Identity For Unique Users

Issue: https://github.com/coretracker/agentswarm/issues/62
Linked AgentSwarm task: `IuHB3ll1Tsl7RE1UReI72`

## Research Findings

- Codex credentials are stored in the encrypted singleton credential payload with both a global `codexAuthJson` and per-user `codexAuthJsonByUserId` map in `apps/server/src/services/credential-store.ts`.
- User profile UI already supports per-user Codex `auth.json` and per-user git author name/email in `apps/web/components/app-shell.tsx`.
- Settings UI still exposes `Global Codex auth.json`, and task creation still offers `Auto (Profile then Global)`, `Profile auth.json only`, and `Global OpenAI key or auth.json` credential sources.
- Runtime credential resolution in `apps/server/src/services/settings-store.ts` currently falls back from profile `auth.json` to global `auth.json` for `auto`, and permits explicit `global` selection.
- Automated Codex runs pass task-owner credentials into the runtime, and `agent-runtime/run-task-codex.mjs` writes `auth.json` into task-scoped Codex state before invoking Codex. This temporary runtime file is still needed; the issue is the durable system/global credential source.
- Interactive terminals resolve credentials for `task.ownerUserId` and write `auth.json` into task-scoped provider state mounted as `/root/.codex`.
- Git commit identity already resolves from `task.ownerUserId` via `apps/server/src/lib/task-git-identity.ts`, using `user.gitAuthorName/gitAuthorEmail` with profile name/email fallback. Git env injection is transient through `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, and `GIT_CONFIG_*` entries.
- There is still a product-level fallback identity (`DEFAULT_GIT_COMMIT_IDENTITY`) used when a task has no owner or the owner cannot be resolved. That fallback should remain only for system/unowned work, not as a normal multi-user identity.

## Proposed Scope

Remove the durable global Codex `auth.json` workflow for user-owned Codex tasks while preserving task-scoped runtime `auth.json` materialization.

1. Remove `Global Codex auth.json` from Settings UI and settings credential APIs.
2. Remove global Codex `auth.json` storage from Redis/Postgres credential payloads, or migrate/read-and-clear it safely so existing encrypted payloads do not keep using it.
3. Remove `CodexCredentialSource = global` and the global fallback in `auto`; user-owned Codex tasks should require the task owner profile `auth.json` unless running through a global OpenAI API key flow is explicitly retained and documented.
4. Update task creation/edit UI copy so Codex credentials are described as profile/user-scoped.
5. Ensure automated runs, follow-ups, checkpoint apply helpers, and interactive terminal sessions always resolve Codex auth from `task.ownerUserId` for user-owned tasks.
6. Keep temporary task/container-local `~/.codex/auth.json` writes because Codex CLI still consumes file credentials at runtime.
7. Keep git identity transient and task-owner-derived; tighten fallbacks so user-owned work does not commit as the default bot identity when owner lookup fails.
8. Update tests for credential resolution, settings/profile APIs, task creation validation, git identity fallback behavior, and interactive terminal env injection.

## Acceptance Criteria

- A user-owned Codex task cannot silently use another user's or systemwide Codex `auth.json`.
- The Settings page no longer accepts or displays global Codex `auth.json` configuration.
- Profile-level Codex `auth.json` remains write-only, encrypted, clearable, and usable by that user's tasks.
- Runtime containers may still receive a task-scoped `auth.json` file, but it is derived from the task owner profile credential.
- Git commits from user-owned tasks use that user's configured git author name/email, or profile name/email, and do not fall back to a repository/system identity unless the task is explicitly unowned/system-owned.
- Existing tests pass and new regression tests cover multi-user isolation.
