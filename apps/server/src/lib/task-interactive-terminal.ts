import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants, rm } from "node:fs/promises";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";
import pty from "node-pty";

import {
  getTaskStatusLabel,
  getTaskTerminalSessionLabel,
  getTaskTerminalSessionSentenceLabel,
  isActiveTaskStatus,
  isQueuedTaskStatus,
  type Task,
  type TaskTerminalSessionMode
} from "@verft/shared-types";

import { AGENT_RUNTIME_IMAGE, DEFAULT_GIT_COMMIT_IDENTITY, env } from "../config/env.js";
import type { AuthService } from "./auth.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { RepositoryStore } from "../services/repository-store.js";
import { canUserAccessTask } from "./task-ownership.js";
import { resolveWorkspaceGitRuntimeMounts } from "./git-runtime-mounts.js";
import { buildLinkedWorkspaceMountPlan } from "./linked-workspaces.js";
import { materializeRepositoryRuntimeEnvEntries } from "./repository-runtime-env.js";
import { buildTerminalStartScript } from "./task-interactive-terminal-start-script.js";
import { resolveTaskGitCommitIdentity, type GitCommitIdentity } from "./task-git-identity.js";
import {
  buildTerminalDockerEnvEntries,
  buildTerminalEnvEntries
} from "./task-interactive-terminal-git-env.js";
import { buildDockerWorkspaceMountArgs } from "./docker-workspace-mounts.js";
import { buildHostexecRuntimeConfig } from "./hostexec-runtime.js";
import type { UserStore } from "../services/user-store.js";
import { RepositoryEnvFileStore } from "../services/repository-env-file-store.js";
import { resolveDockerSocketAccessPolicy, resolveDockerSocketRunArgs } from "./docker-socket-access.js";

const WS_PATH_RE = /^\/tasks\/([^/]+)\/terminal$/;
const INTERACTIVE_WORKSPACE_PATH = "/workspace";
const INTERACTIVE_WS_PING_INTERVAL_MS = 25_000;
const INTERACTIVE_TRANSCRIPT_LIMIT = 2_000_000;
const INTERACTIVE_EXIT_WAIT_MS = 1_500;
const INTERACTIVE_TERMINAL_CLOSE_CODE = 1012;
const repositoryEnvFileStore = new RepositoryEnvFileStore();

function buildTaskWorkspaceMountArgs(sourceRelativePath: string, targetPath: string, mode: "ro" | "rw"): string[] {
  return buildDockerWorkspaceMountArgs({
    sourceRoot: env.TASK_WORKSPACE_DOCKER_SOURCE,
    sourceRelativePath,
    targetPath,
    mode
  });
}

function normalizeTerminalSessionMode(_value: string | null | undefined): TaskTerminalSessionMode {
  return "terminal";
}

type InteractiveRuntimeCredentials = Awaited<ReturnType<SettingsStore["getRuntimeCredentials"]>>;

function resolveGitTerminalRuntimeConfig(
  credentials: InteractiveRuntimeCredentials,
  gitIdentity?: GitCommitIdentity | null
):
  | {
      ok: true;
      image: string;
      envEntries: Array<[string, string]>;
      startScript: string;
    }
  | {
      ok: false;
      reason: string;
    } {
  const envEntries = buildTerminalEnvEntries({
    workspacePath: INTERACTIVE_WORKSPACE_PATH,
    githubToken: credentials.githubToken,
    gitUsername: credentials.gitUsername,
    gitIdentity
  });
  const addCredentialEnv = (name: string, value: string | null | undefined): void => {
    const normalized = value?.trim();
    if (normalized) {
      envEntries.push([name, normalized]);
    }
  };

  addCredentialEnv("OPENAI_API_KEY", credentials.openaiApiKey);
  addCredentialEnv("OPENAI_BASE_URL", credentials.openaiBaseUrl);
  addCredentialEnv("ANTHROPIC_API_KEY", credentials.anthropicApiKey);
  addCredentialEnv("ANTHROPIC_BASE_URL", credentials.anthropicBaseUrl);

  return {
    ok: true,
    image: AGENT_RUNTIME_IMAGE,
    envEntries,
    startScript: buildTerminalStartScript()
  };
}

