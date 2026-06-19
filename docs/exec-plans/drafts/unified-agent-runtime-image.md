# Unified Agent Runtime Image

## Title
- Use one Debian-based agent toolbox image for Codex, Claude, terminal, and common task tooling.

## Goal
- Replace the current provider-specific and terminal-specific official runtime images with one Docker image that contains Codex, Claude Code, Node/npm, Python, Git, GitHub CLI, Docker CLI, shell tools, and other task dependencies.
- Use that image for automated Codex runs, automated Claude runs, interactive Codex sessions, interactive Claude sessions, Codex utility runs, and terminal sessions.
- Make terminal mode open a full-access shell in a container started from the same image and mounted to the task workspace.
- Move from Alpine/Node base images to a Debian base image so native dependencies, `node-pty`, Playwright/browser dependencies, Claude Code, Codex, Python, and Docker tooling have a consistent runtime.
- Keep the official image surface intentionally small and rely on user-provided custom images for specialized tooling beyond the default toolbox.

## Non-goals
- Do not change provider selection, model selection, credentials storage, task lifecycle, checkpointing, or repository sync behavior.
- Do not weaken Docker socket access policy; Docker socket mounts remain controlled by `DOCKER_SOCKET_ACCESS_ENABLED` and provider policy.
- Do not make automated ask mode writable; ask mode should keep the workspace read-only.
- Do not remove human-gated checkpoint behavior.
- Do not solve production image publishing unless implementation scope is explicitly expanded.
- Do not maintain a broad catalog of specialized first-party runtime images.
- Do not bundle browser/E2E dependencies into the default toolbox unless a later implementation pass proves the size and rebuild cost are acceptable.

## Current State
- Automated Codex uses `agent-runtime-codex/Dockerfile`, image `agentswarm-agent-runtime-codex:latest`, and `agent-runtime-codex/run-task.mjs`.
- Automated Claude uses `agent-runtime-claude/Dockerfile`, image `agentswarm-agent-runtime-claude:latest`, and `agent-runtime-claude/run-task.mjs`.
- Interactive Codex uses `tools/codex-web-terminal/Dockerfile.codex`, image `local/codex-interactive:latest`.
- Interactive Claude uses `tools/codex-web-terminal/Dockerfile.claude`, image `local/claude-interactive:latest`.
- Git terminal uses `tools/codex-web-terminal/Dockerfile.git`, image `local/git-terminal:latest`, and a restricted wrapper path.
- `agentswarm.sh` builds five runtime/terminal images today.
- `apps/server/src/providers/runtime-definitions.ts` owns automated provider image names and build contexts.
- `apps/server/src/config/env.ts` owns interactive image names.
- `apps/server/src/lib/task-interactive-terminal.ts` selects terminal images and currently has different persistent state paths for Codex and Claude.
- `apps/server/src/services/codex-utility-service.ts` reuses the interactive Codex image for utility runs.
- `apps/server/src/services/spawner.ts` builds provider runtime images lazily and launches automated task containers.
- Baseline environment note: `./scripts/harness/doctor.sh` currently fails in this shell because `python3` is missing. The unified image should include `python3`.

## Acceptance Criteria
- One Debian-based Dockerfile builds a single image, for example `agentswarm-agent-toolbox:latest`.
- The image includes at least: `bash`, `sh`, `git`, GitHub CLI (`gh`), `openssh-client`, `curl`, `ca-certificates`, `ripgrep`, `vim`/`neovim`, `diffutils`, `python3`, `make`, `g++`, `node`, `npm`, Docker CLI, Codex CLI, and Claude Code CLI.
- Automated Codex and Claude task runs both use the unified image while preserving their existing provider-specific entry behavior.
- Interactive Codex and Claude sessions both use the unified image while preserving provider credentials, MCP config, persistent state, session resume, and model/profile behavior.
- Terminal mode uses the unified image and launches a full-access shell against the mounted task workspace.
- Runtime image configuration supports an operator-provided custom image for advanced deployments without requiring a new first-party Dockerfile.
- Playwright/browser E2E continues to use the existing dedicated Playwright image fallback unless explicitly configured otherwise.
- Runtime image build/warning paths build and check one primary toolbox image instead of separate Codex/Claude/interactive images.
- Documentation names the unified image and explains how to rebuild it.
- Documentation states the product security posture: AgentSwarm is an advanced developer tool, runtime image choice and mounted capabilities are operator responsibilities, and Docker socket access remains highly privileged.
- Documentation explains that `gh` is available in the toolbox image, but authentication must come from operator-provided credentials or repository/task configuration.
- Existing tests for runtime config, terminal behavior, Docker socket policy, and provider config pass.

