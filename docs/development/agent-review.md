# Agent Self-Review Checklist

Use this checklist before finalizing any non-trivial change.

## 1) Acceptance Criteria
- [ ] Confirm the implemented change matches the requested acceptance criteria.
- [ ] Confirm no required behavior was skipped.

## 2) Test Coverage
- [ ] Confirm tests cover the changed behavior.
- [ ] Confirm at least one failure path or edge case is covered when relevant.
- [ ] If tests were not added, explain why.

## 3) Documentation Updates
- [ ] Confirm docs were updated for any behavior, command, or workflow change.
- [ ] If docs were not updated, confirm no user-facing or operator-facing behavior changed.

## 4) Architecture Boundaries
- [ ] Confirm web/server/shared boundaries are respected.
- [ ] Confirm no forbidden imports or layering violations were introduced.

## 5) Errors and Logs
- [ ] Confirm errors are understandable to humans (clear message and context).
- [ ] Confirm logs are useful for debugging (especially startup/failure paths).

## 6) Security and Privacy
- [ ] Confirm no new secret exposure risk was introduced.
- [ ] Confirm auth/access controls are unchanged or intentionally updated.
- [ ] Confirm sensitive data is not logged unnecessarily.

## 7) Simpler Alternatives
- [ ] Confirm the chosen solution is no more complex than needed.
- [ ] Confirm at least one simpler alternative was considered.

## 8) Maintainability
- [ ] Confirm generated/edited code is readable and consistent with repository patterns.
- [ ] Confirm naming, structure, and comments are maintainable for future agents.

## Review Note Template
Use this short note in PRs or task summaries:
- Acceptance criteria: pass/fail + reason
- Tests: what was run and coverage notes
- Docs: what was updated
- Boundaries: pass/fail
- Errors/logs: pass/fail
- Security/privacy: pass/fail
- Simpler alternative considered: yes/no
- Maintainability: pass/fail