function forceRemoveDockerSession(containerName: string): void {
  const child = spawnChild("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function terminalImageBuildHint(_mode: TaskTerminalSessionMode, _provider: Task["provider"], image: string): string {
  return `docker build -f agent-runtime/Dockerfile -t ${image} agent-runtime`;
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
  userStore: Pick<UserStore, "getUser">;
  repositoryStore: Pick<RepositoryStore, "getRepositoryRuntimeEnvEntries" | "getRepositoryHostCommands">;
}

interface ActiveInteractiveTerminalController {
  sessionId: string;
  mode: TaskTerminalSessionMode;
  hasAttachedClient: () => boolean;
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
      ws.close(1011, "terminal failed");
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
  /** Present when a terminal session is active for the task. */
  terminalMode?: TaskTerminalSessionMode;
};

export async function getTaskInteractiveTerminalStatus(
  taskStore: TaskStore,
  settingsStore: SettingsStore,
  taskId: string,
  mode: TaskTerminalSessionMode = "terminal",
  userId?: string | null
): Promise<TaskInteractiveTerminalStatusPayload> {
  const task = await taskStore.getTaskMetadata(taskId);
  if (!task) {
    return { available: false, reason: "Task not found." };
  }

  if (task.status === "archived") {
    return { available: false, reason: "Archived tasks are read-only." };
  }

  if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
    return {
      available: false,
      reason: "Terminal unavailable while the task is queued or running. Finish or cancel that run first (one action at a time)."
    };
  }

  const activeInteractiveSession = await taskStore.getActiveInteractiveSession(taskId);
  if (activeInteractiveSession) {
    const controller = getActiveInteractiveTerminalController(taskId, activeInteractiveSession.sessionId);
    const activeModeLabel = getTaskTerminalSessionLabel(activeInteractiveSession.mode);
    if (!controller) {
      return {
        available: false,
        reason: `${activeModeLabel} session is active but unavailable from this server process. Use Kill Terminal to clear it.`,
        activeInteractiveSession: true,
        terminalMode: activeInteractiveSession.mode
      };
    }
    if (activeInteractiveSession.mode !== mode) {
      return {
        available: false,
        reason: `${activeModeLabel} session is already active for this task. Stop it before opening ${getTaskTerminalSessionLabel(mode)}.`,
        activeInteractiveSession: true,
        terminalMode: activeInteractiveSession.mode
      };
    }
    if (controller.hasAttachedClient()) {
      return {
        available: false,
        reason: `${activeModeLabel} session is already open in another window.`,
        activeInteractiveSession: true,
        terminalMode: activeInteractiveSession.mode
      };
    }
    return {
      available: false,
      reason: `The ${getTaskTerminalSessionSentenceLabel(mode)} session is shutting down.`,
      activeInteractiveSession: true,
      terminalMode: activeInteractiveSession.mode
    };
  }

  const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
  try {
    await access(workspaceOnServer, constants.R_OK | constants.X_OK);
  } catch {
    return { available: false, reason: "No workspace folder on disk for this task yet." };
  }

  const credentials = await settingsStore.getRuntimeCredentials();
  const runtime = resolveGitTerminalRuntimeConfig(credentials);
  if (!runtime.ok) {
    return { available: false, reason: runtime.reason };
  }
  if (!(await dockerImageExists(runtime.image))) {
    return {
      available: false,
      reason: `Terminal image "${runtime.image}" is not available on the Docker host. Build it first: ${terminalImageBuildHint(mode, task.provider, runtime.image)}`
    };
  }

  return { available: true };
}

/**
 * Handles WebSocket upgrades for `/tasks/:taskId/terminal`.
 * Prepended so Socket.io still receives `/socket.io/` upgrades.
 */
