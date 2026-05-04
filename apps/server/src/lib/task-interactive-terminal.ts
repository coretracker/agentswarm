import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
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
} from "@agentswarm/shared-types";

import { env } from "../config/env.js";
import type { AuthService } from "./auth.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskMetadata, TaskStore } from "../services/task-store.js";
import type { RepositoryStore } from "../services/repository-store.js";
import { canUserAccessTask } from "./task-ownership.js";
import { resolveWorkspaceGitRuntimeMounts } from "./git-runtime-mounts.js";
import {
  claudeModelSupportsThinkingBudget,
  claudeThinkingBudgetTokensForProfile,
  codexReasoningEffortForProfile,
  defaultModelForProvider
} from "./provider-config.js";
import { collectMcpServerEnvEntries, serializeClaudeMcpConfig, serializeCodexMcpConfig } from "./mcp-config.js";
import { ensureTaskProviderStatePaths } from "./task-provider-state.js";
import { buildGitTerminalStartScript } from "./task-interactive-terminal-start-script.js";
import { resolveTaskGitCommitIdentity, type GitCommitIdentity } from "./task-git-identity.js";
import {
  buildGitTerminalDockerEnvEntries,
  buildGitTerminalEnvEntries,
  buildInteractiveWorkspaceGitEnvEntries
} from "./task-interactive-terminal-git-env.js";
import type { UserStore } from "../services/user-store.js";

const WS_PATH_RE = /^\/tasks\/([^/]+)\/interactive-terminal$/;
const INTERACTIVE_WORKSPACE_PATH = "/workspace";
const INTERACTIVE_WS_PING_INTERVAL_MS = 25_000;
const INTERACTIVE_TRANSCRIPT_LIMIT = 2_000_000;
const INTERACTIVE_EXIT_WAIT_MS = 1_500;
const INTERACTIVE_TERMINAL_CLOSE_CODE = 1012;
const PROVIDER_SESSION_ID_FILE = "agentswarm-session-id.txt";

function normalizeTerminalSessionMode(value: string | null | undefined): TaskTerminalSessionMode {
  return value === "git" ? "git" : "interactive";
}

