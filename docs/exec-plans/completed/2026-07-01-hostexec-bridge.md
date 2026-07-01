# Execution Plan Draft

## Title
- Hostexec Bridge Commands For Agent Runtime Containers

## Goal
- Let repositories expose selected host macOS commands, such as `xcodebuild`, through bridge shims mounted into task and interactive terminal containers.
- Keep v1 strict: manual host daemon start, global Settings connection, per-repository command names, task-workspace `cwd`, no filesystem overwrite.

## Recommendation
- Implement a small hostexec bridge surface using existing settings, repository, and runtime launch patterns.
- Store daemon connection settings globally because there is one host daemon endpoint for the AgentSwarm deployment.
- Store command names per repository because tool exposure is repository-specific.
- Generate a per-run read-only shim directory and prepend it to `PATH`; do not mount over existing bin directories.

## Non-goals
- No automatic daemon installation or process management.
- No `launchd` work in v1.
- No arbitrary shell endpoint.
- No arbitrary host paths in repository config.
- No automatic host PATH forwarding.
- No support for task workspaces the host daemon cannot access.

## Current State
- Repository-level MCP settings already follow the desired storage/API/UI/runtime scoping model.
- Runtime task containers and interactive terminals already mount per-run payloads and workspace paths.
- The runtime image already includes small Node bridge scripts for internal AgentSwarm MCP; hostexec can follow the same runtime-image pattern.

## Acceptance Criteria
- Settings can store hostexec enabled flag, URL, and token/secret reference.
- Settings can check hostexec availability and show reachable capabilities.
- Repositories can store simple host command names.
- Runtime containers receive shims only for commands requested by the repository and allowed by daemon capabilities.
- Shims mount into a dedicated read-only directory, for example `/hostexec/bin`, and do not overwrite existing bin directories.
- PATH shadowing happens only for configured hostexec command names.
- Host commands execute on the host with the task workspace as `cwd`; nested workspace-relative cwd is preserved.
- The daemon/proxy rejects cwd paths that escape the task workspace.
- Build, ask, and interactive terminal containers use the same bridge behavior.
- Docs describe manual daemon start and workspace bind-path constraints.

## Step-by-Step Plan
1. Extend shared types for hostexec settings and repository host command names.
2. Add settings normalization/persistence and hostexec availability route.
3. Add repository command-name normalization/persistence/API schema.
4. Add web settings UI for hostexec connection and availability check.
5. Add repository editor UI for host command names.
6. Add runtime hostexec proxy client and Dockerfile copy.
7. Add server runtime helper to resolve daemon capabilities, create shim dirs, mount them read-only, and inject env/PATH.
8. Wire helper into task runs and interactive terminals.
9. Add focused tests for normalization, proxy behavior, and Docker env/mount generation.
10. Update docs and run verification.

## Human-Gated Flow Evidence
- Requirements Read: 2026-06-30 18:45 UTC - Owner requested implementation at https://github.com/coretracker/agentswarm/issues/91#issuecomment-4846882075 after plan discussion in issue #91.
- Requirements Understood: 2026-07-01 04:59 UTC - Implement strict v1 hostexec: manual daemon, Settings connection/check, per-repository command names, no bin overwrite, PATH shadowing only, task-workspace execution.
- Repository Research Complete: 2026-07-01 04:58 UTC - Reviewed shared types, repository/settings stores, routes, migrations, repository/settings UI, runtime Docker launch paths, interactive terminal path, and runtime bridge scripts.
- Uncertainties Logged: 2026-07-01 04:59 UTC - v1 assumes daemon exposes capabilities/health and exec HTTP endpoints; exact daemon implementation can be minimal and documented.
- Human Review Completed: 2026-06-30 18:45 UTC - Owner wrote "Start implementation".
- User Approval To Start: 2026-06-30 18:45 UTC - Owner wrote "Start implementation".
- Baseline Checks Run: 2026-06-30 18:47 UTC - `./scripts/harness/doctor.sh` passed; `./scripts/harness/check-human-gated-flow.sh` passed; initial `./scripts/harness/check.sh` failed because dependencies were not installed (`tsc` missing); `HARNESS_INSTALL_NPM_DEPS=1 ./scripts/harness/setup.sh` installed dependencies and built runtime image; rerun `./scripts/harness/check.sh` passed.
- Visible Task List Updated: 2026-06-30 18:45 UTC - Task list maintained in conversation plan.
- Task-Level Tests/Lint/Build: 2026-07-01 05:15 UTC - Focused hostexec/settings/repository/runtime tests passed; `./scripts/harness/check.sh` passed; `TEST_SCOPE=unit ./scripts/harness/test.sh` passed; `TEST_SCOPE=integration ./scripts/harness/test.sh` passed.
- Self Review Complete: 2026-07-01 05:15 UTC - Reviewed runtime/proxy/store/settings/UI/docs diff against strict v1 requirements and simplified redundant Docker host helper branch.
- Code Review Complete: 2026-07-01 05:15 UTC - Checked database placeholder ordering, route/store normalization, shim mount path, command allowlist flow, and workspace cwd guard.
- Final Verification Complete: 2026-07-01 05:15 UTC - `AGENTSWARM_UI_BASE_URL=http://172.18.0.1:3217 ./scripts/harness/test.sh` passed unit/integration and the first two Playwright smoke tests, then failed seeded-admin login against the already-running shared stack; default localhost e2e boot also cannot be used here because existing stack ports 3217/5432/6379 are already allocated.
- Security/Privacy Review Complete: 2026-07-01 05:15 UTC - Hostexec stores only token env var names, validates command names, uses daemon capabilities as the allowlist, mounts generated shims read-only, and rejects proxy cwd outside the task workspace before calling the daemon.
- Docs/Changelog Updated: 2026-07-01 05:15 UTC - Updated README, `.env.example`, and product user flows for manual daemon start, settings check, per-repository commands, workspace cwd, and non-overwriting shim mount behavior.

## Validation Commands
- `node --import tsx --test apps/server/src/lib/hostexec-config.test.ts`
- `node --import tsx --test apps/server/src/lib/hostexec-runtime.test.ts`
- `node --import tsx --test apps/server/src/services/repository-store.test.ts`
- `node --import tsx --test apps/server/src/services/settings-store.test.ts`
- `npm run lint -w @agentswarm/server`
- `npm run lint -w @agentswarm/web`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- Hostexec exposes privileged host behavior; v1 must keep the daemon allowlist authoritative and avoid arbitrary shell/path execution.
- Workspace path mapping only works when the host daemon can access the task workspace path.
- PATH shadowing can surprise users if they configure a command name that already exists in the container.

## Rollback Plan
- Remove hostexec settings fields and repository host command fields from runtime resolution.
- Stop mounting generated shim directories and stop copying the hostexec proxy into the runtime image.
- Leave unused database columns harmless until a later cleanup migration.

## Progress Log
- 2026-07-01 04:59 UTC: Created execution plan after baseline check and repository research.
- 2026-07-01 05:15 UTC: Implemented hostexec settings, repository command configuration, runtime shim/proxy mounting, docs, and focused tests.
- 2026-07-01 05:15 UTC: Removed failed temporary Docker stack artifacts from the first all-scope test attempt.
