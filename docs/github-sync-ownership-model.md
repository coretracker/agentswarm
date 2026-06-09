# GitHub Sync Ownership Model (MVP)

## Goal
Make GitHub sync behavior predictable by defining exactly which system is authoritative for each field and how conflicts are resolved.

## Models Compared

### 1) `github_authoritative`
- GitHub is the source of truth for synced fields.
- Internal edits to synced fields are treated as temporary and will be overwritten by incoming GitHub events.

Pros:
- Matches what users already expect from GitHub.
- Lower risk of drift for issue state/metadata.

Cons:
- Internal edits may appear to "disappear" unless clearly marked as local-only.
- Requires good webhook reliability.

### 2) `internal_authoritative`
- Internal task system is the source of truth for synced fields.
- GitHub changes are informational and do not automatically override internal state.

Pros:
- Full control inside the product.
- Works even when GitHub data is delayed.

Cons:
- High drift risk from GitHub.
- Harder to explain for GitHub-first teams.

### 3) `hybrid_sync`
- Ownership differs by field (some GitHub-owned, some internal-owned).
- Bidirectional updates are allowed only for explicitly shared fields.

Pros:
- Flexible and practical for mixed workflows.
- Preserves internal workflow while staying aligned with GitHub metadata.

Cons:
- More rules to explain.
- Needs clear UI audit trail.

## Recommended MVP Default
Use `hybrid_sync` as default, with strict per-field ownership.

Reason:
- It minimizes user surprise in day-to-day use.
- It avoids forcing all behavior into a single system.
- It supports current webhook/import flows and allows gradual expansion.

## Source-of-Truth Mapping (MVP)

| Field | Source of Truth | Direction | Notes |
|---|---|---|---|
| GitHub issue/PR number, URL | GitHub | GitHub -> internal | Immutable link fields after task creation. |
| Title (imported task title) | Internal | Internal -> GitHub (optional later) | Internal title can diverge; show "custom title" badge if changed. |
| Status/state | Internal (execution), GitHub (issue/PR lifecycle) | Bidirectional with mapping rules | Internal run status and GitHub open/closed are related but not identical. |
| Labels | GitHub (for GitHub-prefixed labels), Internal (for internal-prefixed labels) | Bidirectional by namespace | Reserve `gh:*` for GitHub mirror, `as:*` for internal-only labels. |
| Comments | Dual ownership by origin | Bidirectional append-only | Never edit/delete remote comments during MVP sync. |
| Assignee | Internal | Internal -> GitHub (optional later) | Keep assignment stable for internal permission model. |
| Description/body snapshot | GitHub at import time | GitHub -> internal (manual refresh only) | Treated as imported context, not live-synced text. |

## Conflict Resolution Rules

### Status
- Maintain a mapping table:
  - GitHub `open` -> internal `open` (or keep current running state if actively executing).
  - GitHub `closed` -> internal `done` only if task is not running.
- If internal task is running and GitHub closes issue/PR:
  - Keep internal state unchanged.
  - Add sync alert: `GitHub closed while task running`.
  - Ask user to resolve with explicit action (`stop`, `complete`, or `reopen on GitHub`).

### Labels
- Namespace labels:
  - `gh:*` labels are GitHub-owned mirrors and are overwritten by latest GitHub payload.
  - `as:*` labels are internal-owned and never overwritten by GitHub.
- If same semantic label exists in both systems without prefix:
  - Convert during sync to `gh:<name>` to prevent future ambiguity.

### Comments
- Append-only sync for MVP:
  - GitHub comments import as external entries with source metadata.
  - Internal comments sync out only when user marks them as "publish to GitHub".
- Never mutate existing comment content across systems in MVP.
- On duplicate detection (same source id), keep first and skip duplicates.

## Fallback When Systems Disagree

1. Detect disagreement by field (`status`, `labels`, `comments`) and record timestamp/source.
2. Apply deterministic winner based on mapping table above.
3. Store a sync event log entry with:
   - field
   - local value
   - remote value
   - winning value
   - rule used
