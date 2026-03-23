<p align="center">
  <img src="apps/web/public/logo.svg" width="120" alt="AgentSwarm logo"/>
</p>

# AgentSwarm

AgentSwarm is a local-first platform for planning, reviewing, asking, and implementing repository tasks with provider-specific coding agents running in Docker.

It targets local development, branch-based execution, live logs, and provider choice between **Codex (OpenAI)** and **Claude Code (Anthropic)**. Claude Code is marked **experimental** in the app.

## What it does

- Manage repositories from a web UI
- Create tasks from blank input, GitHub issues, or GitHub pull requests; save definitions as **presets**
- **Start modes** when creating a task:
  - **Run automated agent now** — start a Codex or Claude run for the selected action
  - **Prepare workspace only** — clone/checkout in the **background** (no agent); status goes from *Preparing workspace* to *Ready*
- Task types: **plan**, **build**, **ask**, and **review**
- **Interactive** sessions: in-browser terminal with Codex in Docker, workspace at `/workspace` (needs `CODEX_INTERACTIVE_IMAGE` + Docker socket; see `tools/codex-web-terminal/`)
- Live task logs; Socket.IO updates
- Redis-backed task store and scheduling
- Local plan storage (not committed into the target repo)
- Server-owned **commit** and **push** after successful **build** runs

## Architecture

### Web (`apps/web`)

- Next.js, Ant Design
- Socket.IO client
- Branding: [`apps/web/public/logo.svg`](apps/web/public/logo.svg) (login + shell header)

### Server (`apps/server`)

- Node.js, TypeScript, Fastify
- Socket.IO; WebSocket upgrades for interactive Codex (`/tasks/:id/interactive-terminal`)
- Redis for tasks, sessions, and events

### Shared types (`packages/shared-types`)

- Shared TypeScript types and helpers for web and server

### Agent runtimes

- `agent-runtime-codex/`
- `agent-runtime-claude/`

Runs are short-lived containers. The server prepares workspaces, streams logs, and finalizes git for successful builds.

## Task model (overview)

- **Task types:** `plan`, `build`, `ask`, `review`
- **Actions:** `plan`, `build`, `iterate`, `review`, `ask`, plus `comment` in the timeline
- **Statuses** include queued/active states, **Preparing workspace**, **Ready**, and terminal outcomes (`failed`, `cancelled`, `accepted`, …)

## Security model

- Credentials and GitHub token are set in **Settings**
- httpOnly cookies + Redis sessions; scope-based **roles** and **users**
- Credentials encrypted at rest; **never** returned by the API
- Agent containers do not push; the server commits and pushes after builds
- `./local-plans` and `./task-workspaces` are local runtime data

## Local development

### Prerequisites

- Docker and Docker Compose (recommended)
- Optional: Node.js 20+ and npm for apps on the host

### Start the stack

```bash
docker compose up --build
```

### URLs

- Web: `http://localhost:3217/login`
- API health: `http://localhost:4000/health`

### Develop on the host (with Redis / Docker as needed)

```bash
npm install
npm run dev
```

### Production-style build

```bash
npm run build
```

## First-time setup

1. Sign in with the seeded admin (defaults match `docker-compose.yml` / `.env.example`):
   - `admin@agentswarm.local` / `admin123!`
2. Rotate the password and configure users and roles.
3. In **Settings**, add **Git username**, **GitHub token**, **OpenAI** (Codex), and optionally **Anthropic** (Claude Code, experimental).
4. Add repositories and create tasks (blank, issue, PR) or spawn from presets.

The bootstrap password applies only when the admin user is first created.

## Runtime behavior

- Plans are local markdown only
- **Build** tasks edit the workspace; on success the server diffs, commits, and pushes
- No diff → build fails (no empty commit)
- **Prepare workspace only** runs checkout asynchronously

## Repository layout

```text
agentswarm/
  apps/
    server/
    web/
      public/
        logo.svg          # branding (README + UI)
  packages/
    shared-types/
  agent-runtime-codex/
  agent-runtime-claude/
  tools/
    codex-web-terminal/
  local-plans/
  task-workspaces/
  docker-compose.yml
```

## Notes for contributors

- Do not commit `.env`
- Commit `.env.example` as a safe template (bootstrap vars only — no API keys)
- Do not commit `local-plans/`, `task-workspaces/`, `.next/`, `dist/`
- Keep secrets in Settings, not in source
