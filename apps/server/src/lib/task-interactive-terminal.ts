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
import { resolveWorkspaceGitRuntimeMounts } from "./git-runtime-mounts.js";
import {
  claudeModelSupportsThinkingBudget,
  claudeThinkingBudgetTokensForProfile,
  codexReasoningEffortForProfile,
  defaultModelForProvider
} from "./provider-config.js";
import { ensureTaskProviderStatePaths } from "./task-provider-state.js";

const WS_PATH_RE = /^\/tasks\/([^/]+)\/interactive-terminal$/;
const INTERACTIVE_WORKSPACE_PATH = "/workspace";
const INTERACTIVE_RESUME_GRACE_MS = 30 * 60_000;
const INTERACTIVE_WS_PING_INTERVAL_MS = 25_000;
const INTERACTIVE_TRANSCRIPT_LIMIT = 2_000_000;
const INTERACTIVE_EXIT_WAIT_MS = 1_500;
const INTERACTIVE_TERMINAL_CLOSE_CODE = 1012;

function buildInteractiveWorkspaceGitEnvEntries(workspacePath: string): Array<[string, string]> {
  return [
    ["GIT_CONFIG_COUNT", "1"],
    ["GIT_CONFIG_KEY_0", "safe.directory"],
    ["GIT_CONFIG_VALUE_0", workspacePath]
  ];
}

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

function buildClaudeStartScript(model: string, settingsJson: string): string {
  const claudeArgs = [
    "--model",
    shellSingleQuote(model),
    "--settings",
    shellSingleQuote(settingsJson)
  ];

  return [
    'mkdir -p "$HOME/.claude" "$HOME/.local/bin"',
    'if [ ! -x "$HOME/.local/bin/claude" ] && [ -x "/opt/claude-code/.local/bin/claude" ]; then ln -sf "/opt/claude-code/.local/bin/claude" "$HOME/.local/bin/claude"; fi',
    'CLAUDE_BIN="$HOME/.local/bin/claude"',
    'if [ ! -x "$CLAUDE_BIN" ] && [ -x "/opt/claude-code/.local/bin/claude" ]; then CLAUDE_BIN="/opt/claude-code/.local/bin/claude"; fi',
    'if [ ! -x "$CLAUDE_BIN" ]; then CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"; fi',
    'if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then echo "Claude CLI not found in image." >&2; exit 127; fi',
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    "sleep 1",
    `exec "$CLAUDE_BIN" ${claudeArgs.join(" ")}`
  ].join(" && ");
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

    const thinkingBudgetTokens = claudeModelSupportsThinkingBudget(model)
      ? claudeThinkingBudgetTokensForProfile(task.providerProfile)
      : undefined;

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
        ["TASK_INTERACTIVE_WORKSPACE", INTERACTIVE_WORKSPACE_PATH],
        ...(typeof thinkingBudgetTokens === "number" ? [["MAX_THINKING_TOKENS", String(thinkingBudgetTokens)] as [string, string]] : []),
        ...buildInteractiveWorkspaceGitEnvEntries(INTERACTIVE_WORKSPACE_PATH)
      ],
      startScript: buildClaudeStartScript(model, buildClaudeSettingsJson())
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
    ["TASK_INTERACTIVE_WORKSPACE", INTERACTIVE_WORKSPACE_PATH],
    ["CODEX_TRUST_WORKSPACE", INTERACTIVE_WORKSPACE_PATH],
    ...buildInteractiveWorkspaceGitEnvEntries(INTERACTIVE_WORKSPACE_PATH)
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
      Buffer.from(buildCodexUserConfigToml(INTERACTIVE_WORKSPACE_PATH, model), "utf8").toString("base64"),
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
  hasAttachedClient: () => boolean;
  canResume: () => boolean;
  attachClient: (ws: WebSocket) => boolean;
  terminate: (reason?: string) => Promise<void>;
}

const activeInteractiveTerminalControllers = new Map<string, ActiveInteractiveTerminalController>();

function getActiveInteractiveTerminalController(
  taskId: string,
  sessionId?: string | null
): ActiveInteractiveTerminalController | null {
  const active = activeInteractiveTerminalControllers.get(taskId);
  if (!active) {
    return null;
  }
  if (sessionId && active.sessionId !== sessionId) {
    return null;
  }
  return active;
}

