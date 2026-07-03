# Slack DM Assistant MVP

## Title
- Slack DM Assistant MVP

## Goal
- Implement the first Slack integration slice as a simple 1:1 assistant conversation detached from normal task workflows.
- Let a user add their Slack username to their profile, start a DM with the bot, and chat with a Codex or Claude runtime that can use GitHub plus Verft MCP as information sources.
- Let repository owners configure Slack bot credentials in a repository Slack integration section.
- Stop the runtime container after 5 minutes of user inactivity, then start a new runtime attached to the same Slack conversation context when the user writes again.
- Reuse existing profile, provider runtime, credentials, MCP, and container lifecycle systems wherever practical.

## Non-goals
- No repository-to-Slack mapping in v1.
- No Slack channel workflow in v1.
- No Slack thread task workflow in v1.
- No automatic Verft task creation from Slack messages.
- No task board, checkpoint, PR, or issue workflow changes unless the user explicitly asks the bot to start a normal task.
- No long-running always-on provider container per Slack user.
- No broad Slack workspace administration UI beyond the minimum configuration needed to receive and reply to DMs.

## Current State
- There is no Slack integration in the source tree today.
- User profile data is exposed through `GET /auth/profile`, updated through `PATCH /auth/profile`, and rendered in the profile modal in `apps/web/components/app-shell.tsx`.
- User persistence already supports Postgres migrations and user profile fields in `apps/server/src/services/user-store.ts` and `apps/server/src/db/migrations.ts`.
- Provider runtime configuration is centralized in `apps/server/src/providers/runtime-definitions.ts`.
- Task runs and interactive terminals already launch Codex/Claude containers through the unified runtime image.
- Runtime containers already receive provider credentials, GitHub credentials, and MCP config through server-side setup paths.
- Verft MCP exists at `POST /mcp` with personal access token authentication and task/repository tools.
- Repository MCP configuration exists for task and interactive terminal runtimes, but this MVP should not require a repository mapping.
- Repository settings already own repository-scoped integration-style configuration, so Slack bot credentials should be configured from a repository Slack integration section instead of global system settings or deployment-only env vars.
- Normal task lifecycle, checkpointing, and queueing are task-centric and should remain separate from Slack DM assistant chats.

