# Global And Repository Harness Merge

## Title
- Add a global harness and merge it with repository harness guidance.

## Goal
- Let administrators define global agent harness guidance and combine it with repository-specific guidance for every task runtime.

## Non-goals
- Changing provider-native instruction discovery or replacing repository `AGENTS.md` files.
- Adding override or conflict-resolution semantics beyond deterministic concatenation.

## Current State
- Repositories store six harness sections and task workspaces receive a generated `.verft-runtime/harness.md`.
- System settings do not expose equivalent global harness fields.

## Acceptance Criteria
- Global Settings persist and expose all six harness sections.
- Settings UI supports editing global harness guidance.
- Runtime harness markdown contains populated global sections before populated repository sections.
- Empty global and repository guidance produces no runtime harness file.
- Tests cover normalization, persistence, rendering, and merging.
- Product/development documentation describes precedence and behavior.

## Affected Files
- Shared settings types, settings storage/migrations, Settings UI, task spawner, tests, and documentation.

## Step-by-Step Plan
1. Extend shared types and both settings-store implementations with normalized global harness fields.
2. Add PostgreSQL columns through an additive migration.
3. Add a global Harness settings tab using the repository harness section model.
4. Refactor runtime markdown generation to merge global then repository guidance.
5. Add focused tests and update documentation.
6. Run CI, self-review, and final verification.

## Human-Gated Flow Evidence
- Requirements Read: 2026-07-09 UTC - Read the Slack request and repository operating guide.
- Requirements Understood: 2026-07-09 UTC - Global and repository harnesses must coexist and produce one merged runtime harness.
- Repository Research Complete: 2026-07-09 UTC - Located repository fields, Settings stores/UI, runtime materialization, migrations, and tests.
- Uncertainties Logged: 2026-07-09 UTC - Proposed global-first concatenation; user approved implementation.
- Human Review Completed: 2026-07-09 UTC - User received the implementation plan and merge-order assumption.
- User Approval To Start: 2026-07-09 UTC - User replied “Start implementation”.
- Baseline Checks Run: 2026-07-09 UTC - `npm run ci` was attempted and blocked because Docker is unavailable; local dependencies were then installed for focused checks.
- Visible Task List Updated: 2026-07-09 UTC - Tool-visible task plan created.
- Task-Level Tests/Lint/Build: 2026-07-09 UTC - Server/web type checks, full build, 200 server tests, 34 web tests, and 25 focused settings/spawner tests passed.
- Self Review Complete: 2026-07-09 UTC - Completed `docs/development/agent-review.md`; acceptance criteria, boundaries, normalization, empty-state behavior, and documentation verified.
- Code Review Complete: 2026-07-09 UTC - Reviewed final diff for settings partial updates, PostgreSQL placeholder ordering, global-first output, access controls, and generated file lifecycle.
- Final Verification Complete: 2026-07-09 UTC - Build/tests, `git diff --check`, and human-gated flow check passed; Dockerized `npm run ci` remains unavailable in this workspace.
- Security/Privacy Review Complete: 2026-07-09 UTC - Harness content uses existing settings authorization and contains no new secret handling or logging.
- Docs/Changelog Updated: 2026-07-09 UTC - Updated product user flows with global authoring and merge semantics.

## Validation Commands
- `npm run ci`
- Focused server settings/spawner tests
- Focused web tests
- `./scripts/harness/check-human-gated-flow.sh`
- `git diff --check`

## Risks
- Existing PostgreSQL deployments require additive migration coverage.
- Partial settings updates must retain global harness values.
- Labels must make global-first merge semantics clear to administrators.

## Rollback Plan
- Revert the additive UI/runtime/type changes; leaving nullable database columns is harmless, or remove them in a later explicit migration.

## Progress Log
- 2026-07-09 UTC: Research and human approval completed; implementation started.
- 2026-07-09 UTC: Global storage/UI and merged runtime output implemented and verified.

## Decisions
- 2026-07-09: Global guidance is emitted first and repository guidance second; neither silently overrides the other.
- 2026-07-09: Reuse the six existing harness categories for consistent authoring.

## Completion Notes
- Global harness guidance is stored with system settings and edited through a dedicated Settings tab.
- Runtime output deterministically contains global guidance before repository guidance.
- Dockerized CI could not run because the local Docker socket is unavailable; equivalent local lint/build/test stages passed.
