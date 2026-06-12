# Execution Plan

## Title
- AgentSwarm MCP Server Phase 1

## Goal
- Implement Phase 1 of the AgentSwarm MCP server: personal access token authentication, repository discovery, task discovery, draft/start/follow-up task operations, and auto-apply toggling.

## Non-goals
- No checkpoint apply/reject/revert tools in Phase 1.
- No push/merge/archive tools in Phase 1.
- No prompt attachment upload support in Phase 1.
- No server-side summarize task tool in Phase 1.
- No direct database/store access from MCP clients.

## Current State
- Refined draft lives at `docs/exec-plans/drafts/agentswarm-mcp-server.md`.
- The backend has cookie/session auth only.
- Existing HTTP routes already enforce most task/repository policies.
- There is no MCP endpoint or personal access token storage.

## Acceptance Criteria
- Users can create, list, and revoke personal access tokens through authenticated HTTP routes.
- Users can generate or regenerate their MCP personal access token from the Profile modal, with the raw token shown only once.
- Personal access tokens are stored hashed at rest and authenticate bearer requests.
- MCP endpoint supports `initialize`, `tools/list`, and `tools/call`.
- Phase 1 tools are available: list repositories, list tasks, get task, create task, update draft, start task, add task message, update auto-apply config.
- MCP tools enforce existing user/scopes/repository/task access restrictions.
- MCP task creation/start returns promptly while repository checkout continues, with `executionStatus: "preparing"` visible to UI and MCP clients.
- Large MCP responses are bounded/truncated.
- Existing web/API behavior remains unchanged.

## Affected Files
- `apps/server/src/db/migrations.ts`
- `apps/server/src/lib/auth.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/index.ts`
- `apps/server/src/services/*`
- `apps/server/src/mcp/*`
- `apps/web/components/app-shell.tsx`
- `apps/web/src/api/client.ts`
- `packages/shared-types/src/index.ts`
- Server tests and docs as needed.

## Step-by-Step Plan
1. Add personal access token persistence, hashing, create/list/revoke routes, and bearer authentication.
2. Add minimal HTTP MCP endpoint and tool registry.
3. Implement Phase 1 read tools.
4. Implement Phase 1 write tools using existing task/repository policy.
5. Add focused tests and documentation.
6. Run focused verification and update this plan.

## Human-Gated Flow Evidence
- Requirements Read: Yes
- Requirements Understood: Yes
- Repository Research Complete: Yes
- Uncertainties Logged: Yes
- Human Review Completed: Yes
- User Approval To Start: Yes
- Baseline Checks Run: Yes; focused task-store, scheduler, and server lint passed before implementation
- Visible Task List Updated: Yes
- Task-Level Tests/Lint/Build: Focused MCP/token/task/scheduler/start-orchestrator tests passed; server and web TypeScript lint passed
- Self Review Complete: Yes
- Code Review Complete: Agent self-review only
- Final Verification Complete: Focused verification complete; full harness not run in this pass
- Security/Privacy Review Complete: Yes; PATs are hashed at rest, raw token returned once, bearer auth reuses scoped user identity
- Docs/Changelog Updated: README updated

## Validation Commands
- `node --import tsx --test apps/server/src/lib/task-start-orchestrator.test.ts apps/server/src/mcp/tools.test.ts apps/server/src/services/scheduler.test.ts`
- `node --import tsx --test apps/server/src/mcp/tools.test.ts apps/server/src/services/personal-access-token-store.test.ts apps/server/src/services/task-store.test.ts apps/server/src/services/scheduler.test.ts`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `git diff --check`
- `./scripts/harness/check-human-gated-flow.sh`

## Risks
- Bearer token auth could bypass existing task/repository access if it does not reuse `AuthService`.
- MCP tool handlers could drift from HTTP route policy if route logic is copied too broadly.
- MCP response payloads can exceed client context if truncation is incomplete.
- Minimal JSON-RPC MCP support may need later replacement with an official SDK transport.

## Rollback Plan
- Disable or remove MCP route registration.
- Disable bearer token authentication path.
- Keep token table only until tokens are revoked/cleaned up, or revert migration before release.

## Progress Log
- 2026-06-12 09:44 UTC: Started Phase 1 implementation after user approval.
- 2026-06-12 10:18 UTC: Added personal access token persistence/auth/routes, minimal HTTP JSON-RPC MCP endpoint, Phase 1 tools, focused tests, and README documentation.
- 2026-06-12 10:24 UTC: Focused MCP/token/task/scheduler tests passed; server and web TypeScript lint passed; whitespace and human-gated flow checks passed.
- 2026-06-12 10:55 UTC: Added Profile modal UI for generating/regenerating the MCP personal access token and showing the raw token only once.
- 2026-06-12 11:40 UTC: Added non-blocking task start for MCP/UI create-start flows and exposed checkout as `executionStatus: "preparing"`.

## Decisions
- 2026-06-12: Implement minimal HTTP JSON-RPC MCP endpoint without adding an SDK dependency in this pass.
- 2026-06-12: Personal access tokens are required before MCP tools are exposed.

## Completion Notes
- Implemented Phase 1 MCP server at `POST /mcp` with `initialize`, `tools/list`, and `tools/call`.
- Implemented Phase 1 tools: repository listing, task listing/detail, task creation, draft update, task start, task message/follow-up, and auto-apply config update.
- Added personal access token create/list/revoke routes under `/auth/personal-access-tokens`; token values are returned only at creation and stored as hashes.
- Personal access token management is available in the Profile modal for the default MCP token; lower-level token metadata remains available through the API.
- Start/create-start requests now return while workspace checkout continues; clients should poll or subscribe for task updates instead of keeping the MCP tool call open until the agent run finishes.
