import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";
import pty from "node-pty";

import { getTaskStatusLabel, isActiveTaskStatus, isQueuedTaskStatus, type Task } from "@agentswarm/shared-types";

import { env } from "../config/env.js";
import type { AuthService } from "./auth.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { canUserAccessTask } from "./task-ownership.js";
import { claudeMaxTurnsForProfile, codexReasoningEffortForProfile, defaultModelForProvider } from "./provider-config.js";
import { ensureTaskProviderStatePaths } from "./task-provider-state.js";

const WS_PATH_RE = /^\/tasks\/([^/]+)\/interactive-terminal$/;

function buildCodexUserConfigToml(workspacePath: string, model: string): string {
  const pathSafe = workspacePath.replace(/"/g, "");
  const modelSafe = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const modelTomlKey = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `model = "${modelSafe}"
sandbox_mode = "danger-full-access"
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

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildCodexStartScript(configB64: string, model: string, reasoningEffort: string): string {
  const codexArgs = [
    "exec codex",
    "--dangerously-bypass-approvals-and-sandbox",
    '-C "$TASK_INTERACTIVE_WORKSPACE"',
    "-m",
    shellSingleQuote(model),
    "-c cli_auth_credentials_store=file",
    "-c forced_login_method=api",
    "-c",
    shellSingleQuote(`model_reasoning_effort="${reasoningEffort}"`)
  ];

  return [
    "mkdir -p ~/.codex",
    `printf '%s' ${shellSingleQuote(configB64)} | base64 -d > ~/.codex/config.toml`,
    'printf %s "$OPENAI_API_KEY" | codex login --with-api-key -c cli_auth_credentials_store=file',
    codexArgs.join(" "),
  ].join(" && ");
}

function buildClaudeSettingsJson(): string {
  return JSON.stringify({
    autoUpdaterStatus: "disabled",
    disableBypassPermissionsMode: "disable"
  });
}

function buildClaudeStartScript(model: string, maxTurns: number | undefined, settingsJson: string): string {
  const claudeArgs = [
    "exec claude",
    "--model",
    shellSingleQuote(model),
    "--settings",
    shellSingleQuote(settingsJson)
  ];
  if (typeof maxTurns === "number") {
    claudeArgs.push("--max-turns", String(maxTurns));
  }

  return ['mkdir -p "$HOME/.claude"', `cd "$TASK_INTERACTIVE_WORKSPACE"`, "sleep 1", claudeArgs.join(" ")].join(" && ");
}

type InteractiveTerminalRuntimeConfig =
  | {
      ok: true;
      provider: Task["provider"];
      image: string;
      providerLabel: string;
      persistentState?: {
        containerPath: string;
        configContainerPath?: string;
        uid: number;
        gid: number;
      };
      envEntries: Array<[string, string]>;
      startScript: string;
    }
  | {
      ok: false;
      reason: string;
    };

type InteractiveRuntimeSettings = Awaited<ReturnType<SettingsStore["getSettings"]>>;
type InteractiveRuntimeCredentials = Awaited<ReturnType<SettingsStore["getRuntimeCredentials"]>>;

function resolveInteractiveTerminalModel(task: Task): string {
  const configured = task.modelOverride?.trim();
  if (configured) {
    return configured;
  }

  return defaultModelForProvider(task.provider, task.providerProfile) ?? (task.provider === "claude" ? "claude-sonnet-4-5" : "gpt-5.4");
}

function resolveInteractiveTerminalRuntimeConfig(
  task: Task,
  settings: InteractiveRuntimeSettings,
  credentials: InteractiveRuntimeCredentials
): InteractiveTerminalRuntimeConfig {
  const model = resolveInteractiveTerminalModel(task);

  if (task.provider === "claude") {
    const image = env.CLAUDE_INTERACTIVE_IMAGE?.trim();
    if (!image) {
      return { ok: false, reason: "Interactive Claude Code is not configured (set CLAUDE_INTERACTIVE_IMAGE on the server)." };
    }
    if (!credentials.anthropicApiKey) {
      return { ok: false, reason: "Anthropic API key is not configured in Settings." };
    }

    return {
      ok: true,
      provider: "claude",
      image,
      providerLabel: "Claude Code",
      persistentState: {
        containerPath: "/home/claude/.claude",
        configContainerPath: "/home/claude/.claude.json",
        uid: 1000,
        gid: 1000
      },
      envEntries: [
        ["ANTHROPIC_API_KEY", credentials.anthropicApiKey],
        ["TERM", "xterm-256color"],
        ["HOME", "/home/claude"],
        ["TASK_INTERACTIVE_WORKSPACE", "/workspace"]
      ],
      startScript: buildClaudeStartScript(model, claudeMaxTurnsForProfile(task.providerProfile), buildClaudeSettingsJson())
    };
  }

  const image = env.CODEX_INTERACTIVE_IMAGE?.trim();
  if (!image) {
    return { ok: false, reason: "Interactive Codex is not configured (set CODEX_INTERACTIVE_IMAGE on the server)." };
  }
  if (!credentials.openaiApiKey) {
    return { ok: false, reason: "OpenAI API key is not configured in Settings." };
  }

  const envEntries: Array<[string, string]> = [
    ["OPENAI_API_KEY", credentials.openaiApiKey],
    ["TERM", "xterm-256color"],
    ["HOME", "/root"],
    ["TASK_INTERACTIVE_WORKSPACE", "/workspace"],
    ["CODEX_TRUST_WORKSPACE", "/workspace"]
  ];
  if (settings.openaiBaseUrl?.trim()) {
    envEntries.push(["OPENAI_BASE_URL", settings.openaiBaseUrl.trim()]);
  }

  return {
    ok: true,
    provider: "codex",
    image,
    providerLabel: "Codex",
    persistentState: {
      containerPath: "/root/.codex",
      uid: 0,
      gid: 0
    },
    envEntries,
    startScript: buildCodexStartScript(
      Buffer.from(buildCodexUserConfigToml("/workspace", model), "utf8").toString("base64"),
      model,
      codexReasoningEffortForProfile(task.providerProfile)
    )
  };
}

function forceRemoveDockerSession(containerName: string): void {
  const child = spawnChild("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function interactiveImageBuildHint(provider: Task["provider"], image: string): string {
  const dockerfile = provider === "claude" ? "Dockerfile.claude" : "Dockerfile.codex";
  return `docker build -f tools/codex-web-terminal/${dockerfile} -t ${image} tools/codex-web-terminal`;
}

async function dockerImageExists(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawnChild("docker", ["image", "inspect", image], {
      stdio: "ignore"
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
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

interface ActiveInteractiveTerminalController {
  sessionId: string;
  terminate: () => Promise<void>;
}

const activeInteractiveTerminalControllers = new Map<string, ActiveInteractiveTerminalController>();

function registerActiveInteractiveTerminalController(
  taskId: string,
  sessionId: string,
  terminate: () => Promise<void>
): void {
  activeInteractiveTerminalControllers.set(taskId, { sessionId, terminate });
}

function unregisterActiveInteractiveTerminalController(taskId: string, sessionId: string): void {
  const active = activeInteractiveTerminalControllers.get(taskId);
  if (active?.sessionId === sessionId) {
    activeInteractiveTerminalControllers.delete(taskId);
  }
}

function sendInteractiveTerminalError(ws: WebSocket, message: string): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify({ type: "error", message }), () => {
    try {
      ws.close(1011, "interactive terminal failed");
    } catch {
      /* ignore */
    }
  });
}

export async function killTaskInteractiveTerminalSession(taskId: string): Promise<boolean> {
  const active = activeInteractiveTerminalControllers.get(taskId);
  if (!active) {
    return false;
  }

  await active.terminate();
  return true;
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

  const [settings, credentials] = await Promise.all([
    settingsStore.getSettings(),
    settingsStore.getRuntimeCredentials()
  ]);
  const runtime = resolveInteractiveTerminalRuntimeConfig(task, settings, credentials);
  if (!runtime.ok) {
    return { available: false, reason: runtime.reason };
  }
  if (!(await dockerImageExists(runtime.image))) {
    return {
      available: false,
      reason: `Interactive ${runtime.providerLabel} image "${runtime.image}" is not available on the Docker host. Build it first: ${interactiveImageBuildHint(task.provider, runtime.image)}`
    };
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
      if (!auth.scopes.has("task:interactive")) {
        denySocket(socket, 403, "task:interactive scope required");
        return;
      }

      const task = await deps.taskStore.getTask(taskId);
      if (!task || !canUserAccessTask(auth.user, task)) {
        denySocket(socket, 404, "Task not found");
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        void initializeTaskInteractiveTerminalWebSocket(ws, task, deps).catch(() => {
          sendInteractiveTerminalError(ws, "Interactive terminal initialization failed.");
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

async function initializeTaskInteractiveTerminalWebSocket(
  ws: WebSocket,
  task: Task,
  deps: TaskInteractiveTerminalDeps
): Promise<void> {
  const taskId = task.id;
  const status = await getTaskInteractiveTerminalStatus(deps.taskStore, deps.settingsStore, taskId);
  if (!status.available) {
    sendInteractiveTerminalError(ws, status.reason ?? "Interactive session unavailable");
    return;
  }

  const [credentials, settings] = await Promise.all([
    deps.settingsStore.getRuntimeCredentials(),
    deps.settingsStore.getSettings()
  ]);
  const runtime = resolveInteractiveTerminalRuntimeConfig(task, settings, credentials);
  if (!runtime.ok) {
    sendInteractiveTerminalError(ws, runtime.reason);
    return;
  }

  let interactiveSessionId: string | null = null;

  try {
    const started = await deps.spawner.beginInteractiveTerminalSession(taskId);
    interactiveSessionId = started.sessionId;

    const sessionName = `aswix-${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const dockerBindSource = path.join(env.TASK_WORKSPACE_HOST_ROOT, taskId);
    const statePaths = runtime.persistentState
      ? await ensureTaskProviderStatePaths(task.id, runtime.provider, {
          uid: runtime.persistentState.uid,
          gid: runtime.persistentState.gid
        })
      : null;
    const dockerEnv: string[] = [];
    for (const [name, value] of runtime.envEntries) {
      dockerEnv.push("-e", `${name}=${value}`);
    }
    dockerEnv.push("-e", `TASK_WORKSPACE_PATH=${dockerBindSource}`, "-e", `TASK_WORSPACE_PATH=${dockerBindSource}`);

    const dockerArgs = [
      "run",
      "-i",
      "-t",
      "--rm",
      "--name",
      sessionName,
      "-v",
      `${dockerBindSource}:/workspace:rw`,
      ...(statePaths && runtime.persistentState
        ? ["-v", `${statePaths.hostPath}:${runtime.persistentState.containerPath}:rw`]
        : []),
      ...(statePaths && runtime.persistentState?.configContainerPath && statePaths.configHostPath
        ? ["-v", `${statePaths.configHostPath}:${runtime.persistentState.configContainerPath}:rw`]
        : []),
      ...dockerEnv,
      runtime.image,
      "sh",
      "-lc",
      runtime.startScript,
    ];

    const child = pty.spawn("docker", dockerArgs, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/",
      env: { ...process.env, TERM: "xterm-256color" },
    });

    wireTerminalWebSocket(ws, child, sessionName, {
      taskId,
      sessionId: interactiveSessionId,
      spawner: deps.spawner
    });
  } catch (error) {
    if (interactiveSessionId) {
      await deps.spawner.endInteractiveTerminalSession(taskId, interactiveSessionId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Could not start interactive session";
    sendInteractiveTerminalError(ws, message);
  }
}

function wireTerminalWebSocket(
  ws: WebSocket,
  child: pty.IPty,
  sessionContainerName: string,
  proposalCtx: { taskId: string; sessionId: string; spawner: SpawnerService }
): void {
  let sawTerminalOutput = false;
  let cleanupPromise: Promise<void> | null = null;
  const cleanupSession = (): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    cleanupPromise = (async () => {
      unregisterActiveInteractiveTerminalController(proposalCtx.taskId, proposalCtx.sessionId);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1012, "interactive terminal terminated");
        }
      } catch {
        /* ignore */
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      forceRemoveDockerSession(sessionContainerName);
      await proposalCtx.spawner.endInteractiveTerminalSession(proposalCtx.taskId, proposalCtx.sessionId).catch(() => undefined);
    })();

    return cleanupPromise;
  };

  registerActiveInteractiveTerminalController(proposalCtx.taskId, proposalCtx.sessionId, cleanupSession);

  child.onData((data) => {
    sawTerminalOutput = true;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data, "utf8"), { binary: true });
    }
  });

  child.onExit(() => {
    if (!sawTerminalOutput) {
      sendInteractiveTerminalError(ws, "Interactive process exited before it produced terminal output.");
      return;
    }
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

  ws.on("close", () => {
    void cleanupSession();
  });
  ws.on("error", () => {
    void cleanupSession();
  });
}
