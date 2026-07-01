# Slack DM Assistant MVP

## Title
- Slack DM Assistant MVP

## Goal
- Implement the first Slack integration slice as a simple 1:1 assistant conversation detached from normal task workflows.
- Let a user add their Slack username to their profile, start a DM with the bot, and chat with a Codex or Claude runtime that can use GitHub plus AgentSwarm MCP as information sources.
- Let repository owners configure Slack bot credentials in a repository Slack integration section.
- Stop the runtime container after 5 minutes of user inactivity, then start a new runtime attached to the same Slack conversation context when the user writes again.
- Reuse existing profile, provider runtime, credentials, MCP, and container lifecycle systems wherever practical.

## Non-goals
- No repository-to-Slack mapping in v1.
- No Slack channel workflow in v1.
- No Slack thread task workflow in v1.
- No automatic AgentSwarm task creation from Slack messages.
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
- AgentSwarm MCP exists at `POST /mcp` with personal access token authentication and task/repository tools.
- Repository MCP configuration exists for task and interactive terminal runtimes, but this MVP should not require a repository mapping.
- Repository settings already own repository-scoped integration-style configuration, so Slack bot credentials should be configured from a repository Slack integration section instead of global system settings or deployment-only env vars.
- Normal task lifecycle, checkpointing, and queueing are task-centric and should remain separate from Slack DM assistant chats.

## Acceptance Criteria
- Users can save a Slack username in their profile.
- The Slack username is persisted, returned in profile/session data where needed, and validated with a simple Slack-handle-compatible format.
- Repository owners can configure Slack bot credentials in a repository Slack integration section.
- Slack bot credentials are stored securely, masked on read, and can be cleared or rotated.
- AgentSwarm can receive Slack DM events from the configured repository Slack bot endpoint.
- Incoming Slack DM messages are matched to an AgentSwarm user by Slack username.
- If no matching active user exists, the bot replies with a short setup message and does not start a provider runtime.
- A matched user can chat with the bot in 1:1 Slack DMs without selecting a repository.
- The DM assistant runtime receives instructions that it is an informational assistant and must use GitHub plus AgentSwarm MCP as sources where relevant.
- The DM assistant runtime can call AgentSwarm MCP using the matched user's identity or a clearly scoped equivalent token.
- The DM assistant runtime is detached from normal task workflows; no `Task` is created unless the user explicitly asks for one.
- A per-user Slack DM conversation context persists across idle runtime restarts.
- The active runtime container stops after 5 minutes without a new user Slack message.
- When the same user writes again after idle stop, AgentSwarm starts a new runtime attached to the same Slack DM conversation context.
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
- New candidate: `apps/server/src/routes/slack.ts`
- New candidate: `apps/server/src/services/slack-assistant-store.ts`
- New candidate: `apps/server/src/services/slack-assistant-runtime.ts`
- New candidate: `apps/server/src/lib/slack-signature.ts`
- New candidate: `apps/server/src/lib/slack-message-format.ts`
- New candidate: `apps/server/src/services/slack-client.ts`
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

