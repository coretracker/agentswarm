# AgentSwarm

AgentSwarm is a local-first platform for planning, reviewing, asking, and implementing repository tasks with provider-specific coding agents running inside Docker.

It is designed for local development, branch-based task execution, live logs, and provider flexibility across Codex and Claude Code.

## What it does

- Manage repositories from a web UI
- Create tasks from blank input, GitHub issues, or GitHub pull requests
- Support task types:
  - `plan`
  - `review`
  - `ask`
- Support queue modes per task:
  - `manual`
  - `auto`
- Run provider-specific agent containers for:
  - Codex
  - Claude Code
- Stream live task logs to the UI
- Persist task state and queue data in Redis
- Store plans locally without committing them into the target repository
- Let the server own git commit and push side effects after a successful `build`

## Architecture

### Web

- Next.js
- Ant Design
- Socket.IO client for live task updates

### Server

- Node.js
- TypeScript
- Fastify
- Socket.IO
- Redis-backed task store and queue

### Agent runtimes

- `agent-runtime-codex/`
- `agent-runtime-claude/`

Each task execution runs in a short-lived Docker container. The server prepares a managed workspace, passes task context to the runtime, streams logs back to the UI, and finalizes git operations for successful build tasks.

## Task model

### Task types

- `plan`: create or revise a markdown plan only
- `review`: review a branch against the repository default branch and requirements
- `ask`: answer a repository question in markdown only

### Task actions

- `plan`
- `build`
- `iterate`
- `review`
- `ask`

### Queue modes

- `manual`: wait for an explicit user trigger
- `auto`: let the scheduler pick the task up automatically; `plan` tasks can continue from plan into build

## Security model

- Provider API credentials and GitHub token are configured through the Settings UI
- Authentication uses httpOnly session cookies backed by Redis
- Roles are scope-based and managed from the Settings UI
- Users are managed from the Users screen after signing in
- Credentials are stored encrypted on the server with a local key volume
- Credentials are never returned by the API
- Provider containers do not own git push credentials; the server performs commit and push after successful build execution
- Local plans are stored under `./local-plans`
- Managed task workspaces are stored under `./task-workspaces`

## Local development

### Prerequisites

- Docker
- Docker Compose

Optional for local non-Docker development:

- Node.js 20+
- npm

### Start the stack

```bash
docker compose up --build
```

### Open the app

- Web UI: `http://localhost:3217/login`
- Server health: `http://localhost:4000/health`

## First-time setup

After the stack is running:

1. Sign in with the seeded admin account from `.env.example` or your local `.env`:
   - email: `admin@agentswarm.local`
   - password: `admin123!`
2. Rotate the seeded admin password immediately and create the real users and roles you want to use.
3. Open `Settings` and configure the provider credentials you actually want to use:
   - `Git Username`
   - `GitHub Token`
   - `OpenAI API Key`
   - `Anthropic API Key`
   - optional `OpenAI Base URL`
4. Add one or more repositories
5. Create a task from:
   - blank input
   - GitHub issue
   - GitHub pull request

The seeded admin password is only applied when the bootstrap user is first created. Restarting the stack does not reset that password.

## Runtime behavior

- Plans are local markdown artifacts only
- Review and ask tasks do not modify code
- Build tasks edit the managed workspace and, if successful, the server:
  - computes the diff
  - commits
  - pushes the target branch
- If a build produces no diff, the task fails instead of creating an empty commit

## Repository layout

```text
agentswarm/
  apps/
    server/
    web/
  packages/
    shared-types/
  agent-runtime-codex/
  agent-runtime-claude/
  local-plans/
  task-workspaces/
  docker-compose.yml
```

## Notes for pushing this repository

- `.env` is ignored and should not be committed
- `.env.example` is intentionally blank and safe to commit
- `local-plans/` and `task-workspaces/` are local runtime state and should not be committed
- build output like `.next/` and `dist/` should not be committed
- credentials belong in the Settings UI, not in tracked source files
