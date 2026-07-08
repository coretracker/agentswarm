import { spawn as spawnChild } from "node:child_process";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import type { AgentProvider } from "@verft/shared-types";
import pty from "node-pty";
import type { IPty } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

import { AGENT_RUNTIME_IMAGE } from "../config/env.js";
import type { AuthService } from "./auth.js";
import { resolveDockerSocketAccessPolicy, resolveDockerSocketRunArgs } from "./docker-socket-access.js";
import { buildVerftBaseEnvArgs, buildVerftBaseVolumeMountArgs } from "./verft-base-mounts.js";
import type { SettingsStore } from "../services/settings-store.js";

type SettingsProviderTerminalScope = AgentProvider | "setup";

const WS_PATH_RE = /^\/settings\/providers\/(codex|claude|setup)\/terminal$/;
const AGENT_HOME = "/home/agent";
let activeSettingsTerminalSession: { sessionName: string } | null = null;

function denySocket(socket: Duplex, status: number, body: string): void {
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Error";
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}

function forceRemoveDockerSession(containerName: string): void {
  const child = spawnChild("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

function dockerImageExists(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawnChild("docker", ["image", "inspect", image], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export function buildProviderTerminalScript(scope: SettingsProviderTerminalScope): string {
  const includeCodex = scope === "setup" || scope === "codex";
  const includeClaude = scope === "setup" || scope === "claude";
  const startHint = scope === "setup"
    ? "Provider setup terminal. Run codex login, claude /login, or configure provider plugins here. Saved files are reused by new tasks."
    : scope === "claude"
      ? "Claude base terminal. Run claude /login or configure plugins here."
      : "Codex base terminal. Run codex login or configure plugins here.";

  return [
    `export HOME="${AGENT_HOME}"`,
    `BASE_ROOT="${"${VERFT_BASE_ROOT:-/verft-base}"}"`,
    `mkdir -p "$HOME"`,
    includeCodex ? `mkdir -p "$BASE_ROOT/codex"` : ":",
    includeClaude ? `mkdir -p "$BASE_ROOT/claude"` : ":",
    includeCodex ? `rm -rf "$HOME/.codex" && ln -s "$BASE_ROOT/codex" "$HOME/.codex"` : ":",
    includeClaude ? `rm -rf "$HOME/.claude" && ln -s "$BASE_ROOT/claude" "$HOME/.claude"` : ":",
    includeClaude ? `touch "$BASE_ROOT/claude/.claude.json" && rm -f "$HOME/.claude.json" && ln -s "$BASE_ROOT/claude/.claude.json" "$HOME/.claude.json"` : ":",
    `printf "\\033[90m${startHint}\\033[0m\\n"`,
    "sync_base_state() {",
    `  chown -R agent:agent "$BASE_ROOT" "$HOME" 2>/dev/null || true`,
    "}",
    "trap sync_base_state EXIT HUP INT TERM",
    `chown -R agent:agent "$HOME" "$BASE_ROOT" 2>/dev/null || true`,
    "if command -v bash >/dev/null 2>&1; then su-exec agent:agent bash -i; STATUS=$?; else su-exec agent:agent sh -i; STATUS=$?; fi",
    "sync_base_state",
    "exit $STATUS"
  ].join("\n");
}

function attachWsToPty(ws: WebSocket, child: IPty, sessionName: string): void {
  let closed = false;
  const cleanup = (): void => {
    if (activeSettingsTerminalSession?.sessionName === sessionName) {
      activeSettingsTerminalSession = null;
    }
    forceRemoveDockerSession(sessionName);
  };

  child.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
  child.onExit(({ exitCode }) => {
    if (closed) {
      return;
    }
    closed = true;
    cleanup();
    try {
      ws.close(exitCode === 0 ? 1000 : 1011, `terminal exited ${exitCode}`);
    } catch {
      /* ignore */
    }
  });
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      child.write(Buffer.from(data as Buffer).toString("utf8"));
      return;
    }
    const text = data.toString();
    try {
      const parsed = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        child.resize(parsed.cols, parsed.rows);
      }
    } catch {
      child.write(text);
    }
  });
  ws.on("close", () => {
    if (closed) {
      return;
    }
    closed = true;
    child.kill();
    cleanup();
  });
}

export function attachSettingsProviderTerminalUpgrade(httpServer: HttpServer, deps: { auth: AuthService; settingsStore: SettingsStore }): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.prependListener("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host ?? "127.0.0.1";
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    const match = requestUrl.pathname.match(WS_PATH_RE);
    if (!match) {
      return;
    }
    const scope = match[1] as SettingsProviderTerminalScope;

    void (async () => {
      const auth = await deps.auth.authenticateCookieHeader(request.headers);
      if (!auth) {
        denySocket(socket, 401, "Authentication required");
        return;
      }
      if (!auth.scopes.has("settings:edit")) {
        denySocket(socket, 403, "settings:edit scope required");
        return;
      }
      if (!(await dockerImageExists(AGENT_RUNTIME_IMAGE))) {
        denySocket(socket, 500, `Terminal image "${AGENT_RUNTIME_IMAGE}" is not available.`);
        return;
      }
      if (activeSettingsTerminalSession) {
        denySocket(socket, 409, "Provider setup terminal is already open.");
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const sessionName = `verft-settings-${scope}-${Date.now().toString(36)}`;
        const dockerSocketProvider = scope === "claude" ? "claude" : "codex";
        const dockerSocketRunArgs = resolveDockerSocketRunArgs(resolveDockerSocketAccessPolicy(dockerSocketProvider));
        const dockerArgs = [
          "run",
          "-i",
          "-t",
          "--rm",
          "--name",
          sessionName,
          ...buildVerftBaseVolumeMountArgs(),
          ...dockerSocketRunArgs,
          ...buildVerftBaseEnvArgs(),
          AGENT_RUNTIME_IMAGE,
          "sh",
          "-lc",
          buildProviderTerminalScript(scope)
        ];
        ws.send(`Starting ${scope} settings terminal...\r\n`);
        try {
          const child = pty.spawn("docker", dockerArgs, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: process.env.HOME || "/",
            env: { ...process.env, TERM: "xterm-256color" }
          });
          activeSettingsTerminalSession = { sessionName };
          attachWsToPty(ws, child, sessionName);
        } catch (error) {
          if (activeSettingsTerminalSession?.sessionName === sessionName) {
            activeSettingsTerminalSession = null;
          }
          forceRemoveDockerSession(sessionName);
          ws.send(`settings terminal failed: ${error instanceof Error ? error.message : String(error)}\r\n`);
          ws.close(1011, "terminal failed");
        }
      });
    })().catch(() => {
      try {
        denySocket(socket, 500, "Internal error");
      } catch {
        /* ignore */
      }
    });
  });
}
