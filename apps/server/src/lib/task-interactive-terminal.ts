import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";
import pty from "node-pty";

import { getTaskStatusLabel, isActiveTaskStatus, isQueuedTaskStatus } from "@agentswarm/shared-types";

import { env } from "../config/env.js";
import type { AuthService } from "./auth.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";

const WS_PATH_RE = /^\/tasks\/([^/]+)\/interactive-terminal$/;

function buildCodexUserConfigToml(workspacePath: string, model: string): string {
  const pathSafe = workspacePath.replace(/"/g, "");
  const modelSafe = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const modelTomlKey = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

function buildStartScript(configB64: string): string {
  return [
    "mkdir -p ~/.codex",
    `printf '%s' '${configB64}' | base64 -d > ~/.codex/config.toml`,
    'printf %s "$OPENAI_API_KEY" | codex login --with-api-key -c cli_auth_credentials_store=file',
    'exec codex --full-auto -C "$CODEX_TRUST_WORKSPACE" -c cli_auth_credentials_store=file -c forced_login_method=api',
  ].join(" && ");
}

function forceRemoveDockerSession(containerName: string): void {
  const child = spawnChild("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function denySocket(socket: Duplex, status: number, body: string): void {
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Error";
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}

export interface TaskInteractiveTerminalDeps {
  auth: AuthService;
  taskStore: TaskStore;
  settingsStore: SettingsStore;
  spawner: SpawnerService;
}

export type TaskInteractiveTerminalStatusPayload = {
  available: boolean;
  reason?: string;
  /** When true, a browser session is already connected; block duplicate terminals and task composer sends. */
  activeInteractiveSession?: boolean;
};

export async function getTaskInteractiveTerminalStatus(
  taskStore: TaskStore,
  settingsStore: SettingsStore,
  taskId: string,
): Promise<TaskInteractiveTerminalStatusPayload> {
  if (!env.CODEX_INTERACTIVE_IMAGE?.trim()) {
    return { available: false, reason: "Interactive Codex is not configured (set CODEX_INTERACTIVE_IMAGE on the server)." };
  }

  const task = await taskStore.getTask(taskId);
  if (!task) {
    return { available: false, reason: "Task not found." };
  }

  if (task.status === "archived") {
    return { available: false, reason: "Archived tasks are read-only." };
  }

  if (isQueuedTaskStatus(task.status) || isActiveTaskStatus(task.status)) {
    return {
      available: false,
      reason: `Terminal unavailable while the task is “${getTaskStatusLabel(task.status)}”. Finish or cancel that run first (one action at a time).`
    };
  }

  if (await taskStore.hasPendingChangeProposal(taskId)) {
    return { available: false, reason: "Apply or reject the pending checkpoint before opening a terminal." };
  }

  if (await taskStore.getActiveInteractiveSession(taskId)) {
    return {
      available: false,
      reason: "An interactive terminal session is already active for this task.",
      activeInteractiveSession: true
    };
  }

  const credentials = await settingsStore.getRuntimeCredentials();
  if (!credentials.openaiApiKey) {
    return { available: false, reason: "OpenAI API key is not configured in Settings." };
  }

  const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
  try {
    await access(workspaceOnServer, constants.R_OK | constants.X_OK);
  } catch {
    return { available: false, reason: "No workspace folder on disk for this task yet." };
  }

  return { available: true };
}

/**
 * Handles WebSocket upgrades for `/tasks/:taskId/interactive-terminal`.
 * Prepended so Socket.io still receives `/socket.io/` upgrades.
 */
export function attachTaskInteractiveTerminalUpgrade(httpServer: HttpServer, deps: TaskInteractiveTerminalDeps): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.prependListener("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host ?? "127.0.0.1";
    const pathOnly = new URL(request.url ?? "/", `http://${host}`).pathname;
    const match = pathOnly.match(WS_PATH_RE);
    if (!match) {
      return;
    }

    const taskId = match[1];
    if (!taskId) {
      return;
    }

    void (async () => {
      const auth = await deps.auth.authenticateCookieHeader(request.headers);
      if (!auth) {
        denySocket(socket, 401, "Authentication required");
        return;
      }
      if (!auth.scopes.has("task:edit")) {
        denySocket(socket, 403, "task:edit scope required");
        return;
      }

      const status = await getTaskInteractiveTerminalStatus(deps.taskStore, deps.settingsStore, taskId);
      if (!status.available) {
        denySocket(socket, 503, status.reason ?? "Interactive session unavailable");
        return;
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials();
      const settings = await deps.settingsStore.getSettings();
      const openaiKey = credentials.openaiApiKey;
      if (!openaiKey) {
        denySocket(socket, 503, "OpenAI API key is not configured");
        return;
      }

      const image = env.CODEX_INTERACTIVE_IMAGE.trim();
      // Left side of -v is the path on the Docker *host* (same convention as spawner agent mounts).
      const dockerBindSource = path.join(env.TASK_WORKSPACE_HOST_ROOT, taskId);
      const model = settings.codexDefaultModel?.trim() || "gpt-5.4";
      const configB64 = Buffer.from(buildCodexUserConfigToml("/workspace", model), "utf8").toString("base64");
      const startScript = buildStartScript(configB64);
      const sessionName = `aswix-${randomUUID().replace(/-/g, "").slice(0, 28)}`;

      let interactiveSessionId: string;
      try {
        const started = await deps.spawner.beginInteractiveTerminalSession(taskId);
        interactiveSessionId = started.sessionId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start interactive session";
        denySocket(socket, 503, message);
        return;
      }

      const dockerEnv = [
        "-e",
        `OPENAI_API_KEY=${openaiKey}`,
        "-e",
        "TERM=xterm-256color",
        "-e",
        "HOME=/root",
        "-e",
        "CODEX_TRUST_WORKSPACE=/workspace",
      ];
      if (settings.openaiBaseUrl?.trim()) {
        dockerEnv.push("-e", `OPENAI_BASE_URL=${settings.openaiBaseUrl.trim()}`);
      }

      const dockerArgs = [
        "run",
        "-i",
        "-t",
        "--rm",
        "--name",
        sessionName,
        "-v",
        `${dockerBindSource}:/workspace:rw`,
        ...dockerEnv,
        image,
        "sh",
        "-lc",
        startScript,
      ];

      let child: pty.IPty;
      try {
        child = pty.spawn("docker", dockerArgs, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: process.env.HOME || "/",
          env: { ...process.env, TERM: "xterm-256color" },
        });
      } catch {
        await deps.taskStore.clearActiveInteractiveSession(taskId);
        denySocket(socket, 503, "Failed to spawn docker session");
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wireTerminalWebSocket(ws, child, sessionName, {
          taskId,
          sessionId: interactiveSessionId,
          spawner: deps.spawner
        });
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

function wireTerminalWebSocket(
  ws: WebSocket,
  child: pty.IPty,
  sessionContainerName: string,
  proposalCtx: { taskId: string; sessionId: string; spawner: SpawnerService }
): void {
  let cleanedUp = false;
  const cleanupSession = (): void => {
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
    void proposalCtx.spawner.endInteractiveTerminalSession(proposalCtx.taskId, proposalCtx.sessionId).catch(() => undefined);
  };

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
      child.write(Buffer.from(data as Buffer).toString("utf8"));
      return;
    }
    try {
      const msg = JSON.parse(String(data)) as { type?: string; cols?: number; rows?: number };
      if (msg.type === "resize") {
        const cols = Number(msg.cols);
        const rows = Number(msg.rows);
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
          child.resize(
            Math.max(2, Math.min(512, Math.floor(cols))),
            Math.max(1, Math.min(256, Math.floor(rows))),
          );
        }
      }
    } catch {
      /* ignore */
    }
  });

  ws.on("close", cleanupSession);
  ws.on("error", cleanupSession);
}