## Affected Files
- `agent-runtime-codex/Dockerfile`
- `agent-runtime-claude/Dockerfile`
- `agent-runtime-codex/run-task.mjs`
- `agent-runtime-claude/run-task.mjs`
- New candidate: `agent-runtime/Dockerfile` or `agent-runtime-toolbox/Dockerfile`
- New candidate: `agent-runtime/run-task-codex.mjs` and `agent-runtime/run-task-claude.mjs`, or copied scripts in one context
- `tools/codex-web-terminal/Dockerfile.codex`
- `tools/codex-web-terminal/Dockerfile.claude`
- `tools/codex-web-terminal/Dockerfile.git`
- `tools/codex-web-terminal/README.md`
- `agentswarm.sh`
- `.env.example`
- `docs/development/setup.md`
- `docs/development/commands.md`
- `apps/server/src/providers/runtime-definitions.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/lib/task-interactive-terminal.ts`
- `apps/server/src/services/codex-utility-service.ts`
- `apps/server/src/services/spawner.ts`
- Runtime/terminal-related tests under `apps/server/src/lib/*.test.ts` and `apps/server/src/services/*.test.ts`

## Step-by-Step Plan
1. Confirm image semantics.
   - Decide final image tag and env var names, for example `AGENT_RUNTIME_IMAGE=agentswarm-agent-toolbox:latest`.
   - Remove the old restricted Git terminal image from the default path; terminal mode should use the full toolbox image.
   - Keep Playwright browser dependencies in the existing `PLAYWRIGHT_DOCKER_IMAGE` fallback rather than the default toolbox image.
   - Preserve image override configuration so operators can bring a custom image for specialized workflows.

2. Create the unified Debian image.
   - Base on Debian or a Debian-based Node image, preferably `node:20-bookworm` unless there is a reason to install Node manually.
   - Install system packages with `apt-get`.
   - Install GitHub CLI (`gh`) without baking any GitHub credentials into the image.
   - Install Docker CLI from Debian or Docker packages.
   - Install Codex globally with npm.
   - Install Claude Code using the existing install flow and verify `claude --version`.
   - Create any expected users/homes needed by current Codex and Claude state paths.
   - Copy both automated runtime entry scripts into the image.

3. Refactor runtime definitions.
   - Point both provider definitions at the unified image and context.
   - Add an explicit provider command/entrypoint so Codex runs still execute the Codex runner and Claude runs still execute the Claude runner.
   - Update `SpawnerService.ensureRuntimeImage` so the unified image is built once, not once per provider.
   - Keep provider-specific config generation and credential validation unchanged.

4. Refactor container launch arguments.
   - Update automated `docker run` assembly to pass provider-specific command args after the image if the unified image does not use one universal entrypoint.
   - Preserve workspace mount mode: read-only for ask, read-write for build.
   - Preserve provider state mounts and `TASK_PROVIDER_STATE_PATH` behavior.
   - Preserve MCP env, repository env files, Git env, and Docker socket mount policy.

5. Refactor interactive runtime image selection.
   - Replace `INTERACTIVE_RUNTIME_IMAGES.codex` and `.claude` with the unified image.
   - Replace `gitTerminal` image use for terminal mode with the unified image if full-access terminal mode is approved.
   - Update Codex/Claude interactive start scripts only where their assumptions conflict with the unified filesystem layout.
   - Standardize persistent home paths if practical, but avoid migrating existing state paths unless necessary.

6. Update Codex utility runner.
   - Point `executeCodexUtility` at the unified image.
   - Keep utility sandbox settings read-only and the ephemeral workdir behavior unchanged.

7. Update build scripts and docs.
   - Simplify `agentswarm.sh` to build one runtime toolbox image.
   - Update warnings and build hints to mention the unified image.
   - Update setup/commands docs and terminal README to remove stale image-specific instructions.
   - Add `.env.example` overrides if the unified image tag should be user-configurable.
   - Document that AgentSwarm is intended for experienced developers/operators and that runtime image contents, mounted secrets, Docker socket access, and repository permissions are part of the operator security boundary.

