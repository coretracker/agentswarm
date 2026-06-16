# Execution Plan Draft

## Title
- Repository-Level MCP Server Configuration

## Goal
- Move task runtime MCP server configuration from system-wide settings to repository-level configuration.
- Ensure tasks and interactive terminals only receive MCP servers intentionally configured for the task's repository.
- Keep the model simple enough that users can predict which tools a task can access before it starts.

## Recommendation
- Repository-level MCP servers should be the runtime source of truth.
- Do not automatically share system-wide MCP servers with every repository. That makes tool access too broad, leaks repo-specific assumptions across unrelated work, and makes credential exposure harder to reason about.
- Remove system-wide MCP server configuration completely. Keeping both global and repository MCP creates two competing mental models and makes the runtime workflow unclear.
- Do not add templates, inheritance, defaults, or copy-on-create behavior in v1. A repository either has MCP servers configured, or it does not.
- This is stricter, but it is easier to audit and safer: tool access is tied to the repository where the task runs.

## Non-goals
- No redesign of the AgentSwarm MCP server endpoint at `/mcp`.
- No per-task ad hoc MCP server overrides in the first slice.
- No organization/team policy model in the first slice.
- No credential vault redesign beyond what is needed for repository-scoped MCP token env vars.
- No templates, global defaults, inheritance, or automatic migration that silently grants repositories the old global MCP servers.

## Current State
- `SystemSettings.mcpServers` stores MCP server definitions globally.
- `SettingsStore` normalizes and persists global `mcpServers`.
- `SpawnerService.runTask` reads `settings.mcpServers` and writes those servers into provider runtime config for every task.
- `startTaskInteractiveTerminal` also serializes `settings.mcpServers` into every interactive Codex/Claude terminal session.
- Repository configuration already owns runtime environment variables and secrets, which is closer to the right boundary for repo-specific MCP credentials.
- The settings UI exposes a system-level "MCP Servers" card.
- Repository editor UI does not expose MCP servers today.

## Acceptance Criteria
- Repositories can store MCP server definitions with the same basic shape as existing `McpServerConfig`.
- Task runtime containers receive only MCP servers configured for the task repository.
- Interactive terminals receive only MCP servers configured for the task repository.
- Existing repository access controls apply to viewing/editing repository MCP configuration.
- Repository-level MCP bearer token env vars are resolved from the runtime environment and warning logs name missing env vars.
- System-wide MCP server configuration is removed from settings, shared types, persistence, and settings UI.
- Existing installations with global MCP servers get a safe migration path that does not broaden runtime access.
- Settings and repository UI copy makes the scope obvious.
- Server and web tests cover serialization, repository persistence, runtime selection, and UI form behavior.

## Proposed Data Model
- Extend `Repository` with `mcpServers: McpServerConfig[]`.
- Extend create/update repository input types with optional `mcpServers`.
- Persist repository MCP servers in Redis and Postgres repository stores.
- Remove `SystemSettings.mcpServers` from shared types and settings persistence.
- Leave any old database column in place only if needed for a safe rolling deploy, but stop reading and writing it from application code.

## Runtime Resolution Policy
- `resolveRuntimeMcpServers(repository)` should return repository MCP servers only.
- Disabled repository servers are ignored, matching current behavior.
- Invalid/incomplete server definitions are skipped by existing serialization helpers.
- There is no global merge path and no fallback path.

## Migration Strategy
- Add repository-level storage first and switch runtime resolution to repository MCP servers only.
- Remove global MCP editing from settings UI in the same implementation.
- Stop reading global `settings.mcpServers` from runtime paths.
- Add a migration note: global MCP servers were intentionally removed and must be manually recreated on each repository that should use them.
- Avoid automatic copy-to-all-repos because that preserves the exact over-sharing behavior this change is meant to fix.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/services/repository-store.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/server/src/services/settings-store.ts`
- `apps/server/src/lib/mcp-config.ts`
- `apps/server/src/lib/mcp-config.test.ts`
- `apps/server/src/services/spawner.ts`
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/web/components/repository-editor-page.tsx`
- `apps/web/components/settings-page.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useRepositories.ts`
- `apps/server/src/db/migrations.ts`
- `README.md`
- `docs/product/user-flows.md`

## Step-by-Step Plan
1. Confirm scope and UX decision.
- Confirm repository-only MCP configuration.
- Confirm removal of global settings UI and no implicit global-to-repository inheritance.

2. Extend shared contracts.
- Add `mcpServers` to `Repository`, `CreateRepositoryInput`, and `UpdateRepositoryInput`.
- Reuse `McpServerConfig` and existing transport types.

3. Persist repository MCP configuration.
- Add normalization in repository stores, similar to current settings normalization.
- Add Postgres migration for repository MCP server JSON storage.
- Backfill missing values to `[]`.

4. Update repository APIs.
- Accept repository MCP server configuration on create/update.
- Return repository MCP server definitions only to users with repository edit access.
- Keep response behavior bounded and avoid returning secret values; only env var names are stored.

5. Remove global MCP settings.
- Remove `mcpServers` from `SystemSettings` shared type and settings update schemas.
- Stop persisting new global MCP settings.
- Remove the settings page MCP Servers form card.
- Keep database migration/backward compatibility conservative, but do not expose or use global MCP servers.

6. Change runtime MCP resolution.
- Update build/ask runtime setup to load the task repository and serialize repository MCP servers.
- Update interactive terminal launch to use repository MCP servers.
- Keep missing bearer token warnings.
- Add a small helper for runtime MCP resolution so spawner and terminal paths cannot diverge.

7. Update UI.
- Move MCP server editing from system settings to repository editor.
- Remove system settings MCP controls entirely.
- Make repository editor copy explicit that these MCP servers are available only to tasks for this repository.

8. Add regression tests.
- Repository store persists and normalizes MCP servers.
- Settings store no longer accepts or returns global MCP servers.
- Runtime config uses repository MCP servers only.
- Interactive terminal config uses repository MCP servers only.
- Existing serialization tests continue to pass.
- Repository editor submits MCP server fields correctly.

9. Documentation and migration notes.
- Update README/settings docs to explain repository-scoped MCP.
- Add a migration note that global MCP is removed and must be manually recreated per repository.
- Document how to attach a server to a repository and how bearer token env vars are resolved.

## Human-Gated Flow Evidence
- Requirements Read: TODO
- Requirements Understood: TODO
- Repository Research Complete: TODO
- Uncertainties Logged: TODO
- Human Review Completed: TODO
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
- `node --import tsx --test apps/server/src/lib/mcp-config.test.ts`
- `node --import tsx --test apps/server/src/services/spawner.workspace-provisioning.test.ts`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Removing implicit global MCP injection can surprise users who rely on current global behavior.
- Repository-level MCP credential env vars still depend on server process environment, so operators need clear deployment docs.
- Runtime paths can drift if task runs and interactive terminals resolve MCP servers differently.
- Removing global MCP settings can break existing tasks that expected those tools until the repository is configured.

## Rollback Plan
- Restore runtime resolution to `settings.mcpServers`.
- Restore `SystemSettings.mcpServers` and the settings UI MCP card.
- Keep repository `mcpServers` data harmless and unused until the design is revisited.

## Open Questions
- Should repository-level MCP config be visible to all users with repo access, or only users who can edit repositories?
- Do we need per-provider enablement, or is repository-level enable/disable enough for v1?
- Should old global MCP rows be deleted from Postgres during migration, or left unused for rollback safety?

## Completion Notes
- Draft only.