function registerActiveInteractiveTerminalController(
  taskId: string,
  controller: ActiveInteractiveTerminalController
): void {
  activeInteractiveTerminalControllers.set(taskId, controller);
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
  /** When true, the browser can reconnect to an existing live terminal session for this task. */
  resumableInteractiveSession?: boolean;
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

  const activeInteractiveSession = await taskStore.getActiveInteractiveSession(taskId);
  if (activeInteractiveSession) {
    const controller = getActiveInteractiveTerminalController(taskId, activeInteractiveSession.sessionId);
    if (!controller) {
      return {
        available: false,
        reason: "An interactive terminal session is active but cannot be resumed from this server process. Use Kill Terminal to clear it.",
        activeInteractiveSession: true
      };
    }
    if (controller.hasAttachedClient()) {
      return {
        available: false,
        reason: "An interactive terminal session is already open in another window.",
        activeInteractiveSession: true
      };
    }
    if (controller.canResume()) {
      return {
        available: true,
        reason: "Resume the active interactive terminal session.",
        activeInteractiveSession: true,
        resumableInteractiveSession: true
      };
    }
    return {
      available: false,
      reason: "The interactive terminal session is shutting down.",
      activeInteractiveSession: true
    };
  }

  if (await taskStore.hasPendingChangeProposal(taskId)) {
    return { available: false, reason: "Apply or reject the pending checkpoint before opening a terminal." };
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
  const activeInteractiveSession = await deps.taskStore.getActiveInteractiveSession(taskId);
  if (activeInteractiveSession) {
    const controller = getActiveInteractiveTerminalController(taskId, activeInteractiveSession.sessionId);
    if (!controller) {
      sendInteractiveTerminalError(
        ws,
        "An interactive terminal session is active but cannot be resumed from this server process. Use Kill Terminal to clear it."
      );
      return;
    }
    if (controller.hasAttachedClient()) {
      sendInteractiveTerminalError(ws, "An interactive terminal session is already open in another window.");
      return;
    }
    if (!controller.attachClient(ws)) {
      sendInteractiveTerminalError(ws, "The interactive terminal session is shutting down.");
      return;
    }
    return;
  }

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
    const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
    const dockerBindSource = path.join(env.TASK_WORKSPACE_HOST_ROOT, taskId);
    const gitRuntimeMounts = await resolveWorkspaceGitRuntimeMounts(workspaceOnServer);
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
      ...gitRuntimeMounts,
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
      spawner: deps.spawner,
      taskStore: deps.taskStore
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
  proposalCtx: { taskId: string; sessionId: string; spawner: SpawnerService; taskStore: TaskStore }
): void {
  let sawTerminalOutput = false;
  let transcriptBuffer = "";
  let transcriptTruncated = false;
  let transcriptSaved = false;
  let currentWs: WebSocket | null = null;
  let currentWsCleanup: (() => void) | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveChildExit: (() => void) | null = null;
  const childExitPromise = new Promise<void>((resolve) => {
    resolveChildExit = resolve;
  });

  const logLifecycle = (message: string): void => {
    const taskMessage = `Interactive terminal (${proposalCtx.sessionId}): ${message}`;
    console.info(`[interactive-terminal][${proposalCtx.taskId}][${proposalCtx.sessionId}] ${message}`);
    void proposalCtx.taskStore.appendLog(proposalCtx.taskId, taskMessage).catch(() => undefined);
  };

  const appendTranscriptChunk = (chunk: string): void => {
    if (transcriptTruncated || chunk.length === 0) {
      return;
    }

    const remaining = INTERACTIVE_TRANSCRIPT_LIMIT - transcriptBuffer.length;
    if (remaining <= 0) {
      transcriptTruncated = true;
      return;
    }

    if (chunk.length > remaining) {
      transcriptBuffer += chunk.slice(0, remaining);
      transcriptTruncated = true;
      return;
    }

    transcriptBuffer += chunk;
  };

  const persistTranscriptIfNeeded = async (): Promise<void> => {
    if (transcriptSaved || (!transcriptTruncated && transcriptBuffer.length === 0)) {
      return;
    }

    transcriptSaved = true;
    await proposalCtx.taskStore
      .saveInteractiveTerminalTranscript(proposalCtx.taskId, proposalCtx.sessionId, transcriptBuffer, transcriptTruncated)
      .catch(() => undefined);
  };

  const clearResumeTimer = (): void => {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const detachCurrentClient = (reason: string, allowResume: boolean): void => {
    const activeWs = currentWs;
    currentWs = null;
    if (currentWsCleanup) {
      currentWsCleanup();
      currentWsCleanup = null;
    }
    if (!activeWs || cleanupPromise) {
      return;
    }
    if (!allowResume) {
      clearResumeTimer();
      return;
    }
    clearResumeTimer();
    logLifecycle(`${reason}; waiting ${Math.round(INTERACTIVE_RESUME_GRACE_MS / 1000)}s for a reconnect before ending the session.`);
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      void controller.terminate("Reconnect window expired.");
    }, INTERACTIVE_RESUME_GRACE_MS);
  };

  const cleanupSession = (reason = "Interactive terminal session terminated."): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    cleanupPromise = (async () => {
      unregisterActiveInteractiveTerminalController(proposalCtx.taskId, proposalCtx.sessionId);
      clearResumeTimer();
      const activeWs = currentWs;
      detachCurrentClient(reason, false);
      logLifecycle(reason);
      try {
        if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
          activeWs.close(INTERACTIVE_TERMINAL_CLOSE_CODE, "interactive terminal terminated");
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
      await Promise.race([
        childExitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, INTERACTIVE_EXIT_WAIT_MS))
      ]);
      await persistTranscriptIfNeeded();
      await proposalCtx.spawner.endInteractiveTerminalSession(proposalCtx.taskId, proposalCtx.sessionId).catch(() => undefined);
    })();

    return cleanupPromise;
  };

  const controller: ActiveInteractiveTerminalController = {
    sessionId: proposalCtx.sessionId,
    hasAttachedClient: () => currentWs !== null,
    canResume: () => currentWs === null && cleanupPromise === null,
    attachClient: (nextWs) => {
      if (cleanupPromise || currentWs) {
        return false;
      }

      const isResume = resumeTimer !== null;
      clearResumeTimer();
      currentWs = nextWs;
      let awaitingPong = false;
      let pendingResumeReplay = isResume && transcriptBuffer.length > 0;

      const flushResumeReplay = (): boolean => {
        if (!pendingResumeReplay || nextWs.readyState !== WebSocket.OPEN) {
          return true;
        }
        try {
          nextWs.send(Buffer.from(transcriptBuffer, "utf8"), { binary: true });
          pendingResumeReplay = false;
          return true;
        } catch (error) {
          const message = error instanceof Error && error.message.trim() ? error.message.trim() : "could not replay terminal transcript";
          detachCurrentClient(`Could not replay terminal transcript: ${message}.`, false);
          void cleanupSession(`Could not replay terminal transcript: ${message}.`);
          return false;
        }
      };

      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
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
              if (!flushResumeReplay()) {
                return;
              }
            }
          }
        } catch {
          /* ignore */
        }
      };

      const onClose = (code: number, reason: Buffer) => {
        detachCurrentClient(`Client disconnected (code ${code}${reason.length > 0 ? `, reason: ${JSON.stringify(reason.toString("utf8"))}` : ""}).`, true);
      };

      const onError = (error: Error) => {
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : "unknown WebSocket error";
        detachCurrentClient(`WebSocket error: ${message}.`, true);
      };

      const onPong = () => {
        awaitingPong = false;
      };

      const heartbeatInterval = setInterval(() => {
        if (cleanupPromise || currentWs !== nextWs) {
          return;
        }
        if (awaitingPong) {
          detachCurrentClient("WebSocket ping timeout.", false);
          void cleanupSession("WebSocket ping timeout.");
          return;
        }
        awaitingPong = true;
        try {
          nextWs.ping();
        } catch (error) {
          const message = error instanceof Error && error.message.trim() ? error.message.trim() : "could not send ping";
          detachCurrentClient(`WebSocket ping failed: ${message}.`, false);
          void cleanupSession(`WebSocket ping failed: ${message}.`);
        }
      }, INTERACTIVE_WS_PING_INTERVAL_MS);

      currentWsCleanup = () => {
        clearInterval(heartbeatInterval);
        nextWs.off("message", onMessage);
        nextWs.off("close", onClose);
        nextWs.off("error", onError);
        nextWs.off("pong", onPong);
      };

      nextWs.on("message", onMessage);
      nextWs.on("close", onClose);
      nextWs.on("error", onError);
      nextWs.on("pong", onPong);

      if (isResume) {
        logLifecycle("Client resumed the live interactive terminal session.");
      }

      return true;
    },
    terminate: (reason?: string) => cleanupSession(reason)
  };

  registerActiveInteractiveTerminalController(proposalCtx.taskId, controller);

  child.onData((data) => {
    sawTerminalOutput = true;
    appendTranscriptChunk(data);
    if (currentWs?.readyState === WebSocket.OPEN) {
      currentWs.send(Buffer.from(data, "utf8"), { binary: true });
    }
  });

  child.onExit((event) => {
    resolveChildExit?.();
    resolveChildExit = null;
    const exitSummary = `exit code ${event.exitCode}${event.signal ? `, signal ${event.signal}` : ""}`;
    if (!sawTerminalOutput) {
      if (currentWs?.readyState === WebSocket.OPEN) {
        try {
          currentWs.send(JSON.stringify({ type: "error", message: "Interactive process exited before it produced terminal output." }));
        } catch {
          /* ignore */
        }
      }
      void cleanupSession(`Interactive process exited before it produced terminal output (${exitSummary}).`);
      return;
    }
    void cleanupSession(`Interactive process exited (${exitSummary}).`);
  });

  if (!controller.attachClient(ws)) {
    void cleanupSession("Could not attach the initial terminal client.");
  }
}
