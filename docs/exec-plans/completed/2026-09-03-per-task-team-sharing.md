# Execution Plan: Per-Task Team Sharing

## Title

- Add opt-in team visibility to tasks.

## Goal

- Make teammate access conditional on an owner-controlled `Share with team` flag while preserving user-level permissions and repository access checks.

## Non-goals

- Team roles, team-owned tasks, new permission scopes, or a separate sharing persistence model.

## Current State

- Team membership currently makes every repository-accessible task from teammates visible through one centralized task-ownership predicate.
- Tasks are persisted as JSON in Redis or PostgreSQL, and the task UI already has shared creation fields and an Info tab.

## Acceptance Criteria

- Existing and new tasks default to private; owners and admins retain access.
- Shared tasks are accessible to same-team users only with repository access and the required task scopes.
- Owners and admins can change sharing through REST, MCP, creation UI, and the task Info tab.
- Revocation removes stale teammate UI state and ends any active task terminal.
- Documentation and focused authorization, persistence, realtime, MCP, and UI coverage are updated.

## Affected Files

- Shared task types and realtime payloads.
- Server task ownership, storage, REST/MCP tools, realtime authorization, and tests.
- Web task creation/detail components, API client/hooks, stories/tests, and product documentation.

## Step-by-Step Plan

1. Run baseline `npm run ci` and record the result.
2. Add and normalize the task sharing field, then enforce it in centralized access and filtered listing.
3. Add owner/admin REST and MCP mutations, immediate terminal revocation, and realtime stale-view removal.
4. Add the creation and task Info switches with unassigned-user guidance and revocation confirmation.
5. Update documentation and focused tests.
6. Run focused checks, builds, Storybook, final `npm run ci`, self-review, and diff checks.
7. Move this plan to completed, commit, and push the current branch.

## Human-Gated Flow Evidence

- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES; resolved in the approved plan.
- Human Review Completed: YES
- User Approval To Start: YES; explicit implementation request received 2026-09-03.
- Baseline Checks Run: YES — `npm run ci` in the Linux Docker gate.
- Visible Task List Updated: YES; this execution plan is the task list.
- Task-Level Tests/Lint/Build: YES — server build, web/server type checks, lint, Storybook build, and Linux CI run.
- Self Review Complete: YES
- Code Review Complete: YES
- Final Verification Complete: YES
- Security/Privacy Review Complete: YES — sharing is enforced by the centralized task predicate and revocation emits no private task payload.
- Docs/Changelog Updated: YES

## Validation Commands

- `npm run test -w @verft/server`
- `npm run test -w @verft/web`
- `npm run build -w @verft/server`
- `npm run build -w @verft/web`
- `npm run build-storybook -w @verft/web`
- `npm run ci`
- `git diff --check`

## Risks

- Realtime revocation must remove stale task state without sending the now-private task payload.
- Revocation ends any active terminal because current terminal sessions are task-scoped rather than user-attributed.
- Existing tasks become private because absent JSON fields normalize to `false`.

## Rollback Plan

- Revert the feature commit; existing task JSON remains backward compatible because older code ignores the additional field.

## Progress Log

- 2026-09-03: Requirements, repository research, product decisions, and human approval completed; implementation started.
- 2026-09-03: Implemented and verified task-level team sharing; ready to commit.

## Decisions

- 2026-09-03: Existing and new tasks default private.
- 2026-09-03: Only task owners and admins may change sharing.
- 2026-09-03: Creation and task Info surfaces expose the option.
- 2026-09-03: Unsharing immediately terminates an active task terminal.

## Completion Notes

- Added opt-in task sharing with private defaults, centralized authorization and query filtering, REST/MCP controls, realtime removal, terminal revocation, UI controls, docs, and focused tests.