export function attachTaskInteractiveTerminalUpgrade(httpServer: HttpServer, deps: TaskInteractiveTerminalDeps): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.prependListener("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host ?? "127.0.0.1";
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    const pathOnly = requestUrl.pathname;
    const terminalMode = normalizeTerminalSessionMode(requestUrl.searchParams.get("mode"));
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
      if (!auth.scopes.has("task:terminal")) {
        denySocket(socket, 403, "task:terminal scope required");
        return;
      }

      const task = await deps.taskStore.getTask(taskId);
      if (!task || !canUserAccessTask(auth.user, task)) {
        denySocket(socket, 404, "Task not found");
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        void initializeTaskInteractiveTerminalWebSocket(ws, task, deps, terminalMode, auth.user.id).catch(() => {
          sendInteractiveTerminalError(ws, `${getTaskTerminalSessionLabel(terminalMode)} initialization failed.`);
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
  deps: TaskInteractiveTerminalDeps,
  mode: TaskTerminalSessionMode,
  userId?: string | null
): Promise<void> {
  const taskId = task.id;
  const activeInteractiveSession = await deps.taskStore.getActiveInteractiveSession(taskId);
  if (activeInteractiveSession) {
    const controller = getActiveInteractiveTerminalController(taskId, activeInteractiveSession.sessionId);
    const activeModeLabel = getTaskTerminalSessionLabel(activeInteractiveSession.mode);
    if (!controller) {
      sendInteractiveTerminalError(
        ws,
        `${activeModeLabel} session is active but unavailable from this server process. Use Kill Terminal to clear it.`
      );
      return;
    }
    if (activeInteractiveSession.mode !== mode) {
      sendInteractiveTerminalError(
        ws,
        `${activeModeLabel} session is already active for this task. Stop it before opening ${getTaskTerminalSessionLabel(mode)}.`
      );
      return;
    }
    if (controller.hasAttachedClient()) {
      sendInteractiveTerminalError(ws, `${activeModeLabel} session is already open in another window.`);
      return;
    }
    if (!controller.attachClient(ws)) {
      sendInteractiveTerminalError(ws, `The ${getTaskTerminalSessionSentenceLabel(mode)} session is shutting down.`);
      return;
    }
    return;
  }

  const status = await getTaskInteractiveTerminalStatus(deps.taskStore, deps.settingsStore, taskId, mode, userId);
  if (!status.available) {
    sendInteractiveTerminalError(ws, status.reason ?? `${getTaskTerminalSessionLabel(mode)} is unavailable`);
    return;
  }

  let terminalSessionId: string | null = null;
  let sessionRepositoryEnvDir: string | null = null;

  try {
    const started = await deps.spawner.beginInteractiveTerminalSession(taskId, mode);
    terminalSessionId = started.sessionId;
    await deps.spawner.ensureTaskHome(taskId);
    const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
    const dockerBindSource = path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, taskId);
    const gitRuntimeMounts = await resolveWorkspaceGitRuntimeMounts(workspaceOnServer);
    const linkedWorkspaceMountPlan = await buildLinkedWorkspaceMountPlan({
      rootWorkspacePath: workspaceOnServer,
      containerWorkspacePath: INTERACTIVE_WORKSPACE_PATH,
      linkedWorkspaces: task.linkedWorkspaces
    });
    const [
      credentials,
      settings,
      repositoryRuntimeEnvEntries,
      repositoryHostCommands
    ] = await Promise.all([
      deps.settingsStore.getRuntimeCredentials(),
      deps.settingsStore.getSettings(),
      deps.repositoryStore.getRepositoryRuntimeEnvEntries(task.repoId),
      deps.repositoryStore.getRepositoryHostCommands(task.repoId)
    ]);
    const gitIdentity = resolveTaskGitCommitIdentity(settings, {
      ...DEFAULT_GIT_COMMIT_IDENTITY
    });
    const runtime = resolveGitTerminalRuntimeConfig(credentials, gitIdentity);
    if (!runtime.ok) {
      throw new Error(runtime.reason);
    }
    const runtimeMcp = await deps.spawner.buildRuntimeMcpConfigForTask(task, terminalSessionId);

    const sessionName = `aswterm-${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const repositoryEnvDir = path.join(env.RUNTIME_PAYLOAD_ROOT, "terminal-env", taskId, terminalSessionId);
    sessionRepositoryEnvDir = repositoryEnvDir;
    const repositoryRuntimeEnv = await materializeRepositoryRuntimeEnvEntries({
      destinationDir: repositoryEnvDir,
      entries: repositoryRuntimeEnvEntries,
      fileStore: repositoryEnvFileStore
    });
    const runtimeMcpDockerArgs = deps.spawner.buildRuntimeMcpDockerArgs(runtimeMcp.injectedVerftMcp);
    const hostexecRuntime = await buildHostexecRuntimeConfig({
      settings: settings.hostexec,
      repositoryCommands: repositoryHostCommands,
      payloadDir: repositoryEnvDir,
      taskId,
      repoId: task.repoId,
      containerWorkspacePath: INTERACTIVE_WORKSPACE_PATH,
      hostWorkspacePath: dockerBindSource,
      sharedNetworkWithCurrentContainer: runtimeMcpDockerArgs.includes("--network")
    });
    const dockerSocketRunArgs = resolveDockerSocketRunArgs(resolveDockerSocketAccessPolicy("codex"));
    const dockerEnv: string[] = [];
    for (const [name, value] of buildTerminalDockerEnvEntries({
      runtimeEnvEntries: [...runtime.envEntries, ...Object.entries(runtimeMcp.env), ...hostexecRuntime.envEntries],
      repositoryEnvEntries: repositoryRuntimeEnv
    })) {
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
      ...runtimeMcpDockerArgs,
      ...hostexecRuntime.dockerArgs,
      "-v",
      `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
      ...buildTaskWorkspaceMountArgs(taskId, INTERACTIVE_WORKSPACE_PATH, "rw"),
      ...linkedWorkspaceMountPlan.mountArgs,
      ...gitRuntimeMounts,
      ...hostexecRuntime.mountArgs,
      ...deps.spawner.buildTaskHomeMountArgs(taskId),
      ...dockerSocketRunArgs,
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
      env: { ...process.env, TERM: "xterm-256color", VERFT_TERMINAL_MODE: mode },
    });

    wireTerminalWebSocket(ws, child, {
      taskId,
      sessionId: terminalSessionId,
      spawner: deps.spawner,
      taskStore: deps.taskStore,
      mode,
      cleanup: async () => {
        forceRemoveDockerSession(sessionName);
        await rm(repositoryEnvDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  } catch (error) {
    if (sessionRepositoryEnvDir) {
      await rm(sessionRepositoryEnvDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (terminalSessionId) {
      await deps.spawner.endInteractiveTerminalSession(taskId, terminalSessionId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : `Could not start ${getTaskTerminalSessionSentenceLabel(mode)} session`;
    sendInteractiveTerminalError(ws, message);
  }
}

function wireTerminalWebSocket(
  ws: WebSocket,
  child: pty.IPty,
  proposalCtx: {
    taskId: string;
    sessionId: string;
    spawner: SpawnerService;
    taskStore: TaskStore;
    mode: TaskTerminalSessionMode;
    cleanup?: () => Promise<void> | void;
  }
): void {
  let sawTerminalOutput = false;
  let transcriptBuffer = "";
  let transcriptTruncated = false;
  let transcriptSaved = false;
  let currentWs: WebSocket | null = null;
  let currentWsCleanup: (() => void) | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let resolveChildExit: (() => void) | null = null;
  const childExitPromise = new Promise<void>((resolve) => {
    resolveChildExit = resolve;
  });
  const terminalLabel = getTaskTerminalSessionLabel(proposalCtx.mode);
  const terminalSentenceLabel = getTaskTerminalSessionSentenceLabel(proposalCtx.mode);

  const logLifecycle = (message: string): void => {
    const taskMessage = `${terminalSentenceLabel} (${proposalCtx.sessionId}): ${message}`;
    console.info(`[terminal][${proposalCtx.taskId}][${proposalCtx.sessionId}] ${message}`);
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

  const detachCurrentClient = (): WebSocket | null => {
    const activeWs = currentWs;
    currentWs = null;
    if (currentWsCleanup) {
      currentWsCleanup();
      currentWsCleanup = null;
    }
    return activeWs;
  };

  const cleanupSession = (reason = `${terminalLabel} session terminated.`): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    cleanupPromise = (async () => {
      unregisterActiveInteractiveTerminalController(proposalCtx.taskId, proposalCtx.sessionId);
      const activeWs = detachCurrentClient();
      logLifecycle(reason);
      try {
        if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
          activeWs.close(INTERACTIVE_TERMINAL_CLOSE_CODE, "terminal session terminated");
        }
      } catch {
        /* ignore */
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      await proposalCtx.cleanup?.();
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
    mode: proposalCtx.mode,
    hasAttachedClient: () => currentWs !== null,
    attachClient: (nextWs) => {
      if (cleanupPromise || currentWs) {
        return false;
      }

      currentWs = nextWs;
      let awaitingPong = false;

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
            }
          }
        } catch {
          /* ignore */
        }
      };

      const onClose = (code: number, reason: Buffer) => {
        detachCurrentClient();
        void cleanupSession(`Client disconnected (code ${code}${reason.length > 0 ? `, reason: ${JSON.stringify(reason.toString("utf8"))}` : ""}).`);
      };

      const onError = (error: Error) => {
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : "unknown WebSocket error";
        detachCurrentClient();
        void cleanupSession(`WebSocket error: ${message}.`);
      };

      const onPong = () => {
        awaitingPong = false;
      };

      const heartbeatInterval = setInterval(() => {
        if (cleanupPromise || currentWs !== nextWs) {
          return;
        }
        if (awaitingPong) {
          detachCurrentClient();
          void cleanupSession("WebSocket ping timeout.");
          return;
        }
        awaitingPong = true;
        try {
          nextWs.ping();
        } catch (error) {
          const message = error instanceof Error && error.message.trim() ? error.message.trim() : "could not send ping";
          detachCurrentClient();
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
          currentWs.send(JSON.stringify({ type: "error", message: "Terminal process exited before it produced terminal output." }));
        } catch {
          /* ignore */
        }
      }
      void cleanupSession(`Terminal process exited before it produced terminal output (${exitSummary}).`);
      return;
    }
    void cleanupSession(`Terminal process exited (${exitSummary}).`);
  });

  if (!controller.attachClient(ws)) {
    void cleanupSession("Could not attach the initial terminal client.");
  }
}
