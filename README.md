<p align="center">
  <img src="apps/web/public/logo.svg" width="120" alt="AgentSwarm logo"/>
</p>

<h1 align="center">AgentSwarm</h1>

<p align="center"><strong>Turn repositories into managed agent work with a UI your team can actually use.</strong></p>

<p align="center">
  <a href="#try-it-locally">Try it locally</a> ·
  <a href="#what-you-can-do">What you can do</a> ·
  <a href="#why-agentswarm">Why AgentSwarm</a>
</p>

---

Stop stitching together scripts, terminals, and ad-hoc prompts. **AgentSwarm** is a **local-first** control plane: connect your GitHub repos, spin up **Codex** or **Claude Code** runs in **Docker**, watch **live logs**, and keep work on **real branches** with the server handling **commit and push** when a build succeeds. When you want to steer the agent yourself, open an **Interactive** terminal in the browser—workspace mounted, same task context.

**Claude Code** support is available and marked **experimental** in the app; **Codex (OpenAI)** is the primary path for production-style runs today.

## Why AgentSwarm?

| You want… | AgentSwarm helps by… |
|-----------|----------------------|
| **Visibility** | One place for task status, history, diffs, and streamed run logs—not lost scrollback. |
| **Control** | Scoped roles, encrypted credentials in Settings, and **you** own when code lands on the remote (server-side git after builds). |
| **Flexibility** | Start from a blank task, a **GitHub issue**, or a **PR**; save flows as **presets**; run the agent now **or** only **prepare the workspace** for interactive work. |
| **Local & yours** | Runs on your machine (or infra you trust); data stays in **Redis**, **local plans**, and **task workspaces** you control. |

## What you can do

- **Onboard repos** and invite teammates with permissions that match how you work (who creates tasks, who edits, who’s read-only).
- **Run Build and Ask in automated mode** from one thread: implementation on a branch and repo Q&amp;A without juggling five tools.
- **Choose how each task starts**: kick off an **automated agent run** immediately, or **prepare the workspace only** so checkout finishes in the background and you land in **Ready** when you’re set to work (or open Interactive).
- **Use full agent functionality in Interactive terminal** when you want direct control: open a browser shell in the task workspace (`/workspace`) with the complete agent experience; the task’s saved provider/model/effort decide whether AgentSwarm launches **Codex** or **Claude Code**. The separate **Git Terminal** now runs in its own restricted Alpine image with `git`, `vim`, and `diff3`. Wire-up details live in `tools/codex-web-terminal/` and the `GIT_TERMINAL_IMAGE` / `CODEX_INTERACTIVE_IMAGE` / `CLAUDE_INTERACTIVE_IMAGE` env vars.
- **See progress as it happens** with live log streaming and real-time UI updates over Socket.IO.

Under the hood: disposable **agent-runtime** containers per run, **Redis** for tasks and sessions, and **Next.js + Fastify** for the web and API.

## Try it locally

**Prerequisites:** Docker and Docker Compose (Node 20+ optional for dev on the host).

```bash
cd agentswarm   # your clone of this repository
docker compose up --build
```

Convenience wrapper:

```bash
./agentswarm.sh start
./agentswarm.sh rebuild
./agentswarm.sh stop
```

`rebuild` also rebuilds the automated Codex and Claude runtime images used for task runs, plus the browser terminal images, before restarting the main stack.

