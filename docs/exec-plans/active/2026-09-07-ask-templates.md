# Ask Templates

## Goal
- Add creator-owned Ask Templates with private, team, and global visibility.

## Acceptance Criteria
- Authorized users can create, share, version, restore, and use templates in the existing Ask form.
- Template access and management enforce the approved permission and ownership rules.
- Existing blank task creation remains unchanged.
- Template-based task creation always works on the selected existing branch.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Human Review Completed: YES
- User Approval To Start: YES
- Baseline Checks Run: YES (`npm run lint`)
- Task-Level Tests/Lint/Build: YES (`npm run lint`, `npm run test`, and `npm run build`)
- Self Review Complete: YES
- Final Verification Complete: YES (`npm run lint`, `npm run test`, `npm run build`, and `git diff --check`)

## Progress Log
- 2026-09-07: User approved implementation of the Ask Templates plan.
- 2026-09-07: Implemented Ask Template permissions, persistence, API, UI, rendering, sharing, and version history.
- 2026-09-07: Verified lint, tests, build, and patch formatting.
- 2026-09-07: Template-selected tasks now force the existing-branch strategy in the shared task definition builder.