function buildCodexUserConfigToml(workspacePath: string, model: string, mcpConfig: string): string {
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

${mcpConfig}`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildCodexStartScript(configB64: string, model: string, reasoningEffort: string, preferAuthJson: boolean): string {
  const codexArgs = [
    "--dangerously-bypass-approvals-and-sandbox",
    '-C "$TASK_INTERACTIVE_WORKSPACE"',
    "-m",
    shellSingleQuote(model),
    "-c cli_auth_credentials_store=file",
    ...(preferAuthJson ? [] : ["-c forced_login_method=api"]),
    "-c",
    shellSingleQuote(`model_reasoning_effort="${reasoningEffort}"`)
  ];

  const authBootstrap = preferAuthJson
    ? 'printf %s "$CODEX_AUTH_JSON_B64" | base64 -d > ~/.codex/auth.json'
    : 'printf %s "$OPENAI_API_KEY" | codex login --with-api-key -c cli_auth_credentials_store=file';

  return [
    "mkdir -p ~/.codex",
    `printf '%s' ${shellSingleQuote(configB64)} | base64 -d > ~/.codex/config.toml`,
    authBootstrap,
    `SESSION_FILE="$HOME/.codex/${PROVIDER_SESSION_ID_FILE}"`,
    'SESSION_ID=""',
    'if [ -f "$SESSION_FILE" ]; then IFS= read -r SESSION_ID < "$SESSION_FILE" || true; fi',
    `if [ -n "$SESSION_ID" ]; then exec codex resume ${codexArgs.join(" ")} "$SESSION_ID"; fi`,
    `exec codex ${codexArgs.join(" ")}`,
  ].join(" && ");
}

function buildClaudeSettingsJson(): string {
  return JSON.stringify({
    autoUpdaterStatus: "disabled",
    disableBypassPermissionsMode: "disable"
  });
}

function buildClaudeStartScript(model: string, settingsJson: string, mcpConfigB64: string): string {
  const claudeArgs = [
    "--model",
    shellSingleQuote(model),
    "--settings",
    shellSingleQuote(settingsJson),
    "--mcp-config",
    '"$HOME/.claude/mcp-config.json"'
  ];

  return [
    'mkdir -p "$HOME/.claude" "$HOME/.local/bin"',
    'if [ ! -x "$HOME/.local/bin/claude" ] && [ -x "/opt/claude-code/.local/bin/claude" ]; then ln -sf "/opt/claude-code/.local/bin/claude" "$HOME/.local/bin/claude"; fi',
    'CLAUDE_BIN="$HOME/.local/bin/claude"',
    'if [ ! -x "$CLAUDE_BIN" ] && [ -x "/opt/claude-code/.local/bin/claude" ]; then CLAUDE_BIN="/opt/claude-code/.local/bin/claude"; fi',
    'if [ ! -x "$CLAUDE_BIN" ]; then CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"; fi',
    'if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then echo "Claude CLI not found in image." >&2; exit 127; fi',
    `printf '%s' ${shellSingleQuote(mcpConfigB64)} | base64 -d > "$HOME/.claude/mcp-config.json"`,
    'cd "$TASK_INTERACTIVE_WORKSPACE"',
    `SESSION_FILE="$HOME/.claude/${PROVIDER_SESSION_ID_FILE}"`,
    'SESSION_ID=""',
    'if [ -f "$SESSION_FILE" ]; then IFS= read -r SESSION_ID < "$SESSION_FILE" || true; fi',
    "sleep 1",
    `if [ -n "$SESSION_ID" ]; then exec "$CLAUDE_BIN" --resume "$SESSION_ID" ${claudeArgs.join(" ")}; fi`,
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
  const image = env.GIT_TERMINAL_IMAGE?.trim();
  if (!image) {
    return { ok: false, reason: "Git terminal is not configured (set GIT_TERMINAL_IMAGE on the server)." };
  }

  return {
    ok: true,
    image,
    envEntries: buildGitTerminalEnvEntries({
      workspacePath: INTERACTIVE_WORKSPACE_PATH,
      githubToken: credentials.githubToken,
      gitUsername: credentials.gitUsername,
      gitIdentity
    }),
    startScript: buildGitTerminalStartScript()
  };
}

function resolveInteractiveTerminalModel(task: Pick<TaskMetadata, "provider" | "providerProfile" | "modelOverride">): string {
  const configured = task.modelOverride?.trim();
  if (configured) {
    return configured;
  }

  return defaultModelForProvider(task.provider, task.providerProfile) ?? (task.provider === "claude" ? "claude-sonnet-4-5" : "gpt-5.4");
}

function resolveInteractiveTerminalRuntimeConfig(
  task: Pick<TaskMetadata, "provider" | "providerProfile" | "modelOverride">,
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
        ...collectMcpServerEnvEntries(settings.mcpServers),
        ...buildInteractiveWorkspaceGitEnvEntries(INTERACTIVE_WORKSPACE_PATH)
      ],
      startScript: buildClaudeStartScript(
        model,
        buildClaudeSettingsJson(),
        Buffer.from(serializeClaudeMcpConfig(settings.mcpServers), "utf8").toString("base64")
      )
    };
  }

  const image = env.CODEX_INTERACTIVE_IMAGE?.trim();
  if (!image) {
    return { ok: false, reason: "Interactive Codex is not configured (set CODEX_INTERACTIVE_IMAGE on the server)." };
  }
  if (!credentials.openaiApiKey && !credentials.codexAuthJson) {
    return { ok: false, reason: "OpenAI API key or profile Codex auth.json is not configured." };
  }
  const useCodexAuthJson = Boolean(credentials.codexAuthJson);

  const envEntries: Array<[string, string]> = [
    ...(credentials.openaiApiKey ? [["OPENAI_API_KEY", credentials.openaiApiKey] as [string, string]] : []),
    ...(credentials.codexAuthJson
      ? [["CODEX_AUTH_JSON_B64", Buffer.from(credentials.codexAuthJson, "utf8").toString("base64")] as [string, string]]
      : []),
    ["TERM", "xterm-256color"],
    ["HOME", "/root"],
    ["TASK_INTERACTIVE_WORKSPACE", INTERACTIVE_WORKSPACE_PATH],
    ["CODEX_TRUST_WORKSPACE", INTERACTIVE_WORKSPACE_PATH],
    ...collectMcpServerEnvEntries(settings.mcpServers),
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
      Buffer.from(
        buildCodexUserConfigToml(
          INTERACTIVE_WORKSPACE_PATH,
          model,
          serializeCodexMcpConfig(settings.mcpServers)
        ),
        "utf8"
      ).toString("base64"),
      model,
      codexReasoningEffortForProfile(task.providerProfile),
      useCodexAuthJson
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

function terminalImageBuildHint(mode: TaskTerminalSessionMode, provider: Task["provider"], image: string): string {
  const dockerfile =
    mode === "git" ? "Dockerfile.git" : provider === "claude" ? "Dockerfile.claude" : "Dockerfile.codex";
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
  userStore: Pick<UserStore, "getUser">;
  repositoryStore: Pick<RepositoryStore, "getRepository">;
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
  mode: TaskTerminalSessionMode = "interactive",
  userId?: string | null
): Promise<TaskInteractiveTerminalStatusPayload> {
  const task = await taskStore.getTaskMetadata(taskId);
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

  if (mode !== "git" && await taskStore.hasPendingChangeProposal(taskId)) {
    return { available: false, reason: "Apply or reject the pending checkpoint before opening a terminal." };
  }

  const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
  try {
    await access(workspaceOnServer, constants.R_OK | constants.X_OK);
  } catch {
    return { available: false, reason: "No workspace folder on disk for this task yet." };
  }

  if (mode === "git") {
    const credentials = await settingsStore.getRuntimeCredentials(userId);
    const runtime = resolveGitTerminalRuntimeConfig(credentials);
    if (!runtime.ok) {
      return { available: false, reason: runtime.reason };
    }
    if (!(await dockerImageExists(runtime.image))) {
      return {
        available: false,
        reason: `Git terminal image "${runtime.image}" is not available on the Docker host. Build it first: ${terminalImageBuildHint("git", task.provider, runtime.image)}`
      };
    }
    return { available: true };
  }

  const [settings, credentials] = await Promise.all([
    settingsStore.getSettings(),
    settingsStore.getRuntimeCredentials(userId)
  ]);
  const runtime = resolveInteractiveTerminalRuntimeConfig(task, settings, credentials);
  if (!runtime.ok) {
    return { available: false, reason: runtime.reason };
  }
  if (!(await dockerImageExists(runtime.image))) {
    return {
      available: false,
      reason: `Interactive ${runtime.providerLabel} image "${runtime.image}" is not available on the Docker host. Build it first: ${terminalImageBuildHint("interactive", task.provider, runtime.image)}`
    };
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

  let interactiveSessionId: string | null = null;

  try {
    const started = await deps.spawner.beginInteractiveTerminalSession(taskId, mode);
    interactiveSessionId = started.sessionId;
    const workspaceOnServer = path.join(env.TASK_WORKSPACE_ROOT, taskId);
    const dockerBindSource = path.join(env.TASK_WORKSPACE_HOST_ROOT, taskId);
    const gitRuntimeMounts = await resolveWorkspaceGitRuntimeMounts(workspaceOnServer);
    if (mode === "git") {
      const [credentials, gitIdentity, repository] = await Promise.all([
        deps.settingsStore.getRuntimeCredentials(userId),
        resolveTaskGitCommitIdentity(task, deps.userStore, {
          name: env.GIT_USER_NAME,
          email: env.GIT_USER_EMAIL
        }),
        deps.repositoryStore.getRepository(task.repoId)
      ]);
      const runtime = resolveGitTerminalRuntimeConfig(credentials, gitIdentity);
      if (!runtime.ok) {
        throw new Error(runtime.reason);
      }

      const sessionName = `aswgit-${randomUUID().replace(/-/g, "").slice(0, 28)}`;
      const dockerEnv: string[] = [];
      for (const [name, value] of buildGitTerminalDockerEnvEntries({
        runtimeEnvEntries: runtime.envEntries,
        repositoryEnvVars: repository?.envVars
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
        "-v",
        `${dockerBindSource}:/workspace:rw`,
        ...gitRuntimeMounts,
        ...dockerEnv,
        runtime.image,
        "sh",
        "-lc",
        runtime.startScript
      ];

      const child = pty.spawn("docker", dockerArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || "/",
        env: { ...process.env, TERM: "xterm-256color", AGENTSWARM_TERMINAL_MODE: mode }
      });

      wireTerminalWebSocket(ws, child, {
        taskId,
        sessionId: interactiveSessionId,
        spawner: deps.spawner,
        taskStore: deps.taskStore,
        mode,
        forceCleanup: () => {
          forceRemoveDockerSession(sessionName);
        }
      });
      return;
    }

    const [credentials, settings, repository] = await Promise.all([
      deps.settingsStore.getRuntimeCredentials(userId),
      deps.settingsStore.getSettings(),
      deps.repositoryStore.getRepository(task.repoId)
    ]);
    const runtime = resolveInteractiveTerminalRuntimeConfig(task, settings, credentials);
    if (!runtime.ok) {
      throw new Error(runtime.reason);
    }

    const sessionName = `aswix-${randomUUID().replace(/-/g, "").slice(0, 28)}`;
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
    for (const { key, value } of repository?.envVars ?? []) {
      dockerEnv.push("-e", `${key}=${value}`);
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
      env: { ...process.env, TERM: "xterm-256color", AGENTSWARM_TERMINAL_MODE: mode },
    });

    wireTerminalWebSocket(ws, child, {
      taskId,
      sessionId: interactiveSessionId,
      spawner: deps.spawner,
      taskStore: deps.taskStore,
      mode,
      forceCleanup: () => {
        forceRemoveDockerSession(sessionName);
      }
    });
  } catch (error) {
    if (interactiveSessionId) {
      await deps.spawner.endInteractiveTerminalSession(taskId, interactiveSessionId).catch(() => undefined);
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
    forceCleanup?: () => void;
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
      proposalCtx.forceCleanup?.();
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