## Acceptance Criteria
- Users can save a Slack username in their profile.
- The Slack username is persisted, returned in profile/session data where needed, and validated with a simple Slack-handle-compatible format.
- Repository owners can configure Slack bot credentials in a repository Slack integration section.
- Slack bot credentials are stored securely, masked on read, and can be cleared or rotated.
- Verft can receive Slack DM events from the configured repository Slack bot endpoint.
- Incoming Slack DM messages are matched to an Verft user by Slack username.
- If no matching active user exists, the bot replies with a short setup message and does not start a provider runtime.
- A matched user can chat with the bot in 1:1 Slack DMs without selecting a repository.
- The DM assistant runtime receives instructions that it is an informational assistant and must use GitHub plus Verft MCP as sources where relevant.
- The DM assistant runtime can call Verft MCP using the matched user's identity or a clearly scoped equivalent token.
- The DM assistant runtime is detached from normal task workflows; no `Task` is created unless the user explicitly asks for one.
- A per-user Slack DM conversation context persists across idle runtime restarts.
- The active runtime container stops after 5 minutes without a new user Slack message.
- When the same user writes again after idle stop, Verft starts a new runtime attached to the same Slack DM conversation context.
- Slack messages from the bot are posted back into the same DM conversation.
- Server tests cover username persistence, Slack event authentication/routing, user matching, runtime start/reuse/idle-stop behavior, and non-creation of tasks.
- Docs explain the v1 Slack DM scope and explicitly state that repository mapping and task workflows are later features.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/services/user-store.ts`
- `apps/server/src/routes/auth.ts`
- `apps/web/components/app-shell.tsx`
- `apps/web/src/api/client.ts`
- `apps/server/src/services/repository-store.ts`
- `apps/server/src/routes/repositories.ts`
- `apps/web/components/repository-editor-page.tsx`
- New: `apps/server/src/routes/slack-events.ts`
- New: `apps/server/src/services/slack-assistant-store.ts`
- New: `apps/server/src/services/slack-assistant-service.ts`
- New: `apps/server/src/lib/slack-signature.ts`
- New: `apps/server/src/services/slack-client.ts`
- `apps/server/src/index.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/providers/runtime-definitions.ts`
- `apps/server/src/lib/mcp-config.ts`
- `apps/server/src/services/spawner.ts`
- `docs/product/user-flows.md`
- `docs/development/setup.md`
- Slack-focused server tests under `apps/server/src/**/*.test.ts`

## Step-by-Step Plan
1. Confirm scope before implementation.
- Show this plan on issue #90.
- Wait for explicit approval before editing implementation files.
- Confirm whether v1 should support Codex only, Claude only, or a server default provider with role allowlist enforcement.

2. Add Slack username to profiles.
- Add an optional `slackUsername` field to shared user/profile types.
- Add a Postgres migration for the user Slack username.
- Update `UserStore` sanitize/update paths.
- Extend `/auth/profile` read/update schemas.
- Add a simple profile modal field for Slack username.
- Add focused tests for validation and persistence.

3. Add minimal Slack app configuration.
- Add a repository Slack integration section for bot credentials.
- Store the Slack bot token and signing secret as repository-scoped secrets or encrypted repository integration credentials.
- Return only configured/masked status to the UI; never return raw Slack credential values after save.
- Add a repo-scoped Slack events route, for example `POST /repositories/:id/slack/events` or another stable URL generated from the repository integration.
- Implement Slack signature verification using the repository's configured signing secret and Slack URL verification challenge handling.
- Ignore unsupported event types, bot messages, non-DM messages, and retries that have already been handled.

4. Resolve Slack users to Verft users.
- Normalize Slack usernames consistently with the profile field.
- Match incoming DM sender to an active Verft user.
- Reply with a setup message if no user matches.
- Do not expose whether arbitrary usernames exist outside the DM setup flow.

5. Create the Slack DM conversation store.
- Store one conversation record per Slack workspace/user pair.
- Store recent conversation turns and provider session metadata separately from tasks.
- Store active runtime/container metadata with `lastUserMessageAt`.
- Store enough context to resume naturally after idle container stop.
- Keep transcript retention bounded in v1.

6. Build a detached assistant runtime path.
- Add a runtime launcher that reuses provider runtime definitions and the unified toolbox image but does not require a repository or task workspace.
- Mount a small ephemeral workspace or assistant workspace, not a task workspace.
- Inject GitHub credentials and Verft MCP config.
- Provide system instructions that the assistant is for Slack DM coordination and information lookup, not automatic task execution.
- If the user asks to start an Verft task, route through the existing task creation path explicitly.

7. Connect Slack messages to runtime execution.
- On user DM, append the message to conversation state.
- Start or reuse the active runtime for that Slack DM conversation.
- Send the user message to the provider runtime.
- Capture assistant output and post it back to Slack.
- Handle provider errors with a concise Slack reply and server log details.

8. Implement 5-minute idle stop.
- Track the latest user message time for each active Slack DM runtime.
- Stop and remove the Docker container after 5 minutes without a new user message.
- Keep the conversation context after the runtime stops.
- Ensure a new incoming message starts a fresh runtime attached to the stored context.

9. Keep task workflows isolated.
- Do not create `Task`, `TaskRun`, task logs, checkpoints, or proposals for ordinary Slack chats.
- Use existing task APIs only when the user explicitly asks the bot to create/start a task.
- Add regression tests that a normal chat message does not create a task.

10. Add docs and operations notes.
- Document Slack app setup, repository Slack integration credential setup, event endpoint, profile username setup, and v1 behavior.
- Document that v1 does not map repositories or channels.
- Document that containers idle-stop after 5 minutes and conversations continue through persisted context.

11. Validate after approval and implementation.
- Run focused server tests for profile updates, Slack signature verification, event routing, conversation store, runtime lifecycle, and task isolation.
- Run `./scripts/harness/check-human-gated-flow.sh`.
- Run `./scripts/harness/check.sh`.
- Run `TEST_SCOPE=unit ./scripts/harness/test.sh`, then broader scopes if the environment supports Docker/browser tests.

## Human-Gated Flow Evidence
- Requirements Read: 2026-07-01 06:55 UTC - Read issue #90 and feedback comment at https://github.com/coretracker/verft/issues/90#issuecomment-4851167910.
- Requirements Understood: 2026-07-01 06:55 UTC - Create an implementation plan for the simplified Slack DM assistant MVP and show it before starting implementation.
- Requirements Updated: 2026-07-01 07:29 UTC - Read follow-up feedback that bot credentials should be configurable in the repository Slack integration section.
- Repository Research Complete: 2026-07-01 06:55 UTC - Reviewed profile routes/UI/types, user persistence/migrations, provider runtime definitions, spawner runtime setup, MCP config, existing execution plans, and confirmed no current Slack source files.
- Uncertainties Logged: 2026-07-01 06:55 UTC - Provider default for Slack DM, exact MCP identity model, transcript retention, and whether to use Slack user ID in addition to username need confirmation before implementation.
- Human Review Completed: 2026-07-01 07:39 UTC - Owner reviewed the plan thread and requested implementation start at https://github.com/coretracker/verft/issues/90#issuecomment-4851549424.
- User Approval To Start: 2026-07-01 07:39 UTC - Owner comment says `start implementation`.
- Baseline Checks Run: 2026-07-01 07:40 UTC - `./scripts/harness/doctor.sh` passed; initial `./scripts/harness/check.sh` needed dependency setup; `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh` installed dependencies but compose startup hit an existing local 5432 binding; rerun `./scripts/harness/check.sh` passed; `TEST_SCOPE=unit ./scripts/harness/test.sh` passed.
- Visible Task List Updated: 2026-07-01 06:55 UTC - Conversation task list updated while creating this plan.
- Task-Level Tests/Lint/Build: 2026-07-01 07:59 UTC - `./scripts/harness/check.sh`, `TEST_SCOPE=unit ./scripts/harness/test.sh`, and focused route/store tests passed.
- Task-Level Tests/Lint/Build: 2026-07-01 09:18 UTC - `npm run lint -w @verft/server` and focused Slack runtime/event tests passed after the next runtime slice.
- Task-Level Tests/Lint/Build: 2026-07-01 10:17 UTC - `npm run lint -w @verft/server`, `npm run lint -w @verft/web`, and focused Slack-agent MCP repository/runtime tests passed.
- Self Review Complete: 2026-07-01 07:59 UTC - Reviewed implementation against `docs/development/agent-review.md`; noted the detached Codex/Claude container runner and 5-minute idle stop remain follow-up work outside this first slice.
- Self Review Complete: 2026-07-01 09:18 UTC - Reviewed the next runtime slice against `docs/development/agent-review.md`; the implementation now launches a detached provider invocation per Slack message, persists provider/conversation state, injects user-scoped Verft MCP access, and marks stale runtime state stopped after 5 minutes idle.
- Self Review Complete: 2026-07-01 10:17 UTC - Reviewed the Slack-agent MCP slice against `docs/development/agent-review.md`; Verft MCP remains automatic and reserved, while repository Slack Integration can append extra MCP servers to Slack DM assistant runs.
- Code Review Complete: 2026-07-01 07:59 UTC - Reviewed Slack signature, credential storage, user matching, route behavior, repository UI, and docs changes.
- Final Verification Complete: 2026-07-01 07:59 UTC - Final `./scripts/harness/check.sh`, `TEST_SCOPE=unit ./scripts/harness/test.sh`, focused route/store tests, and `git diff --check` passed. `./scripts/harness/pr-ready.sh` passed doctor, human-gated, boundary, lint/typecheck, unit, and integration phases, then failed during e2e app boot because Docker could not mount the existing `deploy/nginx.conf` file into the nginx proxy container in this workspace.
- Final Verification Complete: 2026-07-01 09:20 UTC - `./scripts/harness/check-human-gated-flow.sh`, `./scripts/harness/check.sh`, `TEST_SCOPE=unit ./scripts/harness/test.sh`, focused Slack runtime/event tests, and `git diff --check` passed. `./scripts/harness/pr-ready.sh` passed doctor, human-gated, boundary, lint/typecheck, unit, and integration phases, then failed during e2e app boot because an existing local `verft` Redis container already owned host port 6379.
- Final Verification Complete: 2026-07-01 10:19 UTC - `./scripts/harness/check-human-gated-flow.sh`, `./scripts/harness/check.sh`, `TEST_SCOPE=unit ./scripts/harness/test.sh`, focused Slack-agent MCP tests, and `git diff --check` passed. `./scripts/harness/pr-ready.sh` passed doctor, human-gated, boundary, lint/typecheck, unit, and integration phases, then failed during e2e app boot because an existing local Postgres service already owned host port 5432.
- Security/Privacy Review Complete: 2026-07-01 07:59 UTC - Slack signing secrets and bot tokens remain write-only through repository APIs; Slack event route verifies timestamped signatures; unmatched users receive a generic setup reply.
- Docs/Changelog Updated: 2026-07-01 07:59 UTC - Added `docs/product/slack-dm-assistant.md` and linked it from product docs.

## Validation Commands
- `./scripts/harness/doctor.sh`
- `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `TEST_SCOPE=unit ./scripts/harness/test.sh`
- `node --import tsx --test apps/server/src/routes/slack-events.test.ts apps/server/src/routes/repositories.test.ts apps/server/src/services/repository-store.test.ts`
- `npm run lint -w @verft/server`
- `node --import tsx --test apps/server/src/routes/slack-events.test.ts apps/server/src/services/slack-assistant-service.test.ts apps/server/src/services/repository-store.test.ts`
- `node --import tsx --test apps/server/src/services/repository-store.test.ts apps/server/src/services/slack-assistant-service.test.ts apps/server/src/routes/repositories.test.ts`
- `git diff --check`
- `./scripts/harness/pr-ready.sh`
- `./scripts/harness/test.sh`
- Focused candidates after implementation:
- `node --import tsx --test apps/server/src/routes/slack-events.test.ts`

