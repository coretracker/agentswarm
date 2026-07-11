# issue_comment.edited Webhook Plan

## Title
- Respect GitHub `issue_comment.edited` mention triggers with duplicate protection.

## Goal
- Allow edited GitHub issue and PR conversation comments to trigger Verft when the edited body mentions the configured integration bot.
- Keep duplicate protection so a comment that already created or queued task feedback is not processed again after subsequent edits.

## Non-goals
- Do not change handling for review comments, review submissions, review requests, or issue body events.
- Do not alter GitHub webhook signature validation, allowed-user filtering, bot-user filtering, or task start orchestration.

## Current State
- Issue #78 reports that `issue_comment.edited` is not respected and should be checked for bot mentions with a duplicate check.
- `normalizeGitHubFeedback` currently ignores all `issue_comment` events unless `action === "created"`.
- The same normalizer handles both issue comments and PR conversation comments because GitHub PR comments arrive as `issue_comment` events with `issue.pull_request` present.
- Required bot mention filtering happens later in `registerGitHubPrWebhookRoutes` using the normalized comment body.
- Duplicate protection already checks existing task messages by `externalId`. Issue comments use `github:issue_comment:<comment id>` and PR conversation comments use `github:pr_comment:<comment id>`.

## Acceptance Criteria
- A GitHub `issue_comment` webhook with `action: "edited"` and an issue comment body that mentions the configured integration bot can create or queue issue feedback when all existing repository filters pass.
- A GitHub `issue_comment` webhook with `action: "edited"` and a PR conversation comment body that mentions the configured integration bot can create or queue PR feedback when all existing repository filters pass.
- If the same comment was already processed from either `created` or a prior `edited` event, later `edited` deliveries return the existing duplicate response and do not append a second task message.
- Existing behavior for `issue_comment.created` remains unchanged.
- Empty comment bodies, bot senders, disallowed users, and missing required mentions remain ignored.

## Affected Files
- `apps/server/src/routes/github-pr-webhooks.ts`
- `apps/server/src/routes/github-pr-webhooks.test.ts`
- `docs/product/user-flows.md` if behavior documentation should explicitly mention edited comments.

## Step-by-Step Plan
1. Update `normalizeGitHubFeedback` so `issue_comment` accepts `created` and `edited`, while preserving the existing payload shape checks.
2. Keep the existing external IDs unchanged for comment events so duplicate detection remains comment-ID based across created and edited deliveries.
3. Add route tests for edited PR conversation comments with required bot mention enabled.
4. Add route tests for edited issue comments with required bot mention enabled.
5. Add duplicate regression coverage showing an edited delivery for an already recorded comment external ID returns `{ queued: false, reason: "duplicate" }` and does not append another message.
6. Run the targeted webhook route test, then the harness checks required by the repo workflow.
7. Update product docs only if reviewers want the edited-comment trigger documented as user-facing behavior.

## Human-Gated Flow Evidence
- Requirements Read: done - issue #78 and the issue comment were read on 2026-06-30.
- Requirements Understood: done - requested output is research plus this plan, not an implementation yet.
- Repository Research Complete: done - webhook normalization, mention filtering, and duplicate handling were traced.
- Uncertainties Logged: done - documentation update is optional because existing docs only summarize GitHub integration at a high level.
- Human Review Completed: done - user said "Contine" on 2026-06-30 after the plan was present.
- User Approval To Start: done - implementation proceeded after that approval.
- Baseline Checks Run: done - `./scripts/harness/doctor.sh` passed; focused webhook route test passed before code changes after dependencies were installed.
- Visible Task List Updated: done - this active execution plan records the proposed task list.
- Task-Level Tests/Lint/Build: done - targeted route test, unit test scope, integration test scope, and `./scripts/harness/check.sh` passed.
- Self Review Complete: done - reviewed diff against `docs/development/agent-review.md`.
- Code Review Complete: done - self-review found no behavior outside `issue_comment.created|edited` normalization and related tests/docs.
- Final Verification Complete: done - full PR-ready/e2e stack startup was not run because an existing `verft-redis-1` container owns host port 6379; local doctor/check/unit/integration verification passed.
- Security/Privacy Review Complete: done - webhook signature validation, bot-user filtering, allowed-user filtering, and token handling were unchanged.
- Docs/Changelog Updated: done - product user flow notes now mention created or edited issue/PR conversation comment processing.

## Validation Commands
- `node --import tsx --test apps/server/src/routes/github-pr-webhooks.test.ts`
- `./scripts/harness/check-human-gated-flow.sh`
- `./scripts/harness/check.sh`
- `TEST_SCOPE=unit ./scripts/harness/test.sh`
- `./scripts/harness/pr-ready.sh`

## Risks
- Edited comments can be noisy if the repository does not require bot mentions, but the stable comment-ID duplicate check should suppress edits after the first accepted delivery.
- A comment that was ignored on `created` because it lacked a mention can later be accepted on `edited`; this is the intended behavior for issue #78.
- GitHub may redeliver webhooks, so duplicate handling must remain based on the stable comment ID rather than delivery ID.

## Rollback Plan
- Revert the normalizer action change and the added tests. Existing `issue_comment.created` behavior should continue because it is already covered by current tests.

## Progress Log
- 2026-06-30 10:59 UTC: Researched issue #78, confirmed current code drops `issue_comment.edited`, and documented the implementation plan.
- 2026-06-30 11:14 UTC: Implemented edited `issue_comment` handling, added PR and issue regression tests with duplicate coverage, and updated product docs.
- 2026-06-30 11:24 UTC: Verification passed for focused webhook route tests, `doctor.sh`, `check-human-gated-flow.sh`, `check.sh`, `TEST_SCOPE=unit ./scripts/harness/test.sh`, and `TEST_SCOPE=integration ./scripts/harness/test.sh`; full setup/start is blocked by host port 6379 already in use by an existing `verft-redis-1` container.

## Decisions
- 2026-06-30: Treat `created` and `edited` comment deliveries as the same feedback identity by keeping the existing comment-ID-based external IDs.

## Completion Notes
- Implemented. `issue_comment.edited` now follows the same feedback normalization path as `issue_comment.created`, preserving stable comment-ID external IDs for duplicate suppression.
- Added regression coverage for edited PR conversation comments, edited issue comments, and duplicate suppression for both target types.
- Updated product documentation for created/edited issue and pull request conversation comment processing.
