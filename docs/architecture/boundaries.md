# Boundaries

This repository uses lightweight, mechanical boundary checks through:
- `scripts/harness/boundary-check.mjs`

## Why boundaries matter
- The web app and server run in different environments.
- Shared types should stay stable and reusable.
- Clear boundaries reduce accidental coupling and make agent changes safer.

## Enforced rules

### Rule 1: Web must not import server code
- Forbidden: any file under `apps/web` importing from `apps/server`.
- Reason: browser code cannot depend on backend internals.
- Fix: move shared logic to `packages/shared-types` or call server APIs.

### Rule 2: Server must not import web code
- Forbidden: any file under `apps/server` importing from `apps/web`.
- Reason: backend services should not depend on UI implementation.
- Fix: move shared contracts to `packages/shared-types` or keep logic in server modules.

### Rule 3: `packages/shared-types` must not import from apps
- Forbidden: any file under `packages/shared-types` importing from `apps/*`.
- Reason: shared contracts should stay dependency-free across app layers.
- Fix: remove app-specific logic from shared-types.

### Rule 4: Apps must use package import for shared types
- Forbidden: files under `apps/web` or `apps/server` importing shared-types by filesystem path.
- Required: import shared types from `@verft/shared-types`.
- Reason: package imports enforce a stable public boundary.
- Fix: replace relative path import with package import.

### Rule 5: No deep imports from shared-types package
- Forbidden: `@verft/shared-types/...` deep paths.
- Required: import from `@verft/shared-types` root export only.
- Reason: deep imports bypass public package boundaries.
- Fix: use root package export.

## Violation output contract
Every boundary violation error prints:
1. what rule was broken
2. why the rule exists
3. how to fix it
4. which doc to read (`docs/architecture/boundaries.md`)

## Commands
- Run only boundary checks: `node ./scripts/harness/boundary-check.mjs`

## CI
- Boundary checks are not part of the current lint/test-only CI gate.
