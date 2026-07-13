# Create-or-Queue Task API

Use `POST /api/tasks/create-or-queue` when an external system should create a Verft task if one does not exist, or queue a follow-up message on the existing task for the same external target.

This endpoint is intended for CI jobs, GitHub Actions, custom bots, and other automation that should act as a Verft user. It uses a Verft personal access token.

## Authentication

Create a personal access token from your Verft profile with these scopes:

- `repo:read` or `repo:list`
- `task:edit`
- `task:create` when `task.createIfMissing` is not `false`
- `task:build` for build messages, or `task:ask` for ask messages

Send it as a bearer token:

```bash
Authorization: Bearer <verft_pat>
```

## Request

```json
{
  "repoId": "repo_123",
  "target": {
    "type": "github_pr",
    "id": "123"
  },
  "task": {
    "title": "Fix PR #123 CI",
    "message": "npm run ci failed. Fix it.\n\nLogs: https://github.com/acme/repo/actions/runs/123456",
    "action": "build",
    "baseBranch": "feature-branch",
    "workOnBranch": true,
    "createIfMissing": true
  },
  "dedupeKey": "github-actions:acme/repo:123456:1:test"
}
```

Fields:

| Field | Purpose |
| --- | --- |
| `repoId` | Verft repository id. |
| `target.type` | External target kind, for example `github_pr`, `github_issue`, `linear_issue`, or `ci_check`. Lowercase letters, numbers, `_`, and `-` only. |
| `target.id` | External target id. Calls with the same `repoId`, `target.type`, and `target.id` continue the same task. |
| `task.title` | Title to use when a task must be created. Optional; defaults to `type:id`. |
| `task.message` | Initial prompt for new tasks and follow-up message for existing tasks. |
| `task.action` | `build` or `ask`. Defaults to `build`. |
| `task.baseBranch` | Branch to start from when creating a task. |
| `task.workOnBranch` | Set `true` to work directly on `baseBranch`; otherwise Verft creates a feature branch. |
| `task.createIfMissing` | Defaults to `true`. Set `false` to only queue on an existing task. |
| `dedupeKey` | Optional idempotency key. Reusing it returns the existing message instead of queueing a duplicate. |

For `target.type` values `github_pr` and `github_issue`, Verft also checks existing tasks linked with the older GitHub PR/issue fields, then records the generic target link for future calls.

## Response

Accepted:

```json
{
  "taskId": "task_123",
  "messageId": "msg_123",
  "createdTask": true,
  "queuedMessage": true,
  "deduped": false
}
```

Duplicate:

```json
{
  "taskId": "task_123",
  "messageId": "msg_123",
  "createdTask": false,
  "queuedMessage": false,
  "deduped": true
}
```

Useful status codes:

| Status | Meaning |
| --- | --- |
| `202` | Request accepted. A task was created/continued, or the message was deduped. |
| `400` | Request shape is invalid. |
| `401` | Missing or invalid PAT. |
| `403` | PAT user is missing a required scope or repository access. |
| `404` | Repository not found, task not visible, or `createIfMissing=false` and no task exists. |
| `409` | Task cannot be changed right now, for example an active terminal session. |

## Curl Test

Use the public Verft base URL. Local Docker/nginx defaults to `http://localhost:3217`.

```bash
export VERFT_URL="http://localhost:3217"
export VERFT_PAT="asw_pat_..."
export VERFT_REPO_ID="repo_123"

curl -fsS "$VERFT_URL/api/tasks/create-or-queue" \
  -H "Authorization: Bearer $VERFT_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "repoId": "'"$VERFT_REPO_ID"'",
    "target": {
      "type": "github_pr",
      "id": "123"
    },
    "task": {
      "title": "Fix PR #123 CI",
      "message": "Smoke test from create-or-queue API.",
      "action": "build",
      "baseBranch": "main",
      "workOnBranch": false,
      "createIfMissing": true
    },
    "dedupeKey": "manual-smoke-test:github_pr:123:1"
  }'
```

Run the same command twice. The second response should have `"deduped": true`.

## GitHub Actions Example

Store these repository secrets:

- `VERFT_URL`, for example `https://verft.example.com`
- `VERFT_PAT`
- `VERFT_REPO_ID`

```yaml
name: Verft CI feedback

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        id: tests
        continue-on-error: true
        run: npm run ci

      - name: Queue Verft task
        if: steps.tests.outcome == 'failure'
        env:
          VERFT_URL: ${{ secrets.VERFT_URL }}
          VERFT_PAT: ${{ secrets.VERFT_PAT }}
          VERFT_REPO_ID: ${{ secrets.VERFT_REPO_ID }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_BRANCH: ${{ github.head_ref }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          DEDUPE_KEY: github-actions:${{ github.repository }}:${{ github.run_id }}:${{ github.run_attempt }}:${{ github.job }}
        run: |
          curl -fsS "$VERFT_URL/api/tasks/create-or-queue" \
            -H "Authorization: Bearer $VERFT_PAT" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
              --arg repoId "$VERFT_REPO_ID" \
              --arg pr "$PR_NUMBER" \
              --arg branch "$HEAD_BRANCH" \
              --arg runUrl "$RUN_URL" \
              --arg dedupeKey "$DEDUPE_KEY" \
              '{
                repoId: $repoId,
                target: { type: "github_pr", id: $pr },
                task: {
                  title: ("Fix PR #" + $pr + " CI"),
                  message: ("CI failed. Fix the failure.\n\nRun: " + $runUrl),
                  action: "build",
                  baseBranch: $branch,
                  workOnBranch: true,
                  createIfMissing: true
                },
                dedupeKey: $dedupeKey
              }')"
```