8. Add or update tests.
   - Test provider definitions map both providers to the unified image but preserve provider config names and credential behavior.
   - Test terminal availability/build hints for the unified image.
   - Test automated runtime launch args include provider-specific command/entry behavior.
   - Run shell syntax checks for runtime scripts and Dockerfile smoke checks where practical.

9. Validate.
   - Run baseline checks before implementation after approval.
   - Build the unified image.
   - Run focused unit tests for runtime definitions, terminal, Docker socket access, and spawner launch args.
   - Run `./scripts/harness/check.sh`.
   - Run `TEST_SCOPE=unit ./scripts/harness/test.sh`, then broader scopes if environment supports Docker/browser tests.

## Human-Gated Flow Evidence
- Requirements Read: YES
- Requirements Understood: YES
- Repository Research Complete: YES
- Uncertainties Logged: YES
- Human Review Completed: YES
- User Approval To Start: TODO
- Baseline Checks Run: PARTIAL - `./scripts/harness/doctor.sh` failed because `python3` is missing in this shell.
- Visible Task List Updated: TODO
- Task-Level Tests/Lint/Build: TODO
- Self Review Complete: TODO
- Code Review Complete: TODO
- Final Verification Complete: TODO
- Security/Privacy Review Complete: TODO
- Docs/Changelog Updated: TODO

## Validation Commands
- `./scripts/harness/doctor.sh`
- `./scripts/harness/check-human-gated-flow.sh`
- `docker build -f agent-runtime/Dockerfile -t agentswarm-agent-toolbox:latest agent-runtime`
- `node --check agent-runtime-codex/run-task.mjs`
- `node --check agent-runtime-claude/run-task.mjs`
- `npm run build -w @agentswarm/server`
- `npm run build -w @agentswarm/web`
- `TEST_SCOPE=unit ./scripts/harness/test.sh`
- `./scripts/harness/check.sh`
- `./scripts/harness/test.sh`

## Risks
- A single image increases size and rebuild time; keeping browser dependencies in the Playwright fallback limits that growth.
- Combining Codex and Claude in one filesystem can expose assumptions around `HOME`, user IDs, writable state directories, and executable locations.
- Claude installation has historically needed native compatibility packages; Debian should reduce Alpine-specific issues but still needs verification.
- Full-access terminal mode is less restrictive than the current Git terminal image. This is an intentional product/security decision for an advanced developer tool, and documentation must make the operator responsibility explicit.
- If Docker CLI and Docker socket access are present in every runtime image, socket mount policy must remain the real enforcement point.
- GitHub CLI in the image increases the impact of mounted GitHub credentials or broad repository permissions; this is acceptable for the advanced-tool posture but must be explicit in docs.
- Existing running tasks or persisted provider states may assume old home paths.
- Supporting custom images shifts more compatibility and security responsibility to operators; docs should distinguish first-party supported defaults from user-owned images.

## Rollback Plan
- Keep the existing provider-specific Dockerfiles and image constants until the unified flow is verified.
- If the unified image fails for one provider, restore provider definitions and interactive image constants to the previous provider-specific images.
- Re-run `./agentswarm.sh rebuild` with the old image build functions restored.
- No database migration should be required.

## Progress Log
- 2026-06-19 07:39 UTC: Researched runtime Dockerfiles, interactive terminal flow, provider runtime definitions, Codex utility runner, build script, and docs. Created draft plan.
- 2026-06-19 08:18 UTC: Captured product decision to continue with one full-access toolbox image, avoid a broad first-party image catalog, keep Playwright in a dedicated fallback image, and document operator-owned security responsibilities.

## Decisions
- 2026-06-19: Draft plan recommends one Debian-based toolbox image for provider and terminal runtimes.
- 2026-06-19: Use a small first-party image surface: one default toolbox image plus the existing dedicated Playwright/browser fallback, with custom images for specialized user needs.
- 2026-06-19: Treat full-access terminal mode as the default product direction; do not keep the restricted Git terminal image in the default runtime path.
- 2026-06-19: Make runtime image and mounted capability security an explicit operator responsibility in product/docs.
- 2026-06-19: Include GitHub CLI (`gh`) in the default toolbox image, with authentication supplied only at runtime by operator-controlled credentials.

## Completion Notes
- TODO
