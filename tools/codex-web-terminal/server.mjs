import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

/**
 * WebSocket wire format:
 * - Binary: PTY I/O (UTF-8 bytes).
 * - Text JSON from client: `{ "type": "resize", "cols", "rows" }`.
 * - Text JSON from server: `{ "type": "error", "message" }` before close.
 *
 * Each session uses a unique `docker run --name` so on WebSocket close we can `docker rm -f`
 * if the client dies abruptly and the inner container would otherwise linger.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8765);
const CODEX_IMAGE = process.env.CODEX_IMAGE ?? "local/codex-interactive:latest";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const CODEX_MODEL = process.env.CODEX_MODEL?.trim() || "gpt-5.4";
/** Must match the Codex image working directory (see Dockerfile.codex `WORKDIR`, default `/workspace`). */
const CODEX_TRUST_WORKSPACE = process.env.CODEX_TRUST_WORKSPACE?.trim() || "/workspace";

function buildCodexUserConfigToml(workspacePath, model) {
  const pathSafe = workspacePath.replace(/"/g, "");
  const modelSafe = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const modelTomlKey = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // TOML: keys after a `[table]` belong to that table until the next header. Put root keys first
  // so `model` is not parsed as `tui.model` (which Codex ignores).
  return `model = "${modelSafe}"
sandbox_mode = "workspace-write"
approval_policy = "never"

[projects."${pathSafe}"]
trust_level = "trusted"

[notice]
hide_rate_limit_model_nudge = true
hide_gpt5_1_migration_prompt = true
"hide_gpt-5.1-codex-max_migration_prompt" = true

[tui]
show_tooltips = false

[tui.model_availability_nux]
"${modelTomlKey}" = 1
`;
}

const CODEX_USER_CONFIG_B64 = Buffer.from(
  buildCodexUserConfigToml(CODEX_TRUST_WORKSPACE, CODEX_MODEL),
  "utf8",
).toString("base64");

/**
 * Headless-friendly: write user config (trust cwd, default model, suppress model nudges), then
 * `codex login --with-api-key`, then interactive Codex.
 */
const CODEX_START_SCRIPT = [
  "mkdir -p ~/.codex",
  `printf '%s' '${CODEX_USER_CONFIG_B64}' | base64 -d > ~/.codex/config.toml`,
  'printf %s "$OPENAI_API_KEY" | codex login --with-api-key -c cli_auth_credentials_store=file',
  'exec codex --full-auto -C "$CODEX_TRUST_WORKSPACE" -c cli_auth_credentials_store=file -c forced_login_method=api',
].join(" && ");

const app = express();

// Serve xterm assets from npm so the browser does not depend on third-party CDNs (avoids blank UI when CDN/ESM fails).
app.use(
  "/assets/xterm",
  express.static(path.join(__dirname, "node_modules/@xterm/xterm")),
);
app.use(
  "/assets/addon-fit",
  express.static(path.join(__dirname, "node_modules/@xterm/addon-fit")),
);

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

/** Binary frames carry raw terminal bytes. Text frames carry JSON control (resize only). */
const wss = new WebSocketServer({ server, path: "/ws" });

function forceRemoveDockerSession(containerName) {
  const child = spawnChild("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

wss.on("connection", (ws) => {
  if (!OPENAI_API_KEY) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "OPENAI_API_KEY is not set on the proxy (set env before starting).",
      }),
    );
    ws.close();
    return;
  }

  const dockerEnv = [
    "-e",
    `OPENAI_API_KEY=${OPENAI_API_KEY}`,
    "-e",
    "TERM=xterm-256color",
    "-e",
    "HOME=/root",
    "-e",
    `CODEX_TRUST_WORKSPACE=${CODEX_TRUST_WORKSPACE}`,
  ];
  if (OPENAI_BASE_URL) {
    dockerEnv.push("-e", `OPENAI_BASE_URL=${OPENAI_BASE_URL}`);
  }

  const sessionContainerName = `codexwt-${randomUUID().replace(/-/g, "").slice(0, 26)}`;

  const args = [
    "run",
    "-i",
    "-t",
    "--rm",
    "--name",
    sessionContainerName,
    ...dockerEnv,
    CODEX_IMAGE,
    "sh",
    "-lc",
    CODEX_START_SCRIPT,
  ];

  let child;
  try {
    child = pty.spawn("docker", args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/",
      env: { ...process.env, TERM: "xterm-256color" },
    });
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    ws.close();
    return;
  }

  child.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data, "utf8"), { binary: true });
    }
  });

  child.onExit(() => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      child.write(Buffer.from(data).toString("utf8"));
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
        child.resize(
          Math.max(2, Math.min(512, Math.floor(msg.cols))),
          Math.max(1, Math.min(256, Math.floor(msg.rows))),
        );
      }
    } catch {
      /* ignore non-JSON */
    }
  });

  let cleanedUp = false;
  const cleanupSession = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    forceRemoveDockerSession(sessionContainerName);
  };

  ws.on("close", cleanupSession);
  ws.on("error", cleanupSession);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`codex-web-terminal listening on http://0.0.0.0:${PORT}`);
});
