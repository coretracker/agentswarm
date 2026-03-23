<p align="center">
  <img src="apps/web/public/logo.svg" width="96" height="96" alt="AgentSwarm logo"/>
</p>

# AgentSwarm

AgentSwarm is a local-first platform for planning, reviewing, asking, and implementing repository tasks with provider-specific coding agents running in Docker.

It targets local development, branch-based execution, live logs, and provider choice between **Codex (OpenAI)** and **Claude Code (Anthropic)** — the latter is currently **experimental** in the UI.

## What it does

- Manage repositories from a web UI
- Create tasks from blank input, GitHub issues, or GitHub pull requests; save definitions as **presets**
- **Start modes** when creating a task:
  - **Run automated agent now** — enqueue Codex or Claude for the selected action
  - **Prepare workspace only** — clone/checkout in the **background** (no agent run); status moves from *Preparing workspace* to *Ready* for interactive work
- Task types: **plan**, **build**, **ask**, and **review**
- **Interactive** task sessions: browser terminal with Codex in Docker, workspace mounted at `/workspace` (requires `CODEX_INTERACTIVE_IMAGE` and Docker socket on the server; see `tools/codex-web-terminal/`)
- Stream live task logs; Socket.IO for live task updates
- Redis-backed task store and scheduling
- Store plans locally without committing them into the target repository
- Server-owned git **commit** and **push** after successful **build** runs

## Architecture

### Web (`apps/web`)

- Next.js, Ant Design
- Socket.IO client for live updates
- Logo: `apps/web/public/logo.svg` (login + shell header)

### Server (`apps/server`)

- Node.js, TypeScript, Fastify
- Socket.IO; optional WebSocket upgrades for interactive Codex (`/tasks/:id/interactive-terminal`)
- Redis for tasks, sessions, and events

### Shared types (`packages/shared-types`)

- Shared TypeScript types and provider/task helpers used by web and server

### Agent runtimes

- `agent-runtime-codex/`
- `agent-runtime-claude/`

Each run uses a short-lived container. The server prepares a managed workspace, streams logs to the UI, and finalizes git for successful builds.

## Task model (overview)

- **Task types:** `plan`, `build`, `ask`, `review`
- **Actions** (API / history): `plan`, `build`, `iterate`, `review`, `ask`, plus `comment` for timeline messages
- **Statuses** include queued and in-progress states, **Preparing workspace** (async checkout), **Ready** (completed build / workspace-ready), and terminal outcomes (`failed`, `cancelled`, `accepted`, …)

## Security model

- Provider API credentials and GitHub token are configured in **Settings**
- httpOnly session cookies backed by Redis; scope-based **roles** and **users** managed in the UI
- Credentials encrypted on disk; **never** returned by the API
- Provider containers do not perform git push; the server commits and pushes after successful builds
- Local plans: `./local-plans`
- Managed workspaces: `./task-workspaces`

## Local development

### Prerequisites

- Docker and Docker Compose (recommended full stack)
- Optional: Node.js 20+ and npm for running apps on the host

### Start the stack

```bash
docker compose up --build
```

### Open the app

- Web UI: `http://localhost:3217/login`
- API health: `http://localhost:4000/health`

### Develop without rebuilding images

From the repo root (install dependencies once with `npm install`):

```bash
npm run dev
```

Runs the server and web app with hot reload; you still need Redis (and Docker for agent runs) according to your setup.

### Build (CI-style)

```bash
npm run build
```

## First-time setup

1. Sign in with the seeded admin from environment variables (defaults match `docker-compose.yml` / `.env.example`):
   - Email: `admin@agentswarm.local`
   - Password: `admin123!`
2. Rotate the admin password and create real users and roles.
3. In **Settings**, configure **Git username**, **GitHub token**, **OpenAI** (Codex), and optionally **Anthropic** (Claude Code, experimental).
4. Add repositories, then create tasks from blank/issue/PR or spawn from presets.

The seeded password applies only when the bootstrap user is first created.

## Runtime behavior (summary)

- Plans are local markdown artifacts
- **Build** tasks edit the managed workspace; on success the server computes diff, commits, and pushes
- Builds that produce no diff fail (no empty commit)
- **Prepare workspace only** prepares the checkout asynchronously; the UI shows a preparing state until the workspace is ready

## Repository layout

```text
agentswarm/
  apps/
    server/
    web/
      public/
        logo.svg          # app + README branding
  packages/
    shared-types/
  agent-runtime-codex/
  agent-runtime-claude/
  tools/
    codex-web-terminal/   # reference Dockerfiles for interactive Codex
  local-plans/
  task-workspaces/
  docker-compose.yml
```

## Notes for contributors

- Do not commit `.env` (secrets)
- Commit `.env.example` as a template (bootstrap defaults only — no API keys)
- Do not commit `local-plans/`, `task-workspaces/`, `.next/`, or `dist/`
- Keep credentials in Settings, not in source