Then open **[http://localhost:3217/login](http://localhost:3217/login)**.

Docker Compose now exposes a single public port through an internal Nginx proxy. The web app stays on `/`, and the API, Socket.IO, and interactive terminal stay behind `/api/*` on the same hostname.

- API health: `http://localhost:3217/api/health`
- Hot dev (after `npm install`): `npm run dev`
- CI-style build: `npm run build`

For non-local deployments, set `CORS_ORIGIN=https://your-domain`. Leave `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` empty if you want to use the bundled same-origin `/api` proxy. Only set them when the API really lives on a separate public origin, and rebuild the web image after changing them.

## First-time setup (2 minutes)

1. Sign in with the seeded admin (**`admin@agentswarm.local`** / **`admin123!`** — same defaults as `docker-compose.yml` / `.env.example`).
2. **Change that password** and add real users and roles.
3. Open **Settings** and add **Git username**, **GitHub token**, and **OpenAI** (Codex). Add **Anthropic** if you want to try **Claude Code (experimental)**.
4. **Add a repository** and create your first task—from scratch, from an issue, or from a PR—or spawn one from a **preset**.

If you want to use the browser terminals, build the runtime images on the Docker host first:

```bash
docker build -f tools/codex-web-terminal/Dockerfile.git -t local/git-terminal:latest tools/codex-web-terminal
docker build -f tools/codex-web-terminal/Dockerfile.codex -t local/codex-interactive:latest tools/codex-web-terminal
docker build -f tools/codex-web-terminal/Dockerfile.claude -t local/claude-interactive:latest tools/codex-web-terminal
```

AgentSwarm does not build those browser terminal images automatically during `docker compose up`.
If you already built the Claude image before this change, rebuild it so the container runs as a non-root user required by current Claude Code releases.
Interactive sessions persist provider state under `task-workspaces/.interactive-homes/{codex|claude}/<task-id>/`, so `.codex` / `.claude` settings and auth survive across future terminal launches for the same task.

The bootstrap password is only applied the **first** time the admin user is created.

## How it’s built

| Layer | Stack |
|-------|--------|
| **Web** (`apps/web`) | Next.js, Ant Design, Socket.IO client · branding: [`apps/web/public/logo.svg`](apps/web/public/logo.svg) |
| **API** (`apps/server`) | Node.js, TypeScript, Fastify, Socket.IO, optional WebSocket for interactive Codex |
| **Shared** (`packages/shared-types`) | Types and helpers shared by web and server |
| **Runtimes** | `agent-runtime-codex/`, `agent-runtime-claude/` — short-lived containers; server prepares workspaces and finalizes git on successful **build** tasks |

## Security & data (trust, briefly)

- API keys and tokens live in **Settings**, encrypted at rest, and are **never** returned by the API.
- Sessions use **httpOnly cookies** backed by **Redis**; access is **scope-based** (roles and users in the UI).
- Agent containers **don’t push**; successful **build** flows are **committed and pushed by the server** so you keep a clear gate.
- **`./local-plans`** and **`./task-workspaces`** are local runtime state on the host.

## Runtime behavior (quick reference)

- **Plans** are local markdown (not auto-committed into the target repo).
- **Builds** that produce **no diff** fail (no empty commits).
- **Prepare workspace only** clones/checks out **asynchronously**; the UI reflects **Preparing workspace** → **Ready**.

### Task model (overview)

- **Automated agent modes:** `build`, `ask`
- **Interactive terminal:** full agent functionality directly in the terminal
- **Actions in timeline/API:** automated mode centers on `build` and `ask` plus `comment` history entries
- **Statuses:** queued / in-progress, **Preparing workspace**, **Ready**, and outcomes like `failed`, `cancelled`, `accepted`, …

## Repository layout

```text
agentswarm/
  apps/server/          apps/web/public/logo.svg
  packages/shared-types/
  agent-runtime-codex/  agent-runtime-claude/
  tools/codex-web-terminal/
  local-plans/          task-workspaces/
  docker-compose.yml
```

## Contributing & hygiene

- Don’t commit **`.env`** or runtime dirs (`local-plans/`, `task-workspaces/`, `.next/`, `dist/`).
- **`.env.example`** is safe to commit (bootstrap vars only—no API keys).
- Keep secrets in **Settings**, not in the repo.

---

<p align="center"><strong>If you want agent-assisted development with a real UI, real Git, and real logs—run AgentSwarm locally and point it at a repo you care about.</strong></p>