4. Surface a plain-language UI notice:
   - Example: `GitHub label set won for gh:* labels at 2026-05-21 14:00 UTC.`
5. If no rule safely applies, do not auto-merge:
   - mark as `needs_manual_resolution`
   - keep both values visible
   - provide one-click user choice

## UX Transparency Requirements
- Every sync-driven overwrite must show:
  - what changed
  - which system won
  - why (rule name)
  - when it happened (UTC timestamp)
- Users should always be able to filter history by `sync events`.
- Avoid hidden automatic edits; all automatic conflict outcomes must be auditable.

## Task-to-GitHub Status Mapping (Issue #22)

### Scope
- This mapping controls when internal task status changes create GitHub updates (labels and comments).
- Goal: useful progress signals with low noise.

### Repo-Level Switch
- Add optional repository setting: `sync_status_enabled` (default: `false`).
- If `sync_status_enabled=false`:
  - no automatic status label updates are sent to GitHub
  - no automatic status comments are sent to GitHub
  - manual user comments can still be posted when explicitly requested
- If `sync_status_enabled=true`:
  - apply the milestone-only policy below

### GitHub Labels Used for Status
- Use exactly one active label from:
  - `as:queued`
  - `as:in-progress`
  - `as:blocked`
  - `as:done`
- On change, remove the previous `as:*` status label and apply the new one.

### Milestone-Only Posting Policy
- Post only on meaningful milestones:
  - work started
  - blocked waiting on input/dependency
  - unblocked and resumed
  - completed
  - failed/cancelled with clear outcome
- Do not post for routine churn:
  - retries
  - step-level progress
  - short-lived state flips
  - background sync-only adjustments

### Internal Status -> GitHub Action Mapping

| Internal Transition | Update GitHub Label | Post GitHub Comment | Comment Template (short) |
|---|---|---|---|
| `queued -> in_progress` | `as:in-progress` | Yes | `Work started.` |
| `in_progress -> blocked` | `as:blocked` | Yes | `Work blocked: <reason>.` |
| `blocked -> in_progress` | `as:in-progress` | Yes | `Work resumed after unblock.` |
| `in_progress -> done` | `as:done` | Yes | `Work completed.` |
| `in_progress -> failed` | keep `as:in-progress` or set `as:blocked` (team choice) | Yes | `Work stopped: <failure summary>.` |
| `in_progress -> cancelled` | keep current or set `as:queued` (team choice) | Yes | `Work cancelled.` |
| `queued -> cancelled` | `as:queued` (unchanged) | No | n/a |
| `queued -> queued` | none | No | n/a |
| `in_progress -> in_progress` | none | No | n/a |
| `blocked -> blocked` | none | No | n/a |
| `done -> done` | none | No | n/a |

### Transitions That Must Not Post Updates
- Any transition where source and destination are the same.
- Automatic retry state changes that return to the same milestone stage.
- Internal-only housekeeping transitions (for example: scheduler rebalance, worker handoff).
- Bulk backfill/import reconciliation updates.
- Any status change while `sync_status_enabled=false`.

### Sample Timeline: Issue Flow
1. Issue imported -> task created as `queued` (no comment posted).
2. Agent begins work -> set `as:in-progress`; post `Work started.`
3. Missing requirement found -> set `as:blocked`; post `Work blocked: waiting for acceptance criteria.`
4. User provides answer -> set `as:in-progress`; post `Work resumed after unblock.`
5. Work completes -> set `as:done`; post `Work completed.`

### Sample Timeline: PR Flow
1. PR imported -> task `queued` (no comment posted).
2. Agent starts edits -> `as:in-progress`; post `Work started.`
3. CI failure blocks merge -> `as:blocked`; post `Work blocked: CI failing on test suite.`
4. Fix applied and CI passes -> `as:in-progress`; post `Work resumed after unblock.`
5. PR ready/merged -> `as:done`; post `Work completed.`
