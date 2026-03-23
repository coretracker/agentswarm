# Codex web terminal (PoC)

Interactive **OpenAI Codex CLI** in the browser: **xterm.js** talks to a **WebSocket** server that runs **`docker` + `node-pty`**, which starts a **fresh Codex container per browser session** (`docker run -it --rm … codex`).

This is a local experiment only: **no authentication**, and mounting the Docker socket grants the proxy effectively **root on the host**.

## Prerequisites

- Docker (Desktop on macOS is fine)
- An OpenAI API key in **`OPENAI_API_KEY`**

## Build images (order matters)

Build the **Codex runtime** image on the Docker host (the name must match `CODEX_IMAGE`, default `local/codex-interactive:latest`):

```bash
cd tools/codex-web-terminal
docker build -f Dockerfile.codex -t local/codex-interactive:latest .
```

The **proxy** image is built by Compose (or manually):

```bash
docker build -f Dockerfile.proxy -t codex-web-terminal-proxy:latest .
```

## Run with Docker Compose

Set the API key and start the proxy (listens on **localhost** only):

```bash
export OPENAI_API_KEY="sk-..."
docker compose up --build
```

Open **http://127.0.0.1:8765**. Each page load opens a WebSocket; the server spawns a new Codex container for that session.

### Ending a session (Docker cleanup)

- **Close the tab or navigate away** — the page closes the WebSocket; the proxy **SIGTERM**s the `docker` PTY and runs **`docker rm -f`** on that session’s named container so the inner container does not stick around if the client vanished abruptly.
- **Quit Codex** inside the terminal (exit its UI / shell) — when the process inside the container exits, the PTY ends, the server closes the WebSocket, and **`docker run --rm`** removes the container as usual.

Optional: `CODEX_IMAGE=my-registry/codex:tag` to use another image.

The proxy runs **`codex login --with-api-key`** inside the Codex container before starting the interactive UI so Codex does not prompt for ChatGPT vs API key. Credentials are written to **`~/.codex/auth.json`** in that ephemeral container (`cli_auth_credentials_store=file`). Optional: pass **`OPENAI_BASE_URL`** from the host/Compose if you use a proxy or Azure endpoint.

Before login, the proxy drops a **`~/.codex/config.toml`** (base64-decoded in the container) that:

- Puts **`model`**, **`sandbox_mode`**, and **`approval_policy`** at the **top of the file** (TOML assigns keys to the most recent `[section]`; previously `model` sat under `[tui]` by mistake and was ignored).
- Marks **`/workspace`** as **`trust_level = "trusted"`** (override path with **`CODEX_TRUST_WORKSPACE`** if your image uses another `WORKDIR`).
- Sets **`sandbox_mode = "workspace-write"`** and **`approval_policy = "never"`** for fewer execution prompts in this PoC (still not full host access; see Codex sandbox docs).
- Sets **`model`** from **`CODEX_MODEL`** (default **`gpt-5.4`**), **`[notice]`** migration/rate-limit nudges off, **`tui.show_tooltips = false`**, and **`[tui.model_availability_nux]`** for the active model slug.

The interactive CLI is started as **`codex --full-auto -C "$CODEX_TRUST_WORKSPACE"`** so the agent root matches the trusted path.

## Run on the host (without Compose)

Useful for debugging the Node app without the sidecar:

```bash
npm install
export OPENAI_API_KEY="sk-..."
export CODEX_IMAGE="local/codex-interactive:latest"
npm start
```

Requires a working `docker` CLI on the host and the Codex image built as above.

## Protocol (WebSocket)

- **Binary** messages: raw terminal bytes (browser → stdin, server → stdout).
- **Text** messages: JSON control. Supported: `{"type":"resize","cols":number,"rows":number}`.
- **Text** from server on fatal setup errors: `{"type":"error","message":"..."}`.

## Troubleshooting

- **Blank/black terminal in the browser**: the UI loads **xterm** from this package’s `node_modules` (`/assets/xterm/...`). Run **`npm install`** in `tools/codex-web-terminal/` on the host, and if you use Compose **rebuild the proxy** (`docker compose build --no-cache` or `docker compose up --build`) so the image includes `@xterm/xterm` and `@xterm/addon-fit`. Check the browser devtools Network tab: `/assets/xterm/lib/xterm.mjs` and `/assets/xterm/css/xterm.css` should return **200**.
- **`node-pty` / `node-gyp` in Docker**: the proxy Dockerfile installs Python and build tools so `node-pty` can compile on first `npm ci`. For a smaller image you could switch to a multi-stage build later.
- **`OPENAI_API_KEY is not set`**: export it for Compose or `docker compose` will pass an empty value.
- **Apple Silicon / mixed arch**: if a base image lacks `linux/arm64`, set `DOCKER_DEFAULT_PLATFORM` or use `docker build --platform` when building the Codex image.
- **No colors / odd TTY**: the proxy sets `TERM=xterm-256color` on the inner container.
