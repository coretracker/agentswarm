# PR Workflow

This page describes the expected pull request readiness flow for this repository.

## Recommended Sequence
1. Run `npm run ci`.
2. If checks pass, open a pull request and complete the PR template.

Note:
- `npm run ci` uses a single Node Docker container; it does not start Docker Compose.
- The CI script removes its container and image when it exits.
- `./scripts/harness/pr-ready.sh` remains as a compatibility wrapper for `npm run ci`.

## What `pr-ready.sh` checks
- Runs `npm run ci`.

## Current limitation
- This repository does not currently define a root format-check command.
- CI and the PR template currently require the Dockerized lint/test command only.

## TODO
- TODO: Add a canonical root format-check script if/when a formatter is adopted.