4. Resolve Slack users to AgentSwarm users.
- Normalize Slack usernames consistently with the profile field.
- Match incoming DM sender to an active AgentSwarm user.
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
- Inject GitHub credentials and AgentSwarm MCP config.
- Provide system instructions that the assistant is for Slack DM coordination and information lookup, not automatic task execution.
- If the user asks to start an AgentSwarm task, route through the existing task creation path explicitly.

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
- Requirements Read: 2026-07-01 06:55 UTC - Read issue #90 and feedback comment at https://github.com/coretracker/agentswarm/issues/90#issuecomment-4851167910.
- Requirements Understood: 2026-07-01 06:55 UTC - Create an implementation plan for the simplified Slack DM assistant MVP and show it before starting implementation.
- Requirements Updated: 2026-07-01 07:29 UTC - Read follow-up feedback that bot credentials should be configurable in the repository Slack integration section.
- Repository Research Complete: 2026-07-01 06:55 UTC - Reviewed profile routes/UI/types, user persistence/migrations, provider runtime definitions, spawner runtime setup, MCP config, existing execution plans, and confirmed no current Slack source files.
- Uncertainties Logged: 2026-07-01 06:55 UTC - Provider default for Slack DM, exact MCP identity model, transcript retention, and whether to use Slack user ID in addition to username need confirmation before implementation.
- Human Review Completed: TODO - Awaiting owner review of this plan on issue #90.
- User Approval To Start: TODO - Do not start implementation until the owner explicitly approves.
- Baseline Checks Run: TODO - Deferred until implementation is approved.
- Visible Task List Updated: 2026-07-01 06:55 UTC - Conversation task list updated while creating this plan.
- Task-Level Tests/Lint/Build: TODO - No implementation yet.
- Self Review Complete: TODO - Complete after implementation work, not for this plan-only checkpoint.
- Code Review Complete: TODO - Complete after implementation work.
- Final Verification Complete: TODO - Complete after implementation work.
- Security/Privacy Review Complete: TODO - Required before implementation completion because Slack signatures, user identity matching, provider credentials, and MCP auth are in scope.
- Docs/Changelog Updated: TODO - Product/development docs should be updated during implementation.

## Validation Commands
- `./scripts/harness/doctor.sh`
- `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `TEST_SCOPE=unit ./scripts/harness/test.sh`
- `./scripts/harness/test.sh`
- Focused candidates after implementation:
- `node --import tsx --test apps/server/src/routes/auth.test.ts`
- `node --import tsx --test apps/server/src/routes/slack.test.ts`
- `node --import tsx --test apps/server/src/services/slack-assistant-store.test.ts`
- `node --import tsx --test apps/server/src/services/slack-assistant-runtime.test.ts`

## Risks
- Matching by Slack username alone is simple but weaker than storing Slack user IDs; usernames can change and can collide across workspaces.
- Repository-scoped bot credentials make event routing simpler when each repository has its own event URL, but multiple repositories could still point at the same Slack app if operators duplicate credentials.
- Slack bot tokens and signing secrets must not leak through repository APIs, logs, task payloads, or MCP responses.
- A detached runtime path can drift from task runtime credential/MCP behavior if too much launch code is duplicated.
- Long-lived conversation context can accidentally retain sensitive data; transcript retention and visibility need a deliberate policy.
- Slack retry semantics can duplicate messages unless request IDs/event IDs are deduplicated.
- Runtime containers without repository mapping still need a safe workspace and clear permissions.
- AgentSwarm MCP access from the assistant must preserve user authorization and avoid turning a DM into an unbounded admin channel.
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

## Decisions
- 2026-07-01: Plan v1 as a detached Slack DM assistant, not as repository mapping or task workflow integration.
- 2026-07-01: Slack bot token/signing secret configuration belongs to a repository Slack integration section, while the DM assistant runtime remains detached from normal task workflows.
- 2026-07-01: Persist conversation context separately from runtime container lifetime; stop containers after 5 minutes idle.
- 2026-07-01: Reuse existing provider runtime definitions, credentials, and MCP serialization rather than creating Slack-specific provider integrations.

## Open Questions
- Should v1 use Codex by default, Claude by default, or the system default provider?
- Should each repository Slack integration use a unique Slack app/event URL, or should multiple repositories be allowed to share the same Slack bot credentials?
- Should the profile field store only Slack username, or also Slack workspace/user ID after first successful DM for better identity stability?
- What is the desired transcript retention policy for Slack DM conversations?
- Should Slack DM assistant access be gated by an existing permission scope, or should adding a Slack username be enough for v1?
- Should "start a task" from Slack be in the first implementation slice, or left as a follow-up after plain chat works?

## Completion Notes
- TODO - This plan is waiting for human review and approval before implementation starts.
