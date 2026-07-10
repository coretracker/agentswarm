# Task Lifecycle and Product Model

Tasks are Verft’s central product object. A task ties together a user prompt, repository, provider/runtime settings, workspace, messages, runs, logs, Git state, and optional review checkpoint.

Primary evidence: `docs/product/terminology.md`, `docs/product/user-flows.md`, `packages/shared-types/src/index.ts`, `apps/server/src/routes/tasks.ts`, `apps/server/src/services/scheduler.ts`, `apps/server/src/services/spawner.ts`, `apps/server/src/services/task-store.ts`, and `apps/web/components/task-detail-page.tsx`.

## Domain concepts

### Task

`Task` in `packages/shared-types/src/index.ts` includes:

- identity and ownership: `id`, `ownerUserId`, `creatorName`, parent/root task IDs;
- repository context: `repoId`, `repoName`, `repoUrl`, default/base branch, feature branch/work-on-branch strategy, linked PR/issue/Slack thread;
- execution config: `taskType`, `provider`, `providerProfile`, `modelOverride`, Codex credential source;
- state dimensions: `status`, `workflowStatus`, `executionStatus`, `executionAction`, `reviewReason`, `hasPendingCheckpoint`, active terminal flags;
- outputs: messages, logs, runs, branch diff, result markdown, change proposals, Git counts/state.

The state model intentionally separates user-visible workflow (`backlog`, `ready`, `in_progress`, `review`, `done`, `archived`) from execution (`idle`, `queued`, `preparing`, `running`, `failed`, `cancelled`). This lets the UI show Kanban state while preserving runtime state.

### Task types

- **Build** (`taskType: "build"`): agent may change files. Successful changes can become pending checkpoints/change proposals.
- **Ask** (`taskType: "ask"`): agent answers/inspects without producing a change proposal; runtime workspace access is read-oriented.
- **Draft**: saved task definition before runnable task creation/start.
- **Snippet task**: task created from reusable prompt template and variables.

### Repository configuration

`Repository` includes Git URL/default branch plus runtime capabilities: env vars/secrets, env file secrets, MCP servers, host commands, GitHub integration templates/filters, Slack integration templates, harness guidance fields, and default provider/model/effort fallback settings (`packages/shared-types/src/index.ts`, `apps/server/src/services/repository-store.ts`).

## Create and start flow

The new task flow in `docs/product/user-flows.md` maps to these implementation steps:

1. Web task form builds a definition in `apps/web/components/task-definition-fields.tsx` and `apps/web/src/utils/task-definition-submit.ts`.
2. API client posts to `/tasks` using `apps/web/src/api/client.ts`.
3. `apps/server/src/routes/tasks.ts` validates `createTaskSchema`, checks auth/repository capabilities, persists prompt attachments, resolves provider defaults, and creates the task.
4. `beginTaskStart` / `orchestrateTaskStart` in `apps/server/src/lib/task-start-orchestrator.ts` prepares workspace startup behavior and calls `SchedulerService.triggerAction` when the task should run immediately.
5. `TaskStore` creates the durable task. Draft tasks start as `status: "draft"`; runnable tasks start open/ready with queued execution state when scheduled.

Prompt attachments are limited by shared constants: max 6 attachments, max 6 MiB each, max 20 MiB total (`TASK_PROMPT_ATTACHMENT_*` in `packages/shared-types/src/index.ts`).

## Queueing and execution

`apps/server/src/services/scheduler.ts` owns queue decisions:

- refuses archived/draft/busy tasks;
- blocks when a pending change proposal exists;
- blocks when an interactive terminal session is active;
- marks a task queued in Postgres and stores/replaces a Redis queue entry;
- drains every second and when relevant state changes;
- respects `settings.maxAgents` through an in-memory active count.

When a queued entry runs, the scheduler calls `SpawnerService.runTask(task, action, input, promptMessageId)`. `SpawnerService` then:

