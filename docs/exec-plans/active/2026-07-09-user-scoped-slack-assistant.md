# User-Scoped Slack Assistant

## Title
- User-scoped, repository-independent Slack assistant

## Goal
- Allow an active Verft user linked by Slack user ID to maintain one long-lived Slack DM assistant session, select provider/model/effort, use policy-controlled MCP tools, inspect audit logs, and explicitly clear the session.

## Non-goals
- Do not model assistant conversations as tasks.
- Do not attach repositories or task workspaces to assistant runtimes.
- Do not change existing repository-channel Slack task behavior.
- Do not expose unrestricted MCP, network, filesystem, credentials, or administrative capabilities.

## Current State
- Global Slack credentials and `/slack/events` already support repository-channel task creation.
- User profiles support GitHub identity and provider defaults, but no Slack user ID.
- A previous detached Slack DM assistant implementation exists in Git history and was removed; its runtime and event handling can inform the new implementation.
- Provider runtimes, personal access tokens, MCP serialization, and normalized agent events already exist.

## Acceptance Criteria
- Active users can store a unique Slack user ID and configure provider/model/effort.
- Authorized direct messages route to a user-scoped assistant without creating a task.
- One active session per user persists until explicit clearing.
- Messages, responses, provider state, and tool events are auditable from the user's profile.
- Admin settings control feature access, provider/model/MCP allowlists, runtime limits, and retention.
- Assistant runtimes have no repository mount and enforce user plus administrator permissions.
- Existing repository Slack task behavior remains covered by regression tests.

## Affected Files
- `packages/shared-types/src/index.ts`
- `apps/server/src/db/migrations.ts`
- `apps/server/src/services/user-store.ts`
- `apps/server/src/services/app-stores.ts`
- `apps/server/src/services/create-postgres-stores.ts`
- `apps/server/src/services/settings-store.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/routes/users.ts`
- `apps/server/src/routes/settings.ts`
- `apps/server/src/routes/slack-webhooks.ts`
- `apps/server/src/index.ts`
- `apps/web/components/profile-page.tsx`
- `apps/web/components/settings-page.tsx`
- New assistant session store, orchestration service, API routes, and tests.
- Slack setup and product documentation.

## Step-by-Step Plan
1. Add Slack identity and assistant preference contracts, persistence, validation, uniqueness, and profile/admin controls.
2. Add assistant session/message/run/event schema and a user-authorized store with clear-session semantics.
3. Split signed Slack DM routing from existing repository-channel routing; add retry deduplication and quick acknowledgement.
4. Add detached provider execution with no repository mount, persisted provider state, serialized messages, and policy-controlled MCP.
5. Add profile audit/session APIs and UI; add admin access, runtime, MCP, cost, and retention settings.
6. Add focused security, isolation, recovery, concurrency, and existing-flow regression tests.
7. Update documentation, complete self-review, and run full CI.

## Human-Gated Flow Evidence
- Requirements Read: 2026-07-09 UTC - Read the full Slack thread requirements and requested configuration/integration plans.
- Requirements Understood: 2026-07-09 UTC - Separate user-scoped assistant domain, Slack-ID access, Claude/Codex plus MCP, persistent session, profile audit logs, and explicit clear.
- Repository Research Complete: 2026-07-09 UTC - Reviewed current Slack webhook, user/settings stores, migrations, runtime boundaries, and the removed historical Slack assistant.
- Uncertainties Logged: 2026-07-09 UTC - Exact retention defaults and initial MCP allowlist are policy choices; implementation will use conservative defaults and explicit administrator controls.
- Human Review Completed: 2026-07-09 UTC - User reviewed the strict plan and integration sequence in the Slack thread.
- User Approval To Start: 2026-07-09 UTC - User replied `Start`.
- Baseline Checks Run: 2026-07-09 UTC - Canonical `npm run ci` could not access Docker and the documented remote runner was unavailable. Host fallback `npm ci --include=dev`, `npm run lint`, `npm run build`, and `npm test` passed (200 server and 34 web tests); Node 20 emitted an engine warning for a Node 22 dependency.
- Visible Task List Updated: 2026-07-09 UTC - Implementation task list published in the task conversation.
- Task-Level Tests/Lint/Build: TODO
- Self Review Complete: TODO
- Code Review Complete: TODO
- Final Verification Complete: TODO
- Security/Privacy Review Complete: TODO
- Docs/Changelog Updated: TODO

## Validation Commands
- `npm run ci`
- Focused server route/store tests for user identity, Slack routing, assistant sessions, and runtime policy.
- Focused web tests for profile and administrator settings.
- `git diff --check`

## Risks
- Slack user IDs must be unique and workspace-aware to prevent identity confusion.
- MCP tools can mutate external systems; allowlists and user authorization must be enforced server-side.
- Persistent transcripts may contain secrets; redaction, access control, and bounded retention are required.
- Slack retries and concurrent messages can duplicate or reorder provider work.
- Reusing historical code without adapting current global Slack and runtime architecture could regress repository task flows.

## Rollback Plan
- Disable the assistant feature flag while leaving repository Slack task routing active.
- Stop assistant runtimes and revoke assistant-created personal access tokens.
- Retain or purge assistant audit records according to configured retention.
- Remove assistant routes/UI without changing task records or repository configuration.

## Progress Log
- 2026-07-09 UTC: User approved implementation. Researched current architecture and historical implementation; created execution plan.
- 2026-07-09 UTC: Completed host baseline lint, build, and tests. Canonical Docker CI remains an environment limitation.

## Decisions
- 2026-07-09: Use Slack workspace ID plus Slack user ID as external identity; never mutable Slack username.
- 2026-07-09: Keep assistant sessions separate from tasks and repositories.
- 2026-07-09: Use invocation-per-message with persisted context rather than resident containers for the first release.
- 2026-07-09: Administrator policy is an upper bound; user choices cannot expand permissions.

## Completion Notes
- TODO
