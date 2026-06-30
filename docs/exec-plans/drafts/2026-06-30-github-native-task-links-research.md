# GitHub Native Task Links Research

Issue: #88

## Summary

AgentSwarm already has most of the internal data model and webhook plumbing needed to link GitHub issues and pull requests to tasks:

- Tasks expose `githubIssueNumber` and `githubPrNumber`.
- The task detail page can show and manually edit linked issue and PR numbers.
- GitHub webhook handling can create tasks from unlinked issue or PR activity, then patch the new task with the source issue or PR number.
- Follow-up issue and PR comments are de-duplicated through task message `externalId` values such as `github:issue_comment:<id>` and `github:pr_comment:<id>`.

The remaining work is mostly product semantics and edge-case hardening: define when webhook activity should create a new link, update an existing task link, or reject an ambiguous match.

## Current Repository Findings

Relevant implementation points:

- `apps/server/src/routes/github-pr-webhooks.ts`
  - Handles `issue_comment`, `issues`, `pull_request`, `pull_request_review`, and `pull_request_review_comment` webhook events.
  - Differentiates issue comments from PR comments using the issue payload's `pull_request` property.
  - Uses `findTaskByGitHubIssueNumber` and `findTaskByGitHubPrNumber` before creating a task.
  - Creates issue-origin tasks with `branchStrategy: "feature_branch"` and `githubIssueNumber`.
  - Creates PR-origin tasks with `branchStrategy: "work_on_branch"` and `githubPrNumber`.
  - Posts a task-created GitHub issue comment with an `agentswarm-task-created:<taskId>` marker when credentials are available.
  - Can archive linked tasks when a `pull_request.closed` webhook reports `merged: true` and repository auto-archive is enabled.
- `apps/server/src/services/task-store.ts`
  - Persists `githubIssueNumber`, `githubPrNumber`, task message `queueSource`, and task message `externalId`.
  - Implements lookups by repository plus linked GitHub issue or PR number.
- `apps/server/src/routes/tasks.ts`
  - Exposes manual task endpoints for updating the linked issue and linked pull request.
- `apps/web/components/task-detail-page.tsx`
  - Shows linked GitHub issue and PR URLs derived from the repository URL and stored number.
  - Provides UI actions to link, edit, or clear the issue and PR numbers.
- `packages/shared-types/src/index.ts`
  - Includes task link fields and GitHub queue source types in shared DTOs.

## GitHub Platform Notes

GitHub's `issue_comment` event is shared by issues and pull requests; PR comments can be identified by checking whether the issue payload includes `pull_request`.

Every pull request is also an issue in GitHub's REST model, so shared actions such as timeline comments use Issues endpoints, while review comments use Pull Request Review Comment endpoints.

GitHub's native issue-to-PR relationship is usually produced by references or closing keywords in the PR body or commit messages, for example `Closes #88`. A task-created comment can create a backlink in GitHub's timeline, but it is not the same as GitHub's PR "linked issue" relationship.

References:

- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
- https://docs.github.com/rest/issues/comments
- https://docs.github.com/rest/pulls/pulls
- https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls

## Recommended Product Scope

1. Treat webhook-origin issue and PR numbers as first-class task links.
   - Keep `githubIssueNumber` and `githubPrNumber` as the canonical internal link fields.
   - Keep `queueSource` and `externalId` for event-level idempotency, not as the main link model.
2. Add explicit link provenance.
   - Record whether the link was created manually, from an issue webhook, from a PR webhook, or from PR creation/postflight.
   - This helps explain why a task is linked and supports safer future reconciliation.
3. Add branch/PR backfill when AgentSwarm creates or pushes a PR.
   - If a task opens a GitHub PR, store the resulting PR number on the task.
   - If the task was created from an issue, include a normal issue reference or closing keyword in the PR body so GitHub can show the native PR-to-issue relationship.
4. Add a GitHub timeline backlink to task-created comments.
   - The default task-created comment already supports `{{task_url}}`; keep this as the human-visible AgentSwarm link.
   - Continue appending the hidden marker for duplicate prevention.
5. Define ambiguity behavior.
   - If a webhook references a GitHub number already linked to an active task, route feedback to that task.
   - If more than one active task can plausibly match, do not auto-link; post or log a clear ambiguity message.
   - Archived tasks should not silently absorb new actionable feedback unless the repository setting explicitly allows it.

## Proposed Acceptance Criteria

- Issue-created, issue-comment, PR-comment, PR-review, and review-request webhook paths all create or reuse a task with the expected `githubIssueNumber` or `githubPrNumber`.
- Manual links remain editable and clearable from task detail.
- PR creation from an issue-linked task records `githubPrNumber` and includes a GitHub-recognized issue reference in the PR body.
- GitHub task-created comments include the AgentSwarm task URL and keep the hidden duplicate marker.
- Duplicate webhook delivery does not create duplicate task messages or duplicate task-created comments.
- Tests cover issue comments on issues versus PRs, PR review comments, review requests, merged PR auto-archive, and link backfill after PR creation.

## Open Questions

- Should AgentSwarm use a non-closing reference such as `Refs #88`, or a closing keyword such as `Closes #88`, when creating PRs for issue-linked tasks?
- Should a new comment on a linked but archived task reopen the task, create a follow-up task, or ask for confirmation on GitHub?
- Should task-created comments be posted on both issues and PRs by default, or should PR-origin tasks rely only on PR review/status comments?