- prepares/clones/checks out the task workspace;
- configures Git identity, branch, locks, linked workspaces, and safe path rules;
- materializes runtime payloads, provider config, repository env/secrets, harness guidance, and MCP config;
- mounts the workspace, runtime payloads, provider state, optional Docker socket, hostexec shims, and Verft base state;
- starts a Docker container using the unified toolbox image and provider runner script;
- streams/parses agent events and records task runs/logs/messages/results;
- creates pending checkpoints when build changes are found.

## Checkpoints and review

Build runs that produce changes create `task_change_proposals` in Postgres. Migrations enforce at most one pending proposal per task with a partial unique index (`task_change_proposals_pending_idx`). The task detail UI renders diffs/checkpoints and exposes apply, reject, revert-file, push, pull, merge, and archive controls (`apps/web/components/task-detail-page.tsx`).

Mutation guards matter: server helpers block Git/checkpoint mutations while tasks are active, queued, archived, have pending checkpoints, or have active terminals as appropriate (`apps/server/src/lib/task-mutation-guards.ts`, `apps/server/src/routes/tasks.ts`).

Auto-apply is supported by task config and spawner logic, but failure paths should be treated carefully: source evidence shows auto-apply can disable itself on failure and leave a recoverable pending checkpoint.

## Follow-up messages

Task messages can be comments or actionable follow-ups (`build` or `ask`). `SchedulerService.triggerNextPendingAction` consumes the oldest pending action message and re-queues the task. This supports iterative work after an answer/checkpoint/cancel path, but it creates ordering and checkpoint-blocking edge cases; tests should cover pending action ordering and recovery.

## Git and workspace actions

The task detail product flow includes:

- pull selected branch;
- push task branch;
- merge task branch into a target branch and optionally archive/delete remote branch;
- reset/revert commit;
- inspect live diff, branch sync counts, and commit log;
- browse/search/preview/edit workspace files through safe workspace path helpers.

Server-side implementation lives mostly in `apps/server/src/routes/tasks.ts` and `apps/server/src/services/spawner.ts`. Git helpers such as `git-locks`, `git-paths`, `git-env`, `git-runtime-mounts`, and `safe-workspace-file` protect path and concurrency boundaries.

## Interactive terminal

Users can continue a task in a browser terminal. The server attaches terminal WebSocket upgrades from `apps/server/src/lib/task-interactive-terminal.ts`, and the frontend has fullscreen route/page support under `apps/web/app/tasks/[id]/terminal/page.tsx` plus terminal/detail components. Scheduler blocks normal task execution while an active terminal session exists.

Terminal mode shares much of the same runtime capability surface as task runs: workspace mounts, Git credentials, repository env, hostexec, and MCP server configuration.

## External task creation and feedback

Repository integrations can create or continue tasks:

- GitHub PR/issue/comment/review webhooks are handled by `apps/server/src/routes/github-pr-webhooks.ts` and configured per repository.
- Slack events are handled by `apps/server/src/routes/slack-webhooks.ts` and use repository Slack channel/template settings.
- The Verft MCP server exposes tools for listing repos/tasks, creating tasks/subtasks, starting tasks, adding messages, linking PRs/issues, replying to Slack threads, and updating auto-apply config (`apps/server/src/mcp/tools.ts`).

Default GitHub and Slack instruction templates live in `packages/shared-types/src/index.ts`.

## Tests and high-risk changes

Existing backend tests include scheduler, task store, task start orchestration, mutation guards, Git helpers, provider state, interactive terminal, MCP, GitHub/Slack webhooks, and spawner workspace provisioning (`apps/server/package.json`). Frontend tests include task definition fields and lifecycle/timeline/history utilities (`apps/web/package.json`).

Prioritize tests when changing:

- scheduler queue/recovery/cancel behavior;
- pending checkpoint and auto-apply transitions;
- follow-up message ordering;
- Git pull/push/merge/reset/revert and lock cleanup;
- task detail UI actions and realtime consistency;
- repository secrets/env files/MCP/hostexec materialization.