## Risks
- Matching by Slack username alone is simple but weaker than storing Slack user IDs; usernames can change and can collide across workspaces.
- Repository-scoped bot credentials make event routing simpler when each repository has its own event URL, but multiple repositories could still point at the same Slack app if operators duplicate credentials.
- Slack bot tokens and signing secrets must not leak through repository APIs, logs, task payloads, or MCP responses.
- A detached runtime path can drift from task runtime credential/MCP behavior if too much launch code is duplicated.
- Long-lived conversation context can accidentally retain sensitive data; transcript retention and visibility need a deliberate policy.
- Slack retry semantics can duplicate messages unless request IDs/event IDs are deduplicated.
- Runtime containers without repository mapping still need a safe workspace and clear permissions.
- Verft MCP access from the assistant must preserve user authorization and avoid turning a DM into an unbounded admin channel.
- A 5-minute idle stop is simple, but active provider work may need graceful completion or cancellation rules.

## Rollback Plan
- Disable the Slack events route through configuration.
- Clear or disable the repository Slack integration credentials.
- Keep `slackUsername` profile data harmless and unused if the runtime feature is disabled.
- Stop all active Slack assistant containers by label/name prefix.
- Leave normal task workflows untouched because the Slack assistant path is detached.

## Progress Log
- 2026-07-01 06:55 UTC: Reacted with eyes emoji on the implementation-plan request, confirmed branch is current with `origin/develop`, researched relevant profile/runtime/MCP paths, and created this plan for review before implementation.
- 2026-07-01 07:29 UTC: Added owner feedback that Slack bot credentials should be configured in the repository Slack integration section.
- 2026-07-01 07:39 UTC: Reacted with eyes emoji on the implementation-start request and marked the plan approved for implementation.
- 2026-07-01 07:59 UTC: Implemented the first slice: Slack username profile field, repository Slack credential configuration, signed Slack events route, Slack user matching, detached conversation persistence, Slack replies, product docs, and focused tests.
- 2026-07-01 07:59 UTC: Ran final validation and self-review; cleaned up the task-specific compose project after `pr-ready.sh` hit the local nginx bind-mount boot failure.
- 2026-07-01 09:18 UTC: Implemented the next runtime slice: Slack DM messages now run through the configured Codex/Claude runtime image in the background, receive persisted Slack conversation context, inject Verft MCP with a user-scoped personal access token, retain provider state across messages, and mark stale runtime state stopped after 5 minutes idle.
- 2026-07-01 09:20 UTC: Re-ran harness validation for the runtime slice. The required checks passed through unit/integration; only the local e2e app boot step in `pr-ready.sh` was blocked by an existing Redis process on host port 6379.
- 2026-07-01 10:17 UTC: Added configurable extra Slack agent MCP servers in the repository Slack integration section. Slack runtimes now always include automatic Verft MCP first and append configured extra Slack MCP servers without letting them override the reserved Verft server.
- 2026-07-01 10:19 UTC: Ran final validation for the Slack-agent MCP slice and removed the partial task-specific compose containers left by the local e2e port conflict.
- 2026-07-01 12:48 UTC: Migrated Slack integration to global Settings -> Integrations, switched Slack events handling to `/slack/events`, removed repository Slack configuration UI, and moved Slack runtime MCP extras/event status storage to system settings.

## Decisions
- 2026-07-01: Plan v1 as a detached Slack DM assistant, not as repository mapping or task workflow integration.
- 2026-07-01: Slack bot token/signing secret configuration belongs to a repository Slack integration section, while the DM assistant runtime remains detached from normal task workflows.
- 2026-07-01: Persist conversation context separately from runtime container lifetime; stop containers after 5 minutes idle.
- 2026-07-01: Reuse existing provider runtime definitions, credentials, and MCP serialization rather than creating Slack-specific provider integrations.
- 2026-07-01: Keep the v1 runtime simple by starting one provider invocation per Slack DM message, persisting provider state between runs, and acknowledging Slack events before the provider completes.
- 2026-07-01: Keep Verft MCP automatic and non-editable for Slack runs; expose only additional Slack agent MCP servers in repository Slack Integration.
- 2026-07-01: Move Slack credentials and extra Slack MCP server configuration from repository scope to global system settings so Slack DM assistant runs are detached from repository restrictions.

## Open Questions
- Should the next runtime slice use Codex by default, Claude by default, or the system default provider?
- Should each repository Slack integration use a unique Slack app/event URL, or should multiple repositories be allowed to share the same Slack bot credentials?
- Should the profile field store only Slack username, or also Slack workspace/user ID after first successful DM for better identity stability?
- What is the desired transcript retention policy for Slack DM conversations?
- Should Slack DM assistant access be gated by an existing permission scope, or should adding a Slack username be enough for v1?
- Should "start a task" from Slack be in the first implementation slice, or left as a follow-up after plain chat works?

## Completion Notes
- First implementation slice is complete.
- Next runtime slice is complete: Slack DM messages are handled by detached Codex/Claude provider invocations with persisted conversation/provider state and user-scoped Verft MCP access.
- Slack-agent MCP configuration slice is complete: extra MCP servers can be configured per repository Slack integration and are appended to automatic Verft MCP for Slack DM assistant runs.
- Global migration slice is complete: Slack credentials, event status, and extra Slack MCP server settings are now managed in Settings -> Integrations; Slack events use a global endpoint with a legacy repository URL alias for compatibility.
- Remaining follow-up work includes stronger Slack user identity binding, transcript retention policy, Slack retry deduplication, and explicit Slack-to-task creation flows.
