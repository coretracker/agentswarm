import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { existsSync, type Dirent } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentResponsePreference,
  getCheckpointMutationBlockedReason,
  getTaskStatusLabel,
  getTaskTerminalSessionEndMessage,
  getTaskTerminalSessionNoChangesMessage,
  getTaskTerminalSessionReviewMessage,
  getTaskTerminalSessionStartMessage,
  isActiveTaskStatus,
  isQueuedTaskStatus,
  type AgentProvider,
  type PermissionScope,
  type NormalizedAgentEvent,
  type McpServerConfig,
  type Task,
  type TaskChangeProposal,
  type TaskExecutionInput,
  type TaskLiveDiff,
  type TaskAction,
  type TaskRun,
  type TaskMergePreview,
  type TaskPushPreview,
  type TaskTerminalSessionMode,
  type TaskWorkspaceFileSearchResult,
  type TaskWorkspaceFilePreview,
  type TaskWorkspaceFileTree,
  type TaskWorkspaceFileTreeEntry,
  type TaskWorkspaceCommit,
  type TaskWorkspaceCommitLog,
  type TaskGitStateSnapshot,
  type TaskGitOperation,
  type TaskGitOperationFailureCode,
  type TaskGitOperationType
} from "@agentswarm/shared-types";
import { makeBranchName } from "../lib/branch.js";
import { buildGitProcessEnv } from "../lib/git-env.js";
import { extractGitLockPathFromErrorMessage, isPathInside, resolveGitTargetLockKey } from "../lib/git-locks.js";
import { resolveGitPaths } from "../lib/git-paths.js";
import { resolveWorkspaceGitRuntimeMounts } from "../lib/git-runtime-mounts.js";
import { buildLinkedWorkspaceMountPlan, LINKED_WORKSPACE_DIRNAME } from "../lib/linked-workspaces.js";
import { buildTaskRuntimeGitEnvEntries } from "../lib/task-interactive-terminal-git-env.js";
import { reconcileTaskStatusWithPendingCheckpoint, resolveTaskReadyStatus } from "../lib/task-status.js";
import { buildTaskCommitSubject, formatCommitSubject } from "../lib/task-commit-subject.js";
import { parsePostflightConfig, postflightAppliesToTask, type PostflightConfig } from "../lib/postflight-config.js";
import { collectMcpServerEnvEntries, collectMissingMcpServerBearerTokenEnvVars } from "../lib/mcp-config.js";
import {
  resolveTaskPromptAttachmentRoot,
  resolveTaskPromptAttachmentServerPath
} from "../lib/task-prompt-attachments.js";
import {
  normalizeSafeWorkspaceRelativePath,
  readSafeWorkspaceFileBuffer,
  resolveSafeWorkspaceFilePath
} from "../lib/safe-workspace-file.js";
import { materializeRepositoryRuntimeEnvEntries } from "../lib/repository-runtime-env.js";
import { parseAgentJsonlEvents } from "../lib/agent-event-parser.js";
import {
  emitDockerSocketEnabledEventOnce,
  emitNestedContainerSpawnedEvent,
  resolveDockerSocketAccessPolicy,
  resolveDockerSocketEnvEntries,
  resolveDockerSocketMountArgs
} from "../lib/docker-socket-access.js";
import { buildDockerWorkspaceMountArgs } from "../lib/docker-workspace-mounts.js";
import { resolveTaskGitCommitIdentity } from "../lib/task-git-identity.js";
import { ensureTaskProviderStatePaths, resolveTaskProviderStatePaths, resolveTaskStateRootPaths } from "../lib/task-provider-state.js";
import { AGENT_RUNTIME_IMAGE, DEFAULT_GIT_COMMIT_IDENTITY, env } from "../config/env.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";
import { executeCodexUtility, CodexUtilityUnavailableError } from "./codex-utility-service.js";
import { buildDiffAssistPromptContext, executeOpenAiDiffAssist } from "./openai-diff-assist-service.js";
import type { TaskStore } from "./task-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { UserStore } from "./user-store.js";
import type { RepositoryStore } from "./repository-store.js";
import type { PersonalAccessTokenStore } from "./personal-access-token-store.js";
import { RepositoryEnvFileStore } from "./repository-env-file-store.js";
import { RepoSyncManager, type RepoSyncOperation } from "./repo-sync-manager.js";
import { SYSTEM_ADMIN_ROLE_ID } from "./role-store.js";

const ansiPattern = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\))/g;
const LIVE_TIMELINE_POLL_INTERVAL_MS = 1_000;
const AUTO_APPLY_COMMIT_MESSAGE_MODEL = "gpt-5.4-mini";
const AUTO_APPLY_COMMIT_MESSAGE_PROFILE = "low";
const AGENTSWARM_RUNTIME_MCP_SERVER_NAME = "agentswarm";
const AGENTSWARM_RUNTIME_MCP_ENDPOINT_ENV = "AGENTSWARM_MCP_ENDPOINT";
const AGENTSWARM_RUNTIME_MCP_ENDPOINTS_ENV = "AGENTSWARM_MCP_ENDPOINTS";
const AGENTSWARM_RUNTIME_MCP_TOKEN_ENV = "AGENTSWARM_MCP_TOKEN";
const AGENTSWARM_RUNTIME_MCP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const AGENTSWARM_RUNTIME_MCP_SCOPES: PermissionScope[] = [
  "repo:list",
  "repo:read",
  "task:list",
  "task:read",
  "task:edit",
  "task:build",
  "task:ask"
];
const AUTO_APPLY_COMMIT_MESSAGE_PROMPT =
  "Generate one git commit subject line based on these changes. Do not use conventional commit prefixes (for example: feat:, feat(scope):, fix:, chore:). Return only a plain subject line with no quotes, bullets, markdown, or explanation.";

const sanitizeChunk = (chunk: string): string =>
  chunk.replace(/\r/g, "\n").replace(ansiPattern, "").replace(/[^\x09\x0A\x20-\x7E]/g, "");

const normalizeGeneratedCommitSubject = (raw: string): string | null => {
  const firstLine = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }

  return firstLine.replace(/^[-*]\s*/, "").replace(/^["'`]+|["'`]+$/g, "").trim() || null;
};

const stripIncompleteTrailingJsonlLine = (rawJsonl: string): string => {
  if (rawJsonl.length === 0 || rawJsonl.endsWith("\n") || rawJsonl.endsWith("\r")) {
    return rawJsonl;
  }

  const lastNewlineIndex = Math.max(rawJsonl.lastIndexOf("\n"), rawJsonl.lastIndexOf("\r"));
  return lastNewlineIndex >= 0 ? rawJsonl.slice(0, lastNewlineIndex + 1) : "";
};

const timelineSignature = (events: NormalizedAgentEvent[]): string => {
  const last = events.at(-1);
  return `${events.length}:${last?.id ?? ""}:${last?.kind ?? ""}:${last?.rawEventIndex ?? ""}`;
};

const sanitizePathSegment = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\\+/g, "/")
    .replace(/\/+$/g, "")
    .replace(/^\/+/, "")
    .replace(/\/+/, "/");
  const safe = cleaned
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return safe || "plans";
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;

const shellSingleQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

interface CachedRepoProfile {
  baseBranch: string;
  headSha: string;
  summary: string;
}

interface RuntimeManifest {
  taskId: string;
  provider: AgentProvider;
  taskType: Task["taskType"];
  action: TaskAction;
  title: string;
  prompt: string;
  executionSummary: string;
  repoProfile: string;
  content: string;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    absolutePath: string;
  }>;
  baseBranch: string;
  repoDefaultBranch: string;
  branchStrategy: Task["branchStrategy"];
  branchName: string;
  providerProfile: Task["providerProfile"];
  modelOverride: string | null;
  resolvedModel: string | null;
  resolvedReasoningEffort?: string;
  resolvedThinkingBudgetTokens?: number;
  agentResponsePreference: AgentResponsePreference;
  workspacePath: string;
  resultMarkdownPath: string;
  resultJsonPath: string;
  rawEventsJsonlPath: string;
  providerConfigPath: string;
}

interface RuntimeResultPayload {
  taskType: Task["taskType"];
  status: "success" | "failed";
  summaryMarkdown: string;
  changedFiles?: string[];
  metadata?: Record<string, unknown>;
}

interface WorkspacePreparation {
  workspacePath: string;
  hostWorkspacePath: string;
  startRef: string;
  workspaceBaseRef: string;
  kind: "clone";
  ephemeral: boolean;
  cleanupRepoPath: string | null;
}

type WorkspacePrepareFailureReason =
  | "auth"
  | "network"
  | "branch_missing"
  | "clone_error"
  | "unknown";

class WorkspacePrepareError extends Error {
  readonly reason: WorkspacePrepareFailureReason;

  constructor(message: string, reason: WorkspacePrepareFailureReason, readonly causeDetail?: string) {
    super(message);
    this.name = "WorkspacePrepareError";
    this.reason = reason;
  }
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp"
};

const WORKSPACE_FILE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const WORKSPACE_FILE_TREE_DEFAULT_LIMIT = 5_000;
const WORKSPACE_FILE_TREE_MAX_LIMIT = 20_000;
const WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT = 50;
const WORKSPACE_FILE_SEARCH_MAX_LIMIT = 500;
const SAFE_GIT_PREVIEW_REF_PATTERN = /^[A-Za-z0-9._/-]+(?:[~^][0-9]*)*$/;
const WORKSPACE_KIND = "clone";

function getPreviewMimeType(filePath: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.includes(0)) {
    return true;
  }

  let suspicious = 0;
  for (const byte of sample) {
    const isAllowedWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isSuspiciousControl = (byte >= 0 && byte < 8) || byte === 11 || byte === 12 || (byte >= 14 && byte < 32) || byte === 127;
    if (!isAllowedWhitespace && isSuspiciousControl) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length > 0.3;
}

export class SpawnerService {
  private static readonly MANAGED_REPO_HEAD_REF = "refs/heads/agentswarm-cache";

  private readonly runtimeReady = new Set<string>();
  private activeExecutions = new Map<string, Map<string, { label: string; process: ReturnType<typeof spawn>; containerName?: string }>>();
  private cancelRequestedTaskIds = new Set<string>();
  private repoLocks = new Map<string, Promise<void>>();
  private gitTargetLocks = new Map<string, Promise<void>>();
  private taskGitOperationLocks = new Map<string, Promise<void>>();
  private readonly repoSyncManager = new RepoSyncManager();
  private executionContextStorage = new AsyncLocalStorage<{ taskId: string; executionId: string }>();
  private gitWorkerContextStorage = new AsyncLocalStorage<{ enabled: boolean }>();

  constructor(
    private readonly taskStore: TaskStore,
    private readonly settingsStore: SettingsStore,
    private readonly userStore: UserStore,
    private readonly repositoryStore: Pick<RepositoryStore, "getRepositoryRuntimeEnvEntries">,
    private readonly repositoryEnvFileStore: RepositoryEnvFileStore = new RepositoryEnvFileStore(),
    private readonly personalAccessTokenStore?: PersonalAccessTokenStore
  ) {}

  private formatExecutionLabel(command: string, args: string[]): string {
    return truncate([command, ...args].join(" "), 160);
  }

  private normalizeCommandError(command: string, stderr: string, code: number | null): string {
    const raw = (stderr || "").trim();
    if (command === "git" && raw.includes("warning: Not a git repository. Use --no-index")) {
      return "Task workspace is not a valid git repository. Rebuild/prep the workspace, then retry.";
    }

    return raw || `${command} exited with code ${code ?? "unknown"}`;
  }

  private registerCurrentExecutionProcess(command: string, args: string[], process: ReturnType<typeof spawn>): void {
    const context = this.executionContextStorage.getStore();
    if (!context) {
      return;
    }

    this.registerActiveExecution(context.taskId, context.executionId, {
      label: this.formatExecutionLabel(command, args),
      process
    });
  }

  private unregisterCurrentExecutionProcess(process: ReturnType<typeof spawn>): void {
    const context = this.executionContextStorage.getStore();
    if (!context) {
      return;
    }

    this.unregisterActiveExecution(context.taskId, context.executionId, process);
  }

  private ensureTaskNotCancelled(taskId: string): void {
    if (this.isCancellationRequested(taskId)) {
      throw new CancelledTaskError();
    }
  }

  private runCommand(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
      this.registerCurrentExecutionProcess(command, args, proc);

      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        this.unregisterCurrentExecutionProcess(proc);
        reject(error);
      });
      proc.on("close", (code) => {
        this.unregisterCurrentExecutionProcess(proc);
        const context = this.executionContextStorage.getStore();
        if (context && this.isCancellationRequested(context.taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(this.normalizeCommandError(command, stderr, code)));
      });
    });
  }

  private runCommandCapture(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
      this.registerCurrentExecutionProcess(command, args, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        this.unregisterCurrentExecutionProcess(proc);
        reject(error);
      });
      proc.on("close", (code) => {
        this.unregisterCurrentExecutionProcess(proc);
        const context = this.executionContextStorage.getStore();
        if (context && this.isCancellationRequested(context.taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        reject(new Error(this.normalizeCommandError(command, stderr, code)));
      });
    });
  }

  private runCommandCaptureRaw(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
      this.registerCurrentExecutionProcess(command, args, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        this.unregisterCurrentExecutionProcess(proc);
        reject(error);
      });
      proc.on("close", (code) => {
        this.unregisterCurrentExecutionProcess(proc);
        const context = this.executionContextStorage.getStore();
        if (context && this.isCancellationRequested(context.taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(new Error(this.normalizeCommandError(command, stderr, code)));
      });
    });
  }

  private runCommandCaptureBuffer(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
      this.registerCurrentExecutionProcess(command, args, proc);

      const stdout: Buffer[] = [];
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        this.unregisterCurrentExecutionProcess(proc);
        reject(error);
      });
      proc.on("close", (code) => {
        this.unregisterCurrentExecutionProcess(proc);
        const context = this.executionContextStorage.getStore();
        if (context && this.isCancellationRequested(context.taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0) {
          resolve(Buffer.concat(stdout));
          return;
        }

        reject(new Error(this.normalizeCommandError(command, stderr, code)));
      });
    });
  }

  private runCommandCaptureAllowExitCodes(
    command: string,
    args: string[],
    allowedExitCodes: number[],
    extraEnv: NodeJS.ProcessEnv = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
      this.registerCurrentExecutionProcess(command, args, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        this.unregisterCurrentExecutionProcess(proc);
        reject(error);
      });
      proc.on("close", (code) => {
        this.unregisterCurrentExecutionProcess(proc);
        const context = this.executionContextStorage.getStore();
        if (context && this.isCancellationRequested(context.taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0 || (code !== null && allowedExitCodes.includes(code))) {
          resolve(stdout);
          return;
        }

        reject(new Error(this.normalizeCommandError(command, stderr, code)));
      });
    });
  }

  private shouldUseGitWorkerContainer(): boolean {
    return this.gitWorkerContextStorage.getStore()?.enabled === true;
  }

  private buildGitWorkerDockerArgs(args: string[], gitEnv: NodeJS.ProcessEnv): string[] {
    const image = AGENT_RUNTIME_IMAGE;

    const dockerEnv: string[] = [
      "-e",
      "GIT_OPTIONAL_LOCKS=0",
      "-e",
      "HOME=/tmp",
      "-e",
      "GIT_CONFIG_COUNT=1",
      "-e",
      "GIT_CONFIG_KEY_0=safe.directory",
      "-e",
      "GIT_CONFIG_VALUE_0=*"
    ];
    for (const [key, value] of Object.entries(gitEnv)) {
      if (typeof value === "string") {
        dockerEnv.push("-e", `${key}=${value}`);
      }
    }

    const commandScript =
      [
        "set -eu",
        "if [ -n \"${GIT_TOKEN:-}\" ]; then",
        "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '  *sername*) echo \"${GIT_USERNAME:-x-access-token}\" ;;' '  *assword*) echo \"${GIT_TOKEN:-}\" ;;' '  *) echo \"\" ;;' 'esac' > /tmp/agentswarm-git-askpass.sh",
        "  chmod 700 /tmp/agentswarm-git-askpass.sh",
        "  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/agentswarm-git-askpass.sh",
        "fi",
        "exec git \"$@\""
      ].join("\n");

    const repoCacheMountSource = existsSync("/.dockerenv") ? env.REPO_CACHE_VOLUME : env.REPO_CACHE_ROOT;

    return [
      "run",
      "--rm",
      "-i",
      "-v",
      `${env.TASK_WORKSPACE_DOCKER_SOURCE}:${env.TASK_WORKSPACE_ROOT}:rw`,
      "-v",
      `${repoCacheMountSource}:${env.REPO_CACHE_ROOT}:rw`,
      ...dockerEnv,
      image,
      "sh",
      "-lc",
      commandScript,
      "sh",
      ...args
    ];
  }

  private async runGitCommandInWorker(args: string[], gitEnv: NodeJS.ProcessEnv): Promise<void> {
    await this.runCommand("docker", this.buildGitWorkerDockerArgs(args, gitEnv));
  }

  private async runGitCommandCaptureInWorker(args: string[], gitEnv: NodeJS.ProcessEnv): Promise<string> {
    return this.runCommandCapture("docker", this.buildGitWorkerDockerArgs(args, gitEnv));
  }

  private async runGitCommandCaptureRawInWorker(args: string[], gitEnv: NodeJS.ProcessEnv): Promise<string> {
    return this.runCommandCaptureRaw("docker", this.buildGitWorkerDockerArgs(args, gitEnv));
  }

  private runGitCommandCaptureBufferInWorker(args: string[], gitEnv: NodeJS.ProcessEnv): Promise<Buffer> {
    return this.runCommandCaptureBuffer("docker", this.buildGitWorkerDockerArgs(args, gitEnv));
  }

  private async runGitCommandCaptureAllowExitCodesInWorker(
    args: string[],
    allowedExitCodes: number[],
    gitEnv: NodeJS.ProcessEnv
  ): Promise<string> {
    return this.runCommandCaptureAllowExitCodes("docker", this.buildGitWorkerDockerArgs(args, gitEnv), allowedExitCodes);
  }

  private async buildGitEnv(
    args: string[],
    githubToken?: string | null,
    gitUsername = "x-access-token",
    task?: Pick<Task, "ownerUserId">
  ): Promise<NodeJS.ProcessEnv> {
    const workspacePath = args[0] === "-C" && typeof args[1] === "string" && args[1].startsWith("/") ? args[1] : null;
    const settings = task ? await this.settingsStore.getSettings() : null;
    const gitIdentity = task
      ? resolveTaskGitCommitIdentity(settings!, {
          ...DEFAULT_GIT_COMMIT_IDENTITY
        })
      : null;
    return buildGitProcessEnv({
      workspacePath,
      githubToken,
      gitUsername,
      gitIdentity
    });
  }

  private async cleanupWorkspaceGitLocks(workspacePath: string): Promise<void> {
    const gitPaths = await resolveGitPaths(path.join(workspacePath, ".git")).catch(() => null);
    if (!gitPaths) {
      return;
    }

    await Promise.all(
      ["index.lock", "HEAD.lock", "config.lock", "packed-refs.lock", "shallow.lock"].map((lockFile) =>
        rm(path.join(gitPaths.gitDir, lockFile), { force: true }).catch(() => undefined)
      )
    );
  }

  private async cleanupRecoveredGitLockPath(lockPath: string): Promise<boolean> {
    if (!path.isAbsolute(lockPath)) {
      return false;
    }

    if (!isPathInside(env.TASK_WORKSPACE_ROOT, lockPath) && !isPathInside(env.REPO_CACHE_ROOT, lockPath)) {
      return false;
    }

    await rm(lockPath, { force: true }).catch(() => undefined);
    return true;
  }

  private async withNamedLock<T>(locks: Map<string, Promise<void>>, key: string, fn: () => Promise<T>): Promise<T> {
    const current = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const nextGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextLock = current.then(() => nextGate);

    locks.set(key, nextLock);
    await current;

    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === nextLock) {
        locks.delete(key);
      }
    }
  }

  private async runGitWithRecovery<T>(args: string[], execute: () => Promise<T>): Promise<T> {
    const lockKey = resolveGitTargetLockKey(args);
    const run = async (): Promise<T> => {
      try {
        return await execute();
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }

        const lockPath = extractGitLockPathFromErrorMessage(error.message);
        if (!lockPath) {
          throw error;
        }

        const removed = await this.cleanupRecoveredGitLockPath(lockPath);
        if (!removed) {
          throw error;
        }

        return execute();
      }
    };

    if (!lockKey) {
      return run();
    }

    return this.withNamedLock(this.gitTargetLocks, lockKey, run);
  }

  private async gitCommand(
    args: string[],
    githubToken?: string | null,
    gitUsername = "x-access-token",
    task?: Pick<Task, "ownerUserId">
  ): Promise<void> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername, task);
    await this.runGitWithRecovery(args, () =>
      this.shouldUseGitWorkerContainer()
        ? this.runGitCommandInWorker(args, gitEnv)
        : this.runCommand("git", args, gitEnv)
    );
  }

  private async gitCommandCapture(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () =>
      this.shouldUseGitWorkerContainer()
        ? this.runGitCommandCaptureInWorker(args, gitEnv)
        : this.runCommandCapture("git", args, gitEnv)
    );
  }

  private async gitCommandCaptureRaw(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () =>
      this.shouldUseGitWorkerContainer()
        ? this.runGitCommandCaptureRawInWorker(args, gitEnv)
        : this.runCommandCaptureRaw("git", args, gitEnv)
    );
  }

  private async gitCommandCaptureBuffer(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<Buffer> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () =>
      this.shouldUseGitWorkerContainer()
        ? this.runGitCommandCaptureBufferInWorker(args, gitEnv)
        : this.runCommandCaptureBuffer("git", args, gitEnv)
    );
  }

  private async gitCommandCaptureAllowExitCodes(
    args: string[],
    allowedExitCodes: number[],
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () =>
      this.shouldUseGitWorkerContainer()
        ? this.runGitCommandCaptureAllowExitCodesInWorker(args, allowedExitCodes, gitEnv)
        : this.runCommandCaptureAllowExitCodes(
            "git",
            args,
            allowedExitCodes,
            gitEnv
          )
    );
  }

  /**
   * Clone strategy for task/ask workspaces:
   * - Fetch depth: full history by default (`null`) to avoid shallow-history edge cases.
   * - Base ref selection: branch ref first, then task base branch.
   * - Missing branch fallback: if feature branch is missing remotely, create it from base branch.
   */
  private static readonly WORKSPACE_FETCH_DEPTH: number | null = null;

  private emitWorkspacePrepareEvent(
    event: "workspace_prepare_started" | "workspace_prepare_succeeded" | "workspace_prepare_failed",
    payload: {
      taskId: string;
      taskType: Task["taskType"];
      workspaceKind: typeof WORKSPACE_KIND;
      failureReason?: WorkspacePrepareFailureReason;
      mode?: "clone_only" | "hybrid";
    }
  ): void {
    const base = {
      level: "info",
      event,
      workspace_kind: payload.workspaceKind,
      task_type: payload.taskType,
      task_id: payload.taskId,
      workspace_provisioning_mode: payload.mode ?? "clone_only"
    } as const;

    if (event === "workspace_prepare_failed") {
      console.info(JSON.stringify({ ...base, failure_reason: payload.failureReason ?? "unknown" }));
      return;
    }

    console.info(JSON.stringify(base));
  }

  private classifyWorkspacePrepareFailure(error: unknown): WorkspacePrepareFailureReason {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (
      message.includes("authentication failed") ||
      message.includes("could not read username") ||
      message.includes("permission denied") ||
      message.includes("repository not found") ||
      message.includes("access denied")
    ) {
      return "auth";
    }
    if (
      message.includes("could not resolve host") ||
      message.includes("failed to connect") ||
      message.includes("connection timed out") ||
      message.includes("network is unreachable") ||
      message.includes("http request failed")
    ) {
      return "network";
    }
    if (
      message.includes("not a commit") ||
      message.includes("did not match any file") ||
      (message.includes("remote branch") && message.includes("not found"))
    ) {
      return "branch_missing";
    }
    if (message.includes("clone")) {
      return "clone_error";
    }
    return "unknown";
  }

  private classifyTaskGitOperationFailure(operationType: TaskGitOperationType, error: unknown): TaskGitOperationFailureCode {
    if (error instanceof CancelledTaskError) {
      return "unknown";
    }

    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (
      message.includes("authentication failed") ||
      message.includes("could not read username") ||
      message.includes("permission denied") ||
      message.includes("repository not found") ||
      message.includes("access denied")
    ) {
      return "auth_failed";
    }
    if (
      message.includes("could not resolve host") ||
      message.includes("failed to connect") ||
      message.includes("connection timed out") ||
      message.includes("network is unreachable") ||
      message.includes("http request failed")
    ) {
      return "network_error";
    }
    if (message.includes("no local workspace exists")) {
      return "workspace_missing";
    }
    if (
      message.includes("remote branch") && message.includes("does not exist") ||
      message.includes("not a commit") ||
      message.includes("did not match any file")
    ) {
      return "branch_missing";
    }
    if (
      message.includes("non-fast-forward") ||
      message.includes("merge conflict") ||
      message.includes("could not apply") ||
      message.includes("rebase")
    ) {
      return "conflict";
    }
    if (operationType === "push_task_branch" && (message.includes("nothing to commit") || message.includes("nothing to push"))) {
      return "nothing_to_push";
    }
    return "unknown";
  }

  private emitTaskGitOperationAnalytics(
    event: "git_op_started" | "git_op_succeeded" | "git_op_failed" | "git_op_retried",
    payload: {
      operation: TaskGitOperation;
      durationMs?: number;
    }
  ): void {
    const base = {
      level: "info",
      event,
      task_id: payload.operation.taskId,
      operation_type: payload.operation.operationType,
      status: payload.operation.status,
      failure_code: payload.operation.errorCode,
      retry_count: Math.max(0, payload.operation.attemptCount - 1)
    } as Record<string, unknown>;
    if (typeof payload.durationMs === "number") {
      base.duration_ms = payload.durationMs;
    }
    console.info(JSON.stringify(base));
  }

  private async measureTaskGitRead<T>(
    events: {
      success: "git_state_snapshot_loaded" | "live_diff_loaded" | "build_finalize_diff_collected";
      failure: "git_state_snapshot_failed" | "live_diff_failed" | "build_finalize_diff_failed";
    },
    taskId: string,
    fn: () => Promise<T>,
    buildMeta?: (result: T) => Record<string, unknown>
  ): Promise<T> {
    const startedAtMs = Date.now();
    try {
      const result = await fn();
      const base: Record<string, unknown> = {
        level: "info",
        event: events.success,
        task_id: taskId,
        duration_ms: Math.max(0, Date.now() - startedAtMs)
      };
      if (buildMeta) {
        Object.assign(base, buildMeta(result));
      }
      console.info(JSON.stringify(base));
      return result;
    } catch (error) {
      console.info(
        JSON.stringify({
          level: "info",
          event: events.failure,
          task_id: taskId,
          duration_ms: Math.max(0, Date.now() - startedAtMs),
          failure_reason: error instanceof Error ? error.message : String(error)
        })
      );
      throw error;
    }
  }

  private async withGitWorkerContainer<T>(fn: () => Promise<T>): Promise<T> {
    return this.gitWorkerContextStorage.run({ enabled: true }, fn);
  }

  private async withTrackedTaskGitOperation<T>(
    task: Task,
    operationType: TaskGitOperationType,
    fn: (operation: TaskGitOperation) => Promise<T>
  ): Promise<T> {
    if (this.taskGitOperationLocks.has(task.id)) {
      throw new Error("Another Git operation is already running for this task workspace. Wait for it to finish, then retry.");
    }

    const latest = await this.taskStore.getLatestGitOperation(task.id);
    const attemptCount = latest && latest.operationType === operationType ? latest.attemptCount + 1 : 1;
    const queued = await this.taskStore.createGitOperation({
      taskId: task.id,
      operationType,
      status: "queued",
      attemptCount
    });
    if (!queued) {
      throw new Error("Task not found.");
    }

    if (attemptCount > 1) {
      this.emitTaskGitOperationAnalytics("git_op_retried", { operation: queued });
    }

    return this.withNamedLock(this.taskGitOperationLocks, task.id, async () => {
      const running =
        (await this.taskStore.updateGitOperation(queued.operationId, {
          status: "running",
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
          attemptCount
        })) ?? queued;
      this.emitTaskGitOperationAnalytics("git_op_started", { operation: running });

      const startedAtMs = Date.parse(running.startedAt);
      try {
        const result = await this.withGitWorkerContainer(() => fn(running));
        const finished =
          (await this.taskStore.updateGitOperation(running.operationId, {
            status: "succeeded",
            finishedAt: new Date().toISOString(),
            errorCode: null,
            errorMessage: null,
            attemptCount
          })) ?? running;
        const finishedAtMs = finished.finishedAt ? Date.parse(finished.finishedAt) : NaN;
        this.emitTaskGitOperationAnalytics("git_op_succeeded", {
          operation: finished,
          durationMs: Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs) ? Math.max(0, finishedAtMs - startedAtMs) : undefined
        });
        return result;
      } catch (error) {
        const failureCode = this.classifyTaskGitOperationFailure(operationType, error);
        const message = error instanceof Error ? error.message : String(error);
        const failedStatus: TaskGitOperation["status"] = error instanceof CancelledTaskError ? "cancelled" : "failed";
        const failed =
          (await this.taskStore.updateGitOperation(running.operationId, {
            status: failedStatus,
            finishedAt: new Date().toISOString(),
            errorCode: failedStatus === "failed" ? failureCode : null,
            errorMessage: failedStatus === "failed" ? message : null,
            attemptCount
          })) ?? running;
        const finishedAtMs = failed.finishedAt ? Date.parse(failed.finishedAt) : NaN;
        this.emitTaskGitOperationAnalytics("git_op_failed", {
          operation: failed,
          durationMs: Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs) ? Math.max(0, finishedAtMs - startedAtMs) : undefined
        });
        throw error;
      }
    });
  }

  private workspaceFetchArgs(refSpec: string): string[] {
    const args = ["fetch", "--prune"];
    if (SpawnerService.WORKSPACE_FETCH_DEPTH && SpawnerService.WORKSPACE_FETCH_DEPTH > 0) {
      args.push(`--depth=${SpawnerService.WORKSPACE_FETCH_DEPTH}`);
    }
    args.push("origin", refSpec);
    return args;
  }

  private async cloneWorkspaceRepository(sourceRepoPath: string, workspacePath: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<void> {
    await this.gitCommand(["clone", "--no-checkout", "--no-local", sourceRepoPath, workspacePath], githubToken, gitUsername);
  }

  private async cloneWorkspaceFromSource(
    sourceRepoPath: string,
    sourceRepoUrl: string,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    await rm(workspacePath, { recursive: true, force: true });
    await mkdir(path.dirname(workspacePath), { recursive: true });
    await this.cloneWorkspaceRepository(sourceRepoPath, workspacePath, githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", sourceRepoUrl], githubToken, gitUsername);
  }

  private async checkoutTaskWorkspaceBranch(
    task: Task,
    workspacePath: string,
    branchName: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    const baseRemoteRef = `origin/${task.baseBranch}`;
    const branchRemoteRef = `origin/${branchName}`;
    await this.gitCommand(["-C", workspacePath, ...this.workspaceFetchArgs("+refs/heads/*:refs/remotes/origin/*")], githubToken, gitUsername);

    if (task.branchStrategy === "work_on_branch") {
      if (!(await this.refExists(workspacePath, baseRemoteRef, githubToken, gitUsername))) {
        throw new WorkspacePrepareError(
          `Workspace setup failed: base branch '${task.baseBranch}' is missing on origin.`,
          "branch_missing"
        );
      }
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", task.baseBranch, baseRemoteRef], githubToken, gitUsername);
      return;
    }

    if (await this.refExists(workspacePath, branchRemoteRef, githubToken, gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, branchRemoteRef], githubToken, gitUsername);
      return;
    }

    if (!(await this.refExists(workspacePath, baseRemoteRef, githubToken, gitUsername))) {
      throw new WorkspacePrepareError(
        `Workspace setup failed: neither '${branchName}' nor base branch '${task.baseBranch}' exists on origin.`,
        "branch_missing"
      );
    }

    await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, baseRemoteRef], githubToken, gitUsername);
  }

  private async withRepoLock<T>(repoKey: string, fn: () => Promise<T>): Promise<T> {
    return this.withNamedLock(this.repoLocks, repoKey, fn);
  }

  private buildGitCommitArgs(message: string): string[] {
    return ["commit", "--no-verify", "-m", message];
  }

  private async commitWorkspaceChanges(
    task: Pick<Task, "ownerUserId">,
    workspacePath: string,
    message: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    const commitArgs = this.buildGitCommitArgs(message);
    await this.gitCommand(["-C", workspacePath, ...commitArgs], githubToken, gitUsername, task);
  }

  private async getWorkspaceGitPaths(workspacePath: string): Promise<Awaited<ReturnType<typeof resolveGitPaths>>> {
    return resolveGitPaths(path.join(workspacePath, ".git"));
  }

  private async resolveWorkspaceHeadRef(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    try {
      return await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);
    } catch {
      return null;
    }
  }

  private async syncWorkspaceRemoteRefsIfNeeded(
    task: Pick<Task, "repoUrl">,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    const gitPaths = await this.getWorkspaceGitPaths(workspacePath).catch(() => null);
    if (!gitPaths) {
      return;
    }

    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername).catch(async () => {
      await this.gitCommand(["-C", workspacePath, "remote", "add", "origin", task.repoUrl], githubToken, gitUsername);
    });
    await this.gitCommand(["-C", workspacePath, "fetch", "--prune", "origin"], githubToken, gitUsername);
  }

  private async ensureWorkspaceGitHooks(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    void workspacePath;
    void githubToken;
    void gitUsername;
  }

  private async findBranchWorktreePath(
    repoPath: string,
    branchName: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    const raw = await this.gitCommandCaptureAllowExitCodes(["-C", repoPath, "worktree", "list", "--porcelain"], [0], githubToken, gitUsername);

    let currentPath: string | null = null;
    let currentBranch: string | null = null;
    const flush = (): string | null => {
      if (currentPath && currentBranch === `refs/heads/${branchName}`) {
        return currentPath;
      }
      return null;
    };

    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        const matched = flush();
        if (matched) {
          return matched;
        }
        currentPath = null;
        currentBranch = null;
        continue;
      }

      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length).trim();
        continue;
      }
      if (line.startsWith("branch ")) {
        currentBranch = line.slice("branch ".length).trim();
      }
    }

    return flush();
  }

  private async addManagedWorktree(
    repoPath: string,
    workspacePath: string,
    branchName: string,
    startPoint: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    await this.gitCommand(["-C", repoPath, "worktree", "add", "-B", branchName, workspacePath, startPoint], githubToken, gitUsername);
  }

  private async cloneWorkspaceFallback(
    task: Task,
    workspacePath: string,
    branchName: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    await this.gitCommand(["clone", "--no-checkout", task.repoUrl, workspacePath], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "fetch", "--prune", "origin", task.baseBranch], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, `origin/${task.baseBranch}`], githubToken, gitUsername);
  }

  private async removeWorkspaceFromManagedRepo(
    repoPath: string,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    const gitPaths = await this.getWorkspaceGitPaths(workspacePath).catch(() => null);
    if (!gitPaths?.usesLinkedWorktree) {
      return;
    }

    await this.gitCommand(["-C", repoPath, "worktree", "remove", "--force", workspacePath], githubToken, gitUsername).catch(() => undefined);
    await this.gitCommand(["-C", repoPath, "worktree", "prune"], githubToken, gitUsername).catch(() => undefined);
  }

  private async withFreshManagedRepo<T>(
    task: Task,
    githubToken: string | null | undefined,
    gitUsername: string,
    operation: RepoSyncOperation,
    fn: (repoPath: string) => Promise<T>
  ): Promise<T> {
    const repoCachePath = this.resolveRepoCachePath(task);
    return this.withRepoLock(repoCachePath, async () => {
      let managedRepoPath = await this.ensureManagedRepoFresh(task, operation, githubToken, gitUsername);
      try {
        return await fn(managedRepoPath);
      } catch (error) {
        if (!this.shouldRebuildMirror(error)) {
          throw error;
        }

        await rm(managedRepoPath, { recursive: true, force: true });
        this.repoSyncManager.clear(repoCachePath);
        managedRepoPath = await this.ensureManagedRepoFresh(task, operation, githubToken, gitUsername);
        return fn(managedRepoPath);
      }
    });
  }

  private async refreshWorkspaceRemoteState(
    task: Task,
    workspacePath: string,
    githubToken: string | null | undefined,
    gitUsername: string,
    operation: RepoSyncOperation = "status"
  ): Promise<void> {
    await this.withFreshManagedRepo(task, githubToken, gitUsername, operation, async () => {
      await this.syncWorkspaceRemoteRefsIfNeeded(task, workspacePath, githubToken, gitUsername);
    });
  }

  private shouldRebuildMirror(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("initial ref transaction called with existing refs") ||
      message.includes("refs/files-backend.c") ||
      message.includes("detected dubious ownership in repository")
    );
  }

  private async ensureRuntimeImage(provider: AgentProvider): Promise<void> {
    const definition = getProviderRuntimeDefinition(provider);
    if (this.runtimeReady.has(definition.image)) {
      return;
    }

    await this.runCommand("docker", ["build", "-t", definition.image, definition.context]);
    this.runtimeReady.add(definition.image);
  }

  private async stripEphemeralWorkspaceFiles(workspacePath: string): Promise<void> {
    await rm(path.join(workspacePath, ".agentswarm-runtime"), { recursive: true, force: true }).catch(() => undefined);
    await rm(path.join(workspacePath, LINKED_WORKSPACE_DIRNAME), { recursive: true, force: true }).catch(() => undefined);
  }

  private async loadPostflightConfig(workspacePath: string): Promise<PostflightConfig | null> {
    for (const fileName of ["postflight.yml", "postflight.yaml"]) {
      const configPath = path.join(workspacePath, ".agentswarm", fileName);
      let raw: string | null = null;

      try {
        raw = await readFile(configPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      try {
        return parsePostflightConfig(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid .agentswarm/${fileName}: ${detail}`);
      }
    }

    return null;
  }

  private buildPostflightScript(config: PostflightConfig): string {
    const lines = ["#!/bin/sh", "set -eu"];

    for (const [index, step] of config.steps.entries()) {
      const command = step.run.replace(/\r/g, "").trim();
      if (!command) {
        throw new Error(`Postflight step ${index + 1} is empty.`);
      }
      if (command.includes("\n")) {
        throw new Error(`Postflight step ${index + 1} must be a single shell command.`);
      }

      lines.push(`echo ${shellSingleQuote(`[postflight] step ${index + 1}/${config.steps.length}: ${command}`)}`);
      lines.push(command);
    }

    return `${lines.join("\n")}\n`;
  }

  private async runPostflightContainer(
    taskId: string,
    executionId: string,
    runId: string | null,
    containerName: string,
    args: string[],
    timeoutSeconds: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      this.registerActiveExecution(taskId, executionId, { label: containerName, containerName, process: proc });

      let stdoutRemainder = "";
      let stderrRemainder = "";
      let timedOut = false;
      let settled = false;

      const appendLogLine = (prefix: "stdout" | "stderr", line: string): void => {
        if (line.trim().length > 0) {
          void this.taskStore.appendLogForRun(taskId, `[postflight ${prefix}] ${line}`, runId);
        }
      };

      const flushChunk = (prefix: "stdout" | "stderr", chunk: string): void => {
        const sanitized = sanitizeChunk(chunk);
        if (prefix === "stdout") {
          stdoutRemainder += sanitized;
          const lines = stdoutRemainder.split("\n");
          stdoutRemainder = lines.pop() ?? "";
          for (const line of lines) {
            appendLogLine("stdout", line.trimEnd());
          }
          return;
        }

        stderrRemainder += sanitized;
        const lines = stderrRemainder.split("\n");
        stderrRemainder = lines.pop() ?? "";
        for (const line of lines) {
          appendLogLine("stderr", line.trimEnd());
        }
      };

      const cleanup = (): void => {
        this.unregisterActiveExecution(taskId, executionId, proc);
      };

      const timeoutId = setTimeout(() => {
        timedOut = true;
        void this.taskStore.appendLogForRun(
          taskId,
          `Spawner: postflight timed out after ${timeoutSeconds} seconds; stopping container ${containerName}.`,
          runId
        );
        void (async () => {
          try {
            await this.runCommand("docker", ["stop", "-t", "5", containerName]);
          } catch {
            // Container may already be gone.
          }

          try {
            await this.runCommand("docker", ["rm", "-f", containerName]);
          } catch {
            try {
              proc.kill("SIGTERM");
            } catch {
              // Ignore process kill errors.
            }
          }
        })();
      }, timeoutSeconds * 1000);

      proc.stdout.on("data", (data) => {
        flushChunk("stdout", data.toString());
      });
      proc.stderr.on("data", (data) => {
        flushChunk("stderr", data.toString());
      });

      proc.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        cleanup();
        reject(error);
      });
      proc.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        cleanup();

        if (stdoutRemainder.trim().length > 0) {
          appendLogLine("stdout", stdoutRemainder.trimEnd());
        }
        if (stderrRemainder.trim().length > 0) {
          appendLogLine("stderr", stderrRemainder.trimEnd());
        }

        if (timedOut) {
          reject(new Error(`Postflight timed out after ${timeoutSeconds} seconds.`));
          return;
        }
        if (this.isCancellationRequested(taskId)) {
          reject(new CancelledTaskError());
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`Postflight container exited with code ${code ?? "unknown"}`));
      });
    });
  }

  private async runConfiguredPostflight(
    task: Task,
    workspace: WorkspacePreparation,
    executionId: string,
    runId: string | null,
    payloadDir: string,
    appendRunLog: (line: string) => Promise<unknown>
  ): Promise<void> {
    const config = await this.loadPostflightConfig(workspace.workspacePath);
    if (!config || !postflightAppliesToTask(config, task)) {
      return;
    }

    const postflightScript = this.buildPostflightScript(config);
    const scriptPath = path.join(payloadDir, "postflight.sh");
    await writeFile(scriptPath, postflightScript, "utf8");
    await chmod(scriptPath, 0o755);

    const gitRuntimeMounts = await resolveWorkspaceGitRuntimeMounts(workspace.workspacePath);
    const containerName = `agentswarm-postflight-${sanitizePathSegment(task.id).replace(/\//g, "-")}-${executionId.slice(0, 8).toLowerCase()}`;
    await appendRunLog(
      `Spawner: running postflight (${config.steps.length} step${config.steps.length === 1 ? "" : "s"}) in ${config.runner.image}.`
    );

    try {
      await this.runPostflightContainer(
        task.id,
        executionId,
        runId,
        containerName,
        [
          "run",
          "--rm",
          "--name",
          containerName,
          "-v",
          `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
          ...this.buildTaskWorkspaceMountArgs(task.id, "/workspace", "rw"),
          ...gitRuntimeMounts,
          "-w",
          "/workspace",
          config.runner.image,
          "/bin/sh",
          scriptPath
        ],
        config.runner.timeout_seconds
      );
      await appendRunLog("Spawner: postflight finished successfully.");
    } catch (error) {
      if (error instanceof CancelledTaskError) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (config.on_failure === "ignore") {
        await appendRunLog(`Spawner: postflight failed but on_failure=ignore; continuing. ${detail}`);
        return;
      }
      throw new Error(`Postflight failed: ${detail}`);
    }
  }

  async validateTaskPostflight(task: Task): Promise<void> {
    if (task.taskType !== "build") {
      throw new Error("Postflight is only available for build tasks.");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      throw new Error("No workspace folder on disk for this task yet. Prepare the workspace or run a build first.");
    }

    const config = await this.loadPostflightConfig(workspacePath);
    if (!config) {
      throw new Error("No .agentswarm/postflight.yml found in this task workspace.");
    }

    if (!postflightAppliesToTask(config, task)) {
      throw new Error("Configured postflight is disabled for this task type or provider.");
    }
  }

  private resolveRuntimePayloadDir(taskId: string, executionId?: string): string {
    return executionId ? path.join(env.RUNTIME_PAYLOAD_ROOT, taskId, executionId) : path.join(env.RUNTIME_PAYLOAD_ROOT, taskId);
  }

  private resolveWorkspacePath(taskId: string): string {
    return path.join(env.TASK_WORKSPACE_ROOT, taskId);
  }

  private resolveWorkspaceHostPath(taskId: string): string {
    return path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, taskId);
  }

  private buildTaskWorkspaceMountArgs(sourceRelativePath: string, targetPath: string, mode: "ro" | "rw"): string[] {
    return buildDockerWorkspaceMountArgs({
      sourceRoot: env.TASK_WORKSPACE_DOCKER_SOURCE,
      sourceRelativePath,
      targetPath,
      mode
    });
  }

  resolveTaskRunRawEventsJsonlPath(taskId: string, runId: string): string {
    return path.join(resolveTaskStateRootPaths(taskId).serverPath, "raw-runs", `${sanitizePathSegment(runId)}.jsonl`);
  }

  resolveTaskRunRawEventsJsonlHostPath(taskId: string, runId: string): string {
    return path.join(resolveTaskStateRootPaths(taskId).hostPath, "raw-runs", `${sanitizePathSegment(runId)}.jsonl`);
  }

  resolveTaskRunRawEventsMount(taskId: string, runId: string): { hostDir: string; containerDir: string } {
    return {
      hostDir: path.dirname(this.resolveTaskRunRawEventsJsonlHostPath(taskId, runId)),
      containerDir: path.dirname(this.resolveTaskRunRawEventsJsonlPath(taskId, runId))
    };
  }

  private async prepareTaskRunRawEventsJsonl(taskId: string, runId: string): Promise<string> {
    const rawEventsJsonlPath = this.resolveTaskRunRawEventsJsonlPath(taskId, runId);
    await mkdir(path.dirname(rawEventsJsonlPath), { recursive: true });
    await writeFile(rawEventsJsonlPath, "", "utf8");
    await chmod(path.dirname(rawEventsJsonlPath), 0o777).catch(() => undefined);
    await chmod(rawEventsJsonlPath, 0o666).catch(() => undefined);
    return rawEventsJsonlPath;
  }

  private async readRunTimelineEvents(
    task: Task,
    rawEventsJsonlPath: string,
    options: { includeTrailingPartialLine: boolean }
  ): Promise<NormalizedAgentEvent[]> {
    const rawJsonl = await readFile(rawEventsJsonlPath, "utf8");
    const parseableJsonl = options.includeTrailingPartialLine ? rawJsonl : stripIncompleteTrailingJsonlLine(rawJsonl);
    if (!parseableJsonl.trim()) {
      return [];
    }
    return parseAgentJsonlEvents(task.provider, parseableJsonl);
  }

  private async parseAndStoreRunTimeline(task: Task, runId: string | null, rawEventsJsonlPath: string | null): Promise<void> {
    if (!runId || !rawEventsJsonlPath) {
      return;
    }

    try {
      const timelineEvents = await this.readRunTimelineEvents(task, rawEventsJsonlPath, {
        includeTrailingPartialLine: true
      });
      if (timelineEvents.length === 0) {
        return;
      }
      await this.taskStore.updateRun(runId, { timelineEvents });
    } catch (error) {
      await this.taskStore.appendLogForRun(
        task.id,
        `Spawner: warning - could not parse raw ${task.provider} JSON timeline (${error instanceof Error ? error.message : String(error)}).`,
        runId
      );
    }
  }

  private startLiveRunTimelineStream(
    task: Task,
    runId: string | null,
    rawEventsJsonlPath: string | null
  ): { stop: () => Promise<void> } {
    if (!runId || !rawEventsJsonlPath) {
      return { stop: async () => undefined };
    }

    let stopped = false;
    let parseInFlight = false;
    let lastSignature = "0:::";
    let lastErrorMessage: string | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const parseAndPublish = async (): Promise<void> => {
      if (stopped || parseInFlight) {
        return;
      }

      parseInFlight = true;
      try {
        const timelineEvents = await this.readRunTimelineEvents(task, rawEventsJsonlPath, {
          includeTrailingPartialLine: false
        });
        const nextSignature = timelineSignature(timelineEvents);
        if (timelineEvents.length > 0 && nextSignature !== lastSignature) {
          lastSignature = nextSignature;
          await this.taskStore.updateRun(runId, { timelineEvents });
        }
        lastErrorMessage = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastErrorMessage) {
          lastErrorMessage = message;
          await this.taskStore.appendLogForRun(
            task.id,
            `Spawner: warning - live ${task.provider} JSON timeline stream paused (${message}).`,
            runId
          );
        }
      } finally {
        parseInFlight = false;
      }
    };

    interval = setInterval(() => {
      void parseAndPublish();
    }, LIVE_TIMELINE_POLL_INTERVAL_MS);
    void parseAndPublish();

    return {
      stop: async () => {
        stopped = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        while (parseInFlight) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    };
  }

  private registerActiveExecution(
    taskId: string,
    executionId: string,
    execution: { label: string; process: ReturnType<typeof spawn>; containerName?: string }
  ): void {
    const executions =
      this.activeExecutions.get(taskId) ?? new Map<string, { label: string; process: ReturnType<typeof spawn>; containerName?: string }>();
    executions.set(executionId, execution);
    this.activeExecutions.set(taskId, executions);
  }

  private unregisterActiveExecution(taskId: string, executionId: string, process?: ReturnType<typeof spawn>): void {
    const executions = this.activeExecutions.get(taskId);
    if (!executions) {
      return;
    }

    const current = executions.get(executionId);
    if (process && current?.process !== process) {
      return;
    }

    executions.delete(executionId);
    if (executions.size === 0) {
      this.activeExecutions.delete(taskId);
    }
  }

  private async syncTaskStatusForRunningRuns(taskId: string, patch: Partial<Task> = {}): Promise<boolean> {
    const runs = await this.taskStore.listRuns(taskId);
    const activeRuns = runs.filter((run) => run.status === "running");
    if (activeRuns.length === 0) {
      return false;
    }

    const executionAction = activeRuns.some((run) => run.action === "build") ? "build" : "ask";
    const earliestStartedAt = activeRuns.reduce(
      (earliest, run) => (run.startedAt < earliest ? run.startedAt : earliest),
      activeRuns[0]!.startedAt
    );

    await this.taskStore.setExecutionState(taskId, "running", {
      ...patch,
      executionAction,
      startedAt: earliestStartedAt,
      finishedAt: null,
      errorMessage: null,
      enqueued: false
    });

    return true;
  }

  private resolveProviderStateContainerPath(provider: AgentProvider): string {
    return provider === "claude" ? "/runtime/home/.claude" : "/root/.codex";
  }

  private resolveRepoCachePath(task: Task): string {
    const repoCacheKey = sanitizePathSegment(task.repoId || task.repoName || "repo").replace(/\//g, "-");
    return path.join(env.REPO_CACHE_ROOT, "repos", repoCacheKey);
  }

  private resolveRepoProfilePath(task: Task): string {
    const repoCacheKey = sanitizePathSegment(task.repoId || task.repoName || "repo").replace(/\//g, "-");
    const branchKey = sanitizePathSegment(task.baseBranch || "branch").replace(/\//g, "-");
    return path.join(env.REPO_CACHE_ROOT, "profiles", `${repoCacheKey}-${branchKey}.json`);
  }

  private buildRepoProfileSummary(
    baseBranch: string,
    headSha: string,
    allFilePaths: string[],
    rootPackageJson: string | null,
    workspacePackageSummaries: string[]
  ): string {
    const lines: string[] = [
      "# Repo Profile",
      `- Branch: ${baseBranch}  Head: ${headSha.slice(0, 12)}`
    ];

    // --- package.json metadata ---
    if (rootPackageJson) {
      try {
        const parsed = JSON.parse(rootPackageJson) as {
          scripts?: Record<string, string>;
          workspaces?: string[] | { packages?: string[] };
        };
        const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 10);
        const workspacePatterns = Array.isArray(parsed.workspaces)
          ? parsed.workspaces
          : (parsed.workspaces?.packages ?? []);
        if (scripts.length > 0) lines.push(`- Root scripts: ${scripts.join(", ")}`);
        if (workspacePatterns.length > 0) lines.push(`- Workspaces: ${workspacePatterns.slice(0, 8).join(", ")}`);
      } catch {
        // Best effort only.
      }
    }

    if (workspacePackageSummaries.length > 0) {
      lines.push(`- Packages: ${workspacePackageSummaries.join(" | ")}`);
    }

    // --- 2-level directory map ---
    // Group every file under its top-two-level folder (e.g. "apps/server").
    // Within each group keep only filenames (no full paths) to stay compact.
    const MAX_DIRS = 40;
    const MAX_FILES_PER_DIR = 16;

    const dirMap = new Map<string, string[]>();
    for (const filePath of allFilePaths) {
      const parts = filePath.split("/");
      // Key = top two directory segments (or top one for root-level files).
      const key = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
      const fileName = parts[parts.length - 1];
      if (!dirMap.has(key)) dirMap.set(key, []);
      const files = dirMap.get(key)!;
      if (files.length < MAX_FILES_PER_DIR) files.push(fileName);
      else if (files.length === MAX_FILES_PER_DIR) files.push("…");
    }

    // Sort: root-level files first, then alphabetically by path.
    const sorted = [...dirMap.entries()].sort(([a], [b]) => {
      const aDepth = a.includes("/") ? 1 : 0;
      const bDepth = b.includes("/") ? 1 : 0;
      return aDepth - bDepth || a.localeCompare(b);
    });

    lines.push("\n## Directory map");
    let dirCount = 0;
    for (const [dir, files] of sorted) {
      if (dirCount++ >= MAX_DIRS) { lines.push("  … (more directories omitted)"); break; }
      const isRootFile = !dir.includes("/");
      // Deduplicate filenames (same name can appear across sub-subdirs).
      const unique = [...new Set(files)];
      if (isRootFile) {
        // Root-level entry — just show it directly.
        lines.push(`  ${dir}`);
      } else {
        lines.push(`  ${dir}/: ${unique.join(", ")}`);
      }
    }

    // --- Notable files agents commonly look for ---
    const notable: string[] = [];
    const notablePatterns: Array<[RegExp, string]> = [
      [/^(src\/)?index\.(ts|tsx|js|mjs)$/, "entry"],
      [/^(src\/)?main\.(ts|tsx|js|mjs)$/, "entry"],
      [/^(src\/)?server\.(ts|js|mjs)$/, "entry"],
      [/^(src\/)?app\.(ts|tsx|js|mjs)$/, "entry"],
      [/^Dockerfile$/, "docker"],
      [/^docker-compose\.ya?ml$/, "docker"],
      [/^tsconfig\.json$/, "typescript"],
      [/^\.env\.example$/, "env template"],
      [/^AGENTS\.md$/i, "agent rules"],
      [/^CLAUDE\.md$/i, "agent rules"],
      [/^README\.md$/i, "readme"],
    ];
    for (const filePath of allFilePaths) {
      const fileName = filePath.split("/").pop() ?? "";
      for (const [pattern, label] of notablePatterns) {
        if (pattern.test(fileName) || pattern.test(filePath)) {
          notable.push(`${filePath} (${label})`);
          break;
        }
      }
    }
    if (notable.length > 0) {
      lines.push("\n## Notable files");
      for (const n of notable.slice(0, 20)) lines.push(`  ${n}`);
    }

    lines.push("\n- Use Grep/Glob for targeted search before broad LS exploration.");
    return lines.join("\n");
  }

  private async readGitFile(
    repoPath: string,
    ref: string,
    filePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    try {
      return await this.gitCommandCapture(["-C", repoPath, "show", `${ref}:${filePath}`], githubToken, gitUsername);
    } catch {
      return null;
    }
  }

  private async readGitFileBuffer(
    repoPath: string,
    ref: string,
    filePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<Buffer | null> {
    try {
      return await this.gitCommandCaptureBuffer(["-C", repoPath, "show", `${ref}:${filePath}`], githubToken, gitUsername);
    } catch {
      return null;
    }
  }

  async listTaskWorkspaceFiles(
    task: Task,
    options?: { prefix?: string | null; limit?: number }
  ): Promise<TaskWorkspaceFileTree> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    const safeLimit = Number.isFinite(options?.limit)
      ? Math.max(1, Math.min(WORKSPACE_FILE_TREE_MAX_LIMIT, Math.floor(options?.limit ?? WORKSPACE_FILE_TREE_DEFAULT_LIMIT)))
      : WORKSPACE_FILE_TREE_DEFAULT_LIMIT;
    const normalizedPrefix = options?.prefix?.trim() ? normalizeSafeWorkspaceRelativePath(options.prefix) : "";

    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);

    if (!workspaceExists) {
      return {
        prefix: normalizedPrefix || null,
        entries: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    if (options?.prefix?.trim() && !normalizedPrefix) {
      return {
        prefix: null,
        entries: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    const targetPath = normalizedPrefix ? resolveSafeWorkspaceFilePath(workspacePath, normalizedPrefix) : workspacePath;
    if (!targetPath) {
      return {
        prefix: normalizedPrefix || null,
        entries: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    let children: Dirent[];
    try {
      children = await readdir(targetPath, { withFileTypes: true });
    } catch {
      return {
        prefix: normalizedPrefix || null,
        entries: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    const entries: TaskWorkspaceFileTreeEntry[] = [];
    let truncated = false;
    for (const child of children) {
      if (child.name === ".git") {
        continue;
      }
      if (!child.isDirectory() && !child.isFile()) {
        continue;
      }

      const relativePath = normalizedPrefix ? `${normalizedPrefix}/${child.name}` : child.name;
      entries.push({
        path: relativePath,
        name: child.name,
        kind: child.isDirectory() ? "directory" : "file"
      });

      if (entries.length >= safeLimit) {
        truncated = true;
        break;
      }
    }

    return {
      prefix: normalizedPrefix || null,
      entries,
      fetchedAt: new Date().toISOString(),
      truncated,
      totalCount: entries.length
    };
  }

  async searchTaskWorkspaceFiles(
    task: Task,
    options: { query: string; limit?: number }
  ): Promise<TaskWorkspaceFileSearchResult> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    const query = options.query.trim().toLowerCase();
    const safeLimit = Number.isFinite(options.limit)
      ? Math.max(1, Math.min(WORKSPACE_FILE_SEARCH_MAX_LIMIT, Math.floor(options.limit ?? WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT)))
      : WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT;

    if (!query) {
      return {
        query: options.query,
        results: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      return {
        query: options.query,
        results: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
        totalCount: 0
      };
    }

    const results: string[] = [];
    const queue: Array<{ absolutePath: string; relativePath: string }> = [{ absolutePath: workspacePath, relativePath: "" }];

    while (queue.length > 0 && results.length < safeLimit) {
      const current = queue.pop();
      if (!current) {
        break;
      }

      let children: Dirent[];
      try {
        children = await readdir(current.absolutePath, { withFileTypes: true });
      } catch {
        continue;
      }

      children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
      const directoriesToVisit: Array<{ absolutePath: string; relativePath: string }> = [];

      for (const child of children) {
        if (child.name === ".git") {
          continue;
        }

        const relativePath = current.relativePath ? `${current.relativePath}/${child.name}` : child.name;
        if (child.isDirectory()) {
          const safeDirectoryPath = resolveSafeWorkspaceFilePath(workspacePath, relativePath);
          if (!safeDirectoryPath) {
            continue;
          }
          directoriesToVisit.push({
            absolutePath: safeDirectoryPath,
            relativePath
          });
          continue;
        }

        if (!child.isFile()) {
          continue;
        }

        const candidate = relativePath.toLowerCase();
        if (candidate.includes(query)) {
          results.push(relativePath);
          if (results.length >= safeLimit) {
            break;
          }
        }
      }

      for (let index = directoriesToVisit.length - 1; index >= 0; index -= 1) {
        queue.push(directoriesToVisit[index]!);
      }
    }

    return {
      query: options.query,
      results,
      fetchedAt: new Date().toISOString(),
      truncated: results.length >= safeLimit,
      totalCount: results.length
    };
  }

  async getTaskWorkspaceFilePreview(
    task: Task,
    filePath: string,
    ref?: string | null
  ): Promise<TaskWorkspaceFilePreview | null> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    const relativePath = normalizeSafeWorkspaceRelativePath(filePath);
    if (!relativePath) {
      return null;
    }

    const refValue = ref?.trim() || null;
    if (refValue && !SAFE_GIT_PREVIEW_REF_PATTERN.test(refValue)) {
      return null;
    }

    let buffer: Buffer | null;
    if (refValue) {
      const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
      buffer = await this.readGitFileBuffer(workspacePath, refValue, relativePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } else {
      buffer = await readSafeWorkspaceFileBuffer(workspacePath, relativePath);
    }

    if (buffer === null) {
      return null;
    }

    if (buffer.length > WORKSPACE_FILE_PREVIEW_MAX_BYTES) {
      throw new Error(`File is too large to preview (${buffer.length} bytes).`);
    }

    const mimeType = getPreviewMimeType(relativePath);
    if (mimeType) {
      return {
        path: relativePath,
        ref: refValue,
        kind: "image",
        mimeType,
        encoding: "base64",
        content: buffer.toString("base64"),
        sizeBytes: buffer.length
      };
    }

    if (isBinaryBuffer(buffer)) {
      return {
        path: relativePath,
        ref: refValue,
        kind: "binary",
        mimeType: null,
        encoding: "base64",
        content: "",
        sizeBytes: buffer.length
      };
    }

    return {
      path: relativePath,
      ref: refValue,
      kind: "text",
      mimeType: null,
      encoding: "utf8",
      content: buffer.toString("utf8"),
      sizeBytes: buffer.length
    };
  }

  private async ensureRepoProfile(task: Task, repoPath: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const ref = `origin/${task.baseBranch}`;
    const profilePath = this.resolveRepoProfilePath(task);
    const headSha = await this.gitCommandCapture(["-C", repoPath, "rev-parse", ref], githubToken, gitUsername);

    try {
      const raw = await readFile(profilePath, "utf8");
      const cached = JSON.parse(raw) as CachedRepoProfile;
      if (cached.baseBranch === task.baseBranch && cached.headSha === headSha && cached.summary.trim().length > 0) {
        return cached.summary;
      }
    } catch {
      // Cache miss.
    }

    const rootPackageJson = await this.readGitFile(repoPath, ref, "package.json", githubToken, gitUsername);

    // Fetch every file path in the repo once — used for both the directory map
    // and workspace package discovery, so we only pay the git cost once.
    const allFilePathsRaw = await this.gitCommandCapture(["-C", repoPath, "ls-tree", "-r", "--name-only", ref], githubToken, gitUsername);
    const allFilePaths = allFilePathsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const workspacePackagePaths = allFilePaths
      .filter((line) => /^(apps|packages|services|libs)\//.test(line) && line.endsWith("/package.json"))
      .slice(0, 8);

    const workspacePackageSummaries: string[] = [];
    for (const packagePath of workspacePackagePaths) {
      const packageJson = await this.readGitFile(repoPath, ref, packagePath, githubToken, gitUsername);
      if (!packageJson) {
        continue;
      }

      try {
        const parsed = JSON.parse(packageJson) as { name?: string; scripts?: Record<string, string> };
        const scripts = Object.keys(parsed.scripts ?? {})
          .filter((name) => ["build", "test", "lint", "dev", "start"].includes(name))
          .slice(0, 4);
        workspacePackageSummaries.push(`${parsed.name ?? packagePath}: ${scripts.join("/") || "no common scripts"}`);
      } catch {
        workspacePackageSummaries.push(packagePath);
      }
    }

    const summary = this.buildRepoProfileSummary(task.baseBranch, headSha, allFilePaths, rootPackageJson, workspacePackageSummaries);
    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(
      profilePath,
      JSON.stringify(
        {
          baseBranch: task.baseBranch,
          headSha,
          summary
        } satisfies CachedRepoProfile,
        null,
        2
      ),
      "utf8"
    );

    return summary;
  }

  private async ensureManagedRepoFresh(
    task: Task,
    operation: RepoSyncOperation,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const repoPath = this.resolveRepoCachePath(task);
    await mkdir(path.dirname(repoPath), { recursive: true });

    const repoGitDir = path.join(repoPath, ".git");
    const repoExists = await access(repoGitDir)
      .then(() => true)
      .catch(() => false);
    if (!repoExists) {
      await rm(repoPath, { recursive: true, force: true });
      await mkdir(repoPath, { recursive: true });
      await this.gitCommand(["init", repoPath], githubToken, gitUsername);
    }

    await this.gitCommand(["-C", repoPath, "symbolic-ref", "HEAD", SpawnerService.MANAGED_REPO_HEAD_REF], githubToken, gitUsername).catch(
      () => undefined
    );
    await this.gitCommand(["-C", repoPath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername).catch(async () => {
      await this.gitCommand(["-C", repoPath, "remote", "add", "origin", task.repoUrl], githubToken, gitUsername);
    });

    const syncDecision = this.repoSyncManager.decide(repoPath, operation);
    if (!repoExists || syncDecision.shouldFetch) {
      await this.gitCommand(
        ["-C", repoPath, "fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"],
        githubToken,
        gitUsername
      );
      this.repoSyncManager.markFetched(repoPath);
    }

    if (!repoExists || syncDecision.shouldPrune) {
      await this.gitCommand(["-C", repoPath, "worktree", "prune"], githubToken, gitUsername).catch(() => undefined);
      this.repoSyncManager.markPruned(repoPath);
    }

    return repoPath;
  }

  private async localBranchExists(workspacePath: string, branchName: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<boolean> {
    try {
      await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", branchName], githubToken, gitUsername);
      return true;
    } catch {
      return false;
    }
  }

  private async refExists(workspacePath: string, ref: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<boolean> {
    try {
      await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", ref], githubToken, gitUsername);
      return true;
    } catch {
      return false;
    }
  }

  async getTaskBranchSyncCounts(task: Task): Promise<{ pullCount: number; pushCount: number }> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      return { pullCount: 0, pushCount: 0 };
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return { pullCount: 0, pushCount: 0 };
    }

    try {
      if (!(await this.localBranchExists(workspacePath, branchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
        return { pullCount: 0, pushCount: 0 };
      }

      await this.refreshWorkspaceRemoteState(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "status");

      let pullCount = 0;
      let pushCount = 0;
      const remoteRef = `origin/${branchName}`;
      const remoteExists = await this.refExists(workspacePath, remoteRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

      if (remoteExists) {
        const divergence = await this.gitCommandCapture(
          ["-C", workspacePath, "rev-list", "--left-right", "--count", `${branchName}...${remoteRef}`],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        const [aheadRaw, behindRaw] = divergence.trim().split(/\s+/);
        pushCount = Number.parseInt(aheadRaw ?? "0", 10) || 0;
        pullCount = Number.parseInt(behindRaw ?? "0", 10) || 0;
      } else if (branchName !== task.baseBranch) {
        const baseRef = `origin/${task.baseBranch}`;
        if (await this.refExists(workspacePath, baseRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername)) {
          const localOnly = await this.gitCommandCapture(
            ["-C", workspacePath, "rev-list", "--count", `${baseRef}..${branchName}`],
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          );
          pushCount = Number.parseInt(localOnly.trim(), 10) || 0;
        }
      }

      const dirtyOutput = await this.gitCommandCaptureAllowExitCodes(
        ["-C", workspacePath, "status", "--porcelain"],
        [0],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      if (dirtyOutput.trim().length > 0) {
        pushCount += 1;
      }

      return { pullCount, pushCount };
    } catch {
      return { pullCount: 0, pushCount: 0 };
    }
  }

  private async computeTaskBranchSyncCounts(
    task: Task,
    workspacePath: string,
    branchName: string,
    hasUncommittedChanges: boolean,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ pullCount: number; pushCount: number }> {
    let pullCount = 0;
    let pushCount = 0;
    const remoteRef = `origin/${branchName}`;
    const remoteExists = await this.refExists(workspacePath, remoteRef, githubToken, gitUsername);

    if (remoteExists) {
      const divergence = await this.gitCommandCapture(
        ["-C", workspacePath, "rev-list", "--left-right", "--count", `${branchName}...${remoteRef}`],
        githubToken,
        gitUsername
      );
      const [aheadRaw, behindRaw] = divergence.trim().split(/\s+/);
      pushCount = Number.parseInt(aheadRaw ?? "0", 10) || 0;
      pullCount = Number.parseInt(behindRaw ?? "0", 10) || 0;
    } else if (branchName !== task.baseBranch) {
      const baseRef = `origin/${task.baseBranch}`;
      if (await this.refExists(workspacePath, baseRef, githubToken, gitUsername)) {
        const localOnly = await this.gitCommandCapture(
          ["-C", workspacePath, "rev-list", "--count", `${baseRef}..${branchName}`],
          githubToken,
          gitUsername
        );
        pushCount = Number.parseInt(localOnly.trim(), 10) || 0;
      }
    }

    if (hasUncommittedChanges) {
      pushCount += 1;
    }

    return { pullCount, pushCount };
  }

  private async resolveLiveDiffBaseRef(
    task: Task,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    if (task.workspaceBaseRef && (await this.refExists(workspacePath, task.workspaceBaseRef, githubToken, gitUsername))) {
      return task.workspaceBaseRef;
    }

    const remoteBaseRef = `origin/${task.baseBranch}`;
    const isFeatureBranch = task.branchName && task.branchName !== task.baseBranch;
    if (isFeatureBranch && (await this.refExists(workspacePath, remoteBaseRef, githubToken, gitUsername))) {
      return remoteBaseRef;
    }

    const remoteBranchRef = task.branchName ? `origin/${task.branchName}` : null;
    if (remoteBranchRef && (await this.refExists(workspacePath, remoteBranchRef, githubToken, gitUsername))) {
      return remoteBranchRef;
    }

    if (await this.refExists(workspacePath, remoteBaseRef, githubToken, gitUsername)) {
      return remoteBaseRef;
    }

    return (await this.refExists(workspacePath, "HEAD", githubToken, gitUsername)) ? "HEAD" : null;
  }

  private async listUntrackedRelativePaths(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string[]> {
    const output = await this.gitCommandCaptureRaw(
      ["-C", workspacePath, "ls-files", "--others", "--exclude-standard", "-z"],
      githubToken,
      gitUsername
    );
    return output.split("\0").filter((line) => line.length > 0);
  }

  private async collectUntrackedFileDiff(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const untrackedFiles = await this.listUntrackedRelativePaths(workspacePath, githubToken, gitUsername);
    if (untrackedFiles.length === 0) {
      return "";
    }

    const patches: string[] = [];
    for (const filePath of untrackedFiles) {
      try {
        const patch = await this.gitCommandCaptureAllowExitCodes(
          ["-C", workspacePath, "diff", "--no-index", "--", "/dev/null", filePath],
          [1],
          githubToken,
          gitUsername
        );
        if (patch.trim().length > 0) {
          patches.push(patch.trimEnd());
        }
      } catch {
        // Best effort: ignore files that disappear during collection.
      }
    }

    return patches.join("\n");
  }

  private async collectCompareDiff(
    workspacePath: string,
    baseRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    return (await this.gitCommandCapture(["-C", workspacePath, "diff", `${baseRef}...HEAD`], githubToken, gitUsername)).trim();
  }

  private async collectWorkingTreeDiff(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const workingDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", "HEAD"], githubToken, gitUsername);
    const untrackedDiff = await this.collectUntrackedFileDiff(workspacePath, githubToken, gitUsername);
    return [workingDiff, untrackedDiff].filter((chunk) => chunk.trim().length > 0).join("\n").trim();
  }

  private async collectCommitPatch(
    workspacePath: string,
    commitSha: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    let patch = await this.gitCommandCapture(
      ["-C", workspacePath, "show", "--no-color", "--pretty=format:", "-p", "--no-textconv", commitSha],
      githubToken,
      gitUsername
    );
    if (patch.length > SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS) {
      patch = `${patch.slice(0, SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS)}\n\n… (diff truncated for preview)`;
    }
    return patch.trim();
  }

  private static readonly WORKSPACE_LOG_MAX_COMMITS = 200;

  async getWorkspaceCommitLog(task: Task, options?: { limit?: number }): Promise<TaskWorkspaceCommitLog> {
    const fetchedAt = new Date().toISOString();
    const empty = (message: string | null): TaskWorkspaceCommitLog => ({
      commits: [],
      fetchedAt,
      message
    });

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);

    if (!workspaceExists) {
      return empty("Local workspace is unavailable for this task.");
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const token = runtimeCredentials.githubToken;
    const gitUsername = runtimeCredentials.gitUsername;

    const requested = options?.limit ?? 50;
    const limit = Math.min(
      Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 50),
      SpawnerService.WORKSPACE_LOG_MAX_COMMITS
    );

    const fieldSep = "\x1e";
    const format = `%H${fieldSep}%s${fieldSep}%cI${fieldSep}%an`;
    let raw: string;
    try {
      raw = await this.gitCommandCapture(["-C", workspacePath, "log", `-${limit}`, `--format=${format}`], token, gitUsername);
    } catch {
      return empty("Could not read commit history in this workspace.");
    }

    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    const unpushedShas =
      branchName
        ? await this.getUnpushedCommitShas(workspacePath, branchName, task.baseBranch, token, gitUsername).catch(() => new Set<string>())
        : new Set<string>();

    const commits: TaskWorkspaceCommit[] = [];
    for (const line of raw.trim().split("\n")) {
      if (!line) {
        continue;
      }
      const parts = line.split(fieldSep);
      if (parts.length < 4 || !parts[0]) {
        continue;
      }
      const [sha, subject, committedAt, authorName] = parts;
      commits.push({
        sha,
        shortSha: sha.slice(0, 7),
        subject,
        committedAt,
        authorName,
        isPushed: !unpushedShas.has(sha)
      });
    }

    return { commits, fetchedAt, message: null };
  }

  private async normalizeUserCompareBaseRef(
    workspacePath: string,
    input: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (!trimmed.includes("/") && trimmed.toUpperCase() !== "HEAD") {
      const originRef = `origin/${trimmed}`;
      if (await this.refExists(workspacePath, originRef, githubToken, gitUsername)) {
        return originRef;
      }
    }

    if (await this.refExists(workspacePath, trimmed, githubToken, gitUsername)) {
      return trimmed;
    }

    return null;
  }

  private async getWorkspaceHeadInfo(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ branch: string; shaShort: string } | null> {
    try {
      const branch = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"], githubToken, gitUsername)).trim();
      const shaShort = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--short", "HEAD"], githubToken, gitUsername)).trim();
      return { branch, shaShort };
    } catch {
      return null;
    }
  }

  async getLiveTaskDiff(
    task: Task,
    options?: { compareBaseRef?: string; diffKind?: "compare" | "working" | "commits"; commitSha?: string | null }
  ): Promise<TaskLiveDiff> {
    const diffKind: "compare" | "working" | "commits" =
      options?.diffKind === "working" ? "working" : options?.diffKind === "commits" ? "commits" : "compare";
    return this.measureTaskGitRead(
      { success: "live_diff_loaded", failure: "live_diff_failed" },
      task.id,
      async () => {
        const fetchedAt = new Date().toISOString();
        const emptyHead = (): TaskLiveDiff => ({
          diff: null,
          live: false,
          fetchedAt,
          message: null,
          headBranch: null,
          headShaShort: null,
          baseRef: null,
          defaultBaseRef: null
        });

        const workspacePath = this.resolveWorkspacePath(task.id);
        const workspaceExists = await access(workspacePath)
          .then(() => true)
          .catch(() => false);

        if (!workspaceExists) {
          return {
            ...emptyHead(),
            message: "Local workspace is unavailable for this task."
          };
        }

        const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
        const token = runtimeCredentials.githubToken;
        const gitUsername = runtimeCredentials.gitUsername;

        const headInfo = await this.getWorkspaceHeadInfo(workspacePath, token, gitUsername);

        if (diffKind === "commits") {
          const defaultBaseRef = await this.resolveLiveDiffBaseRef(task, workspacePath, token, gitUsername);
          const shaRaw = options?.commitSha?.trim() ?? "";
          if (!shaRaw) {
            return {
              diff: null,
              live: true,
              fetchedAt,
              message: null,
              headBranch: headInfo?.branch ?? null,
              headShaShort: headInfo?.shaShort ?? null,
              baseRef: null,
              defaultBaseRef
            };
          }
          if (!/^[0-9a-f]{7,40}$/i.test(shaRaw)) {
            return {
              diff: null,
              live: false,
              fetchedAt,
              message: "Invalid commit id.",
              headBranch: headInfo?.branch ?? null,
              headShaShort: headInfo?.shaShort ?? null,
              baseRef: null,
              defaultBaseRef
            };
          }
          try {
            await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", `${shaRaw}^{commit}`], token, gitUsername);
          } catch {
            return {
              diff: null,
              live: false,
              fetchedAt,
              message: "Commit not found in this workspace.",
              headBranch: headInfo?.branch ?? null,
              headShaShort: headInfo?.shaShort ?? null,
              baseRef: null,
              defaultBaseRef
            };
          }
          const diff = await this.collectCommitPatch(workspacePath, shaRaw, token, gitUsername);
          return {
            diff: diff || null,
            live: true,
            fetchedAt,
            message: null,
            headBranch: headInfo?.branch ?? null,
            headShaShort: headInfo?.shaShort ?? null,
            baseRef: null,
            defaultBaseRef
          };
        }

        if (diffKind === "working") {
          const defaultBaseRef = await this.resolveLiveDiffBaseRef(task, workspacePath, token, gitUsername);
          const diff = await this.collectWorkingTreeDiff(workspacePath, token, gitUsername);
          return {
            diff: diff || null,
            live: true,
            fetchedAt,
            message: null,
            headBranch: headInfo?.branch ?? null,
            headShaShort: headInfo?.shaShort ?? null,
            baseRef: null,
            defaultBaseRef
          };
        }

        await this.syncWorkspaceRemoteRefsIfNeeded(task, workspacePath, token, gitUsername).catch(() => undefined);

        const defaultBaseRef = await this.resolveLiveDiffBaseRef(task, workspacePath, token, gitUsername);
        if (!defaultBaseRef) {
          return {
            ...emptyHead(),
            message: "No compare base is available yet."
          };
        }

        let baseRef = defaultBaseRef;

        if (options?.compareBaseRef?.trim()) {
          const resolved = await this.normalizeUserCompareBaseRef(workspacePath, options.compareBaseRef, token, gitUsername);
          if (!resolved) {
            return {
              diff: null,
              live: false,
              fetchedAt,
              message: `Compare ref not found in workspace: ${options.compareBaseRef.trim()}`,
              headBranch: headInfo?.branch ?? null,
              headShaShort: headInfo?.shaShort ?? null,
              baseRef: null,
              defaultBaseRef
            };
          }
          baseRef = resolved;
        }
        const diff = await this.collectCompareDiff(workspacePath, baseRef, token, gitUsername);
        return {
          diff: diff || null,
          live: true,
          fetchedAt,
          message: null,
          headBranch: headInfo?.branch ?? null,
          headShaShort: headInfo?.shaShort ?? null,
          baseRef,
          defaultBaseRef
        };
      },
      (result) => ({
        diff_kind: diffKind,
        live: result.live,
        diff_chars: result.diff?.length ?? 0,
        base_ref: result.baseRef,
        default_base_ref: result.defaultBaseRef
      })
    );
  }

  private async prepareWorkspaceLegacyWorktree(
    task: Task,
    branchName: string,
    repoCachePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<WorkspacePreparation> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);

    if (!workspaceExists) {
      await mkdir(path.dirname(workspacePath), { recursive: true });
      if (task.branchStrategy === "work_on_branch") {
        const activeWorktreePath = await this.findBranchWorktreePath(repoCachePath, task.baseBranch, githubToken, gitUsername);
        if (activeWorktreePath && activeWorktreePath !== repoCachePath) {
          await this.cloneWorkspaceFallback(task, workspacePath, task.baseBranch, githubToken, gitUsername);
        } else {
          await this.addManagedWorktree(repoCachePath, workspacePath, task.baseBranch, `origin/${task.baseBranch}`, githubToken, gitUsername);
        }
      } else if (await this.refExists(repoCachePath, `origin/${branchName}`, githubToken, gitUsername)) {
        await this.addManagedWorktree(repoCachePath, workspacePath, branchName, `origin/${branchName}`, githubToken, gitUsername);
      } else {
        await this.addManagedWorktree(repoCachePath, workspacePath, branchName, `origin/${task.baseBranch}`, githubToken, gitUsername);
      }
    } else {
      await this.cleanupWorkspaceGitLocks(workspacePath);
      await this.syncWorkspaceRemoteRefsIfNeeded(task, workspacePath, githubToken, gitUsername);
    }

    const startRef = await this.resolveWorkspaceHeadRef(workspacePath, githubToken, gitUsername);
    if (!startRef) {
      throw new WorkspacePrepareError(
        "Workspace setup failed: repository has no commits yet, so HEAD is not available.",
        "branch_missing"
      );
    }
    return {
      workspacePath,
      hostWorkspacePath: this.resolveWorkspaceHostPath(task.id),
      startRef,
      workspaceBaseRef: task.workspaceBaseRef ?? startRef,
      kind: WORKSPACE_KIND,
      ephemeral: false,
      cleanupRepoPath: null
    };
  }

  private async prepareWorkspace(
    task: Task,
    _action: TaskAction,
    branchName: string,
    repoCachePath: string,
    provisioningMode: "clone_only" | "hybrid",
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<WorkspacePreparation> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    try {
      await this.cloneWorkspaceFromSource(repoCachePath, task.repoUrl, workspacePath, githubToken, gitUsername);
      await this.checkoutTaskWorkspaceBranch(task, workspacePath, branchName, githubToken, gitUsername);
    } catch (error) {
      const reason = this.classifyWorkspacePrepareFailure(error);
      const detail = error instanceof Error ? error.message : String(error);
      if (provisioningMode === "hybrid" && (reason === "clone_error" || reason === "unknown")) {
        return this.prepareWorkspaceLegacyWorktree(task, branchName, repoCachePath, githubToken, gitUsername);
      }
      if (error instanceof WorkspacePrepareError) {
        throw error;
      }

      switch (reason) {
        case "auth":
          throw new WorkspacePrepareError(
            "Workspace setup failed: repository access was denied. Check GitHub token permissions for this repository.",
            reason,
            detail
          );
        case "network":
          throw new WorkspacePrepareError(
            "Workspace setup failed: could not reach the Git remote. Check network/DNS connectivity and retry.",
            reason,
            detail
          );
        case "branch_missing":
          throw new WorkspacePrepareError(
            `Workspace setup failed: expected branch refs were not found on origin (base branch: ${task.baseBranch}).`,
            reason,
            detail
          );
        default:
          throw new WorkspacePrepareError(
            "Workspace setup failed while cloning the repository. See task logs for git error details.",
            reason,
            detail
          );
      }
    }

    const startRef = await this.resolveWorkspaceHeadRef(workspacePath, githubToken, gitUsername);
    if (!startRef) {
      throw new WorkspacePrepareError(
        "Workspace setup failed: repository has no commits yet, so HEAD is not available.",
        "branch_missing"
      );
    }
    return {
      workspacePath,
      hostWorkspacePath: this.resolveWorkspaceHostPath(task.id),
      startRef,
      workspaceBaseRef: task.workspaceBaseRef ?? startRef,
      kind: WORKSPACE_KIND,
      ephemeral: false,
      cleanupRepoPath: null
    };
  }

  private async prepareAskRunWorkspace(
    task: Task,
    branchName: string,
    repoCachePath: string,
    provisioningMode: "clone_only" | "hybrid",
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<WorkspacePreparation> {
    const taskWorkspacePath = this.resolveWorkspacePath(task.id);
    const taskWorkspaceExists = await access(taskWorkspacePath)
      .then(() => true)
      .catch(() => false);

    if (!taskWorkspaceExists) {
      return this.prepareWorkspace(task, "ask", branchName, repoCachePath, provisioningMode, githubToken, gitUsername);
    }

    const gitPaths = await this.getWorkspaceGitPaths(taskWorkspacePath).catch(() => null);
    if (!gitPaths) {
      return this.prepareWorkspace(task, "ask", branchName, repoCachePath, provisioningMode, githubToken, gitUsername);
    }

    const startRef = await this.resolveWorkspaceHeadRef(taskWorkspacePath, githubToken, gitUsername);
    if (!startRef) {
      throw new Error("Task workspace has no commits yet. Prepare the task workspace again after creating an initial commit.");
    }
    return {
      workspacePath: taskWorkspacePath,
      hostWorkspacePath: this.resolveWorkspaceHostPath(task.id),
      startRef,
      workspaceBaseRef: task.workspaceBaseRef ?? startRef,
      kind: WORKSPACE_KIND,
      ephemeral: false,
      cleanupRepoPath: null
    };
  }

  private async requireExistingTaskWorkspace(
    task: Task,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<WorkspacePreparation> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      throw new Error("No local workspace exists for this task. Prepare the task workspace first.");
    }

    const gitPaths = await this.getWorkspaceGitPaths(workspacePath).catch(() => null);
    if (!gitPaths) {
      throw new Error("Task workspace is not a Git repository. Prepare the task workspace again.");
    }

    await this.cleanupWorkspaceGitLocks(workspacePath);
    const startRef = await this.resolveWorkspaceHeadRef(workspacePath, githubToken, gitUsername);
    if (!startRef) {
      throw new Error("Task workspace has no commits yet. Prepare the task workspace again after creating an initial commit.");
    }
    return {
      workspacePath,
      hostWorkspacePath: this.resolveWorkspaceHostPath(task.id),
      startRef,
      workspaceBaseRef: task.workspaceBaseRef ?? startRef,
      kind: WORKSPACE_KIND,
      ephemeral: false,
      cleanupRepoPath: null
    };
  }

  private async cleanupPreparedWorkspace(
    workspace: WorkspacePreparation | null,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    if (!workspace?.ephemeral) {
      return;
    }
    await rm(workspace.workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }

  private async writeRuntimePayloadFiles(
    manifest: RuntimeManifest,
    providerConfigContent: string
  ): Promise<{
    payloadDir: string;
    manifestPath: string;
    providerConfigPath: string;
    resultMarkdownPath: string;
    resultJsonPath: string;
  }> {
    const payloadDir = path.dirname(manifest.resultJsonPath);
    await rm(payloadDir, { recursive: true, force: true });
    await mkdir(payloadDir, { recursive: true });

    const manifestPath = path.join(payloadDir, "task-manifest.json");
    const providerConfigPath = manifest.providerConfigPath;
    const resultMarkdownPath = manifest.resultMarkdownPath;
    const resultJsonPath = manifest.resultJsonPath;

    await Promise.all([
      writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
      writeFile(providerConfigPath, providerConfigContent, "utf8"),
      writeFile(resultMarkdownPath, "", "utf8"),
      writeFile(resultJsonPath, "", "utf8")
    ]);

    return { payloadDir, manifestPath, providerConfigPath, resultMarkdownPath, resultJsonPath };
  }

  private async readRuntimeResult(resultMarkdownPath: string, resultJsonPath: string): Promise<RuntimeResultPayload> {
    const [markdown, rawJson] = await Promise.all([
      readFile(resultMarkdownPath, "utf8"),
      readFile(resultJsonPath, "utf8")
    ]);

    const parsed = JSON.parse(rawJson) as RuntimeResultPayload;
    if ((parsed.summaryMarkdown ?? "").trim().length === 0) {
      parsed.summaryMarkdown = markdown.trim();
    }

    return parsed;
  }

  private collectRuntimeMcpEnv(servers: McpServerConfig[]): Record<string, string> {
    return Object.fromEntries(collectMcpServerEnvEntries(servers, process.env));
  }

  private resolveInternalAgentSwarmMcpEndpoint(): string {
    return this.resolveInternalAgentSwarmMcpEndpoints()[0] ?? `http://127.0.0.1:${env.PORT}/mcp`;
  }

  private resolveInternalAgentSwarmMcpEndpoints(): string[] {
    if (existsSync("/.dockerenv")) {
      return [
        `http://127.0.0.1:${env.PORT}/mcp`,
        `http://host.docker.internal:${env.PORT}/mcp`,
        `http://172.17.0.1:${env.PORT}/mcp`
      ];
    }
    return [`http://host.docker.internal:${env.PORT}/mcp`, `http://172.17.0.1:${env.PORT}/mcp`];
  }

  private buildInternalAgentSwarmMcpDockerArgs(): string[] {
    if (existsSync("/.dockerenv")) {
      return ["--network", `container:${hostname()}`];
    }
    return ["--add-host", "host.docker.internal:host-gateway"];
  }

  buildRuntimeMcpDockerArgs(injectedAgentSwarmMcp: boolean): string[] {
    return injectedAgentSwarmMcp ? this.buildInternalAgentSwarmMcpDockerArgs() : [];
  }

  private async resolveRuntimeMcpUserId(task: Task): Promise<string | null> {
    if (task.ownerUserId) {
      const owner = await this.userStore.getAuthSessionUser(task.ownerUserId).catch(() => null);
      if (owner) {
        return owner.id;
      }
    }

    const users = await this.userStore.listUsers().catch(() => []);
    return users.find((user) => user.active && user.roles.some((role) => role.id === SYSTEM_ADMIN_ROLE_ID))?.id ?? null;
  }

  private async buildRuntimeMcpConfig(
    task: Task,
    configuredServers: McpServerConfig[],
    executionId: string
  ): Promise<{ servers: McpServerConfig[]; env: Record<string, string>; injectedAgentSwarmMcp: boolean }> {
    const baseServers = configuredServers.filter((server) => server.name !== AGENTSWARM_RUNTIME_MCP_SERVER_NAME);
    const baseEnv = this.collectRuntimeMcpEnv(baseServers);
    if (!this.personalAccessTokenStore) {
      return { servers: baseServers, env: baseEnv, injectedAgentSwarmMcp: false };
    }

    const userId = await this.resolveRuntimeMcpUserId(task);
    if (!userId) {
      return { servers: baseServers, env: baseEnv, injectedAgentSwarmMcp: false };
    }

    const token = await this.personalAccessTokenStore
      .createToken({
        userId,
        name: `AgentSwarm runtime MCP ${task.id}/${executionId}`,
        scopes: AGENTSWARM_RUNTIME_MCP_SCOPES,
        expiresAt: new Date(Date.now() + AGENTSWARM_RUNTIME_MCP_TOKEN_TTL_MS).toISOString()
      })
      .catch(() => null);
    if (!token) {
      return { servers: baseServers, env: baseEnv, injectedAgentSwarmMcp: false };
    }

    const agentSwarmMcpEndpoints = this.resolveInternalAgentSwarmMcpEndpoints();
    const agentSwarmMcpEnv = {
      [AGENTSWARM_RUNTIME_MCP_ENDPOINT_ENV]: agentSwarmMcpEndpoints[0] ?? this.resolveInternalAgentSwarmMcpEndpoint(),
      [AGENTSWARM_RUNTIME_MCP_ENDPOINTS_ENV]: agentSwarmMcpEndpoints.join(","),
      [AGENTSWARM_RUNTIME_MCP_TOKEN_ENV]: token.token
    };

    return {
      env: {
        ...baseEnv,
        ...agentSwarmMcpEnv
      },
      servers: [
        ...baseServers,
        {
          name: AGENTSWARM_RUNTIME_MCP_SERVER_NAME,
          transport: "stdio",
          command: "node",
          args: ["/usr/local/bin/agentswarm-mcp-bridge.mjs"],
          env: agentSwarmMcpEnv,
          enabled: true
        }
      ],
      injectedAgentSwarmMcp: true
    };
  }

  async buildRuntimeMcpConfigForTask(
    task: Task,
    configuredServers: McpServerConfig[],
    executionId: string
  ): Promise<{ servers: McpServerConfig[]; env: Record<string, string>; injectedAgentSwarmMcp: boolean }> {
    return this.buildRuntimeMcpConfig(task, configuredServers, executionId);
  }

  private async collectChangedFiles(workspacePath: string, startRef: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string[]> {
    const output = await this.gitCommandCapture(["-C", workspacePath, "diff", "--name-only", `${startRef}..HEAD`], githubToken, gitUsername);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private toCommitSubject(input: string): string {
    return formatCommitSubject(input);
  }

  private buildAutoApplyFallbackCommitSubject(task: Task, proposal: TaskChangeProposal): string {
    const primaryPath = proposal.changedFiles[0]?.trim() ?? "";
    const primaryName = primaryPath ? primaryPath.split("/").at(-1) ?? primaryPath : "";
    if (primaryName) {
      return this.toCommitSubject(`Apply checkpoint changes for ${primaryName}`);
    }
    return this.toCommitSubject(`Apply checkpoint changes for ${task.title}`);
  }

  private async generateAutoApplyCommitSubject(task: Task, proposal: TaskChangeProposal): Promise<string> {
    const fallback = this.buildAutoApplyFallbackCommitSubject(task, proposal);
    const filePath = proposal.changedFiles[0];
    const diffSnippet = proposal.diff.slice(0, 48_000);
    if (!filePath || !diffSnippet.trim() || diffSnippet.trim() === "(no changes)") {
      return fallback;
    }

    const [settings, credentials] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials(null, task.codexCredentialSource ?? "auto")
    ]);

    try {
      if (credentials.codexAuthJson) {
        try {
          const context = await buildDiffAssistPromptContext({
            taskId: task.id,
            userPrompt: AUTO_APPLY_COMMIT_MESSAGE_PROMPT,
            filePath,
            selectedSnippet: diffSnippet
          });
          const text = await executeCodexUtility({
            prompt: [
              "You write concise git commit subjects.",
              "",
              context,
              "",
              "Return only the requested commit subject line."
            ].join("\n"),
            model: AUTO_APPLY_COMMIT_MESSAGE_MODEL,
            providerProfile: AUTO_APPLY_COMMIT_MESSAGE_PROFILE,
            credentials
          });
          const candidate = normalizeGeneratedCommitSubject(text);
          if (candidate) {
            return this.toCommitSubject(candidate);
          }
        } catch (error) {
          if (!credentials.openaiApiKey || !(error instanceof CodexUtilityUnavailableError)) {
            throw error;
          }
        }
      }

      if (!credentials.openaiApiKey) {
        return fallback;
      }

      const result = await executeOpenAiDiffAssist({
        taskId: task.id,
        model: AUTO_APPLY_COMMIT_MESSAGE_MODEL,
        providerProfile: AUTO_APPLY_COMMIT_MESSAGE_PROFILE,
        userPrompt: AUTO_APPLY_COMMIT_MESSAGE_PROMPT,
        filePath,
        selectedSnippet: diffSnippet,
        openaiApiKey: credentials.openaiApiKey,
        openaiBaseUrl: settings.openaiBaseUrl
      });
      const candidate = normalizeGeneratedCommitSubject(result.text);
      return candidate ? this.toCommitSubject(candidate) : fallback;
    } catch (error) {
      await this.taskStore.appendLog(
        task.id,
        `Checkpoint ${proposal.id}: auto-apply commit subject generation failed; using fallback subject. ${error instanceof Error ? error.message : String(error)}`
      );
      return fallback;
    }
  }

  private async autoApplyCheckpointIfEnabled(taskId: string, proposalId: string): Promise<void> {
    const task = await this.taskStore.getTask(taskId);
    if (!task?.autoApplyCheckpoints) {
      return;
    }

    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== taskId || (proposal.status !== "pending" && proposal.status !== "applying")) {
      return;
    }

    const commitMessage = await this.generateAutoApplyCommitSubject(task, proposal);
    const result = await this.applyChangeProposal(task, proposal.id, {
      commitMessage,
      allowDuringExecution: true
    });
    if (!result.ok) {
      await this.taskStore.patchTask(taskId, { autoApplyCheckpoints: false, hasPendingCheckpoint: true });
      await this.taskStore.updateChangeProposalStatus(proposal.id, "pending", taskId);
      await this.taskStore.appendLog(
        taskId,
        `Checkpoint ${proposal.id}: auto-apply failed (${result.message}). Auto-apply was disabled for recovery.`
      );
      throw new Error(`Checkpoint auto-apply failed: ${result.message}`);
    }

    await this.taskStore.appendLog(taskId, `Checkpoint ${proposal.id}: auto-applied.`);
  }

  private async getStagedFiles(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string[]> {
    const raw = await this.gitCommandCapture(
      ["-C", workspacePath, "diff", "--cached", "--name-only"],
      githubToken,
      gitUsername
    );
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private buildGeneratedCommitSubjectFromFiles(task: Task, files: string[]): string {
    return buildTaskCommitSubject(task.title, files);
  }

  private async buildGeneratedCommitSubject(
    task: Task,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const stagedFiles = await this.getStagedFiles(workspacePath, githubToken, gitUsername);
    return this.buildGeneratedCommitSubjectFromFiles(task, stagedFiles);
  }

  private async getWorkingTreePathsVersusHead(
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string[]> {
    const raw = await this.gitCommandCapture(["-C", workspacePath, "diff", "HEAD", "--name-only"], githubToken, gitUsername);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private static readonly PUSH_PREVIEW_DIFF_MAX_CHARS = 120_000;
  private static readonly PUSH_PREVIEW_STAT_MAX_CHARS = 24_000;
  private static readonly CHANGE_PROPOSAL_DIFF_MAX_CHARS = 120_000;
  private static readonly CHANGE_PROPOSAL_STAT_MAX_CHARS = 24_000;

  private async collectTaskPushPreview(
    task: Task,
    workspacePath: string,
    branchName: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<TaskPushPreview> {
    const changedFiles = await this.getWorkingTreePathsVersusHead(workspacePath, githubToken, gitUsername);
    const suggestedCommitMessage = this.buildGeneratedCommitSubjectFromFiles(task, changedFiles);

    let fullDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", "HEAD"], githubToken, gitUsername);
    let diffTruncated = false;
    if (fullDiff.length > SpawnerService.PUSH_PREVIEW_DIFF_MAX_CHARS) {
      fullDiff = `${fullDiff.slice(0, SpawnerService.PUSH_PREVIEW_DIFF_MAX_CHARS)}\n\n… (diff truncated for preview)`;
      diffTruncated = true;
    }

    let diffStat = await this.gitCommandCapture(["-C", workspacePath, "diff", "HEAD", "--stat"], githubToken, gitUsername);
    if (diffStat.length > SpawnerService.PUSH_PREVIEW_STAT_MAX_CHARS) {
      diffStat = `${diffStat.slice(0, SpawnerService.PUSH_PREVIEW_STAT_MAX_CHARS)}\n… (stat truncated)`;
    }

    const unpushedCommitSubjects = await this.getUnpushedCommitSubjects(
      workspacePath,
      branchName,
      task.baseBranch,
      githubToken,
      gitUsername
    );

    return {
      branchName,
      changedFiles,
      diff: fullDiff.trim() || "(no local changes vs HEAD)",
      diffTruncated,
      diffStat: diffStat.trim() || "—",
      hasUncommittedChanges: changedFiles.length > 0,
      unpushedCommitSubjects,
      suggestedCommitMessage
    };
  }

  async getTaskPushPreview(task: Task): Promise<TaskPushPreview> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for publishing");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before pushing.");
    }

    const { githubToken, gitUsername } = runtimeCredentials;
    return this.collectTaskPushPreview(task, workspacePath, branchName, githubToken, gitUsername);
  }

  private async getUnpushedCommitSubjects(
    workspacePath: string,
    branchName: string,
    fallbackBaseBranch?: string | null,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string[]> {
    const remoteRef = `origin/${branchName}`;
    let logRange: string | null = null;

    if (await this.refExists(workspacePath, remoteRef, githubToken, gitUsername)) {
      logRange = `${remoteRef}..HEAD`;
    } else if (fallbackBaseBranch && fallbackBaseBranch !== branchName) {
      const fallbackRemoteRef = `origin/${fallbackBaseBranch}`;
      if (await this.refExists(workspacePath, fallbackRemoteRef, githubToken, gitUsername)) {
        logRange = `${fallbackRemoteRef}..${branchName}`;
      }
    }

    if (!logRange) {
      return [];
    }

    const raw = await this.gitCommandCaptureAllowExitCodes(
      ["-C", workspacePath, "log", "--pretty=format:%s", logRange],
      [0],
      githubToken,
      gitUsername
    );
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async getUnpushedCommitShas(
    workspacePath: string,
    branchName: string,
    fallbackBaseBranch?: string | null,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<Set<string>> {
    const remoteRef = `origin/${branchName}`;
    let logRange: string | null = null;

    if (await this.refExists(workspacePath, remoteRef, githubToken, gitUsername)) {
      logRange = `${remoteRef}..HEAD`;
    } else if (fallbackBaseBranch && fallbackBaseBranch !== branchName) {
      const fallbackRemoteRef = `origin/${fallbackBaseBranch}`;
      if (await this.refExists(workspacePath, fallbackRemoteRef, githubToken, gitUsername)) {
        logRange = `${fallbackRemoteRef}..${branchName}`;
      }
    }

    if (!logRange) {
      return new Set<string>();
    }

    const raw = await this.gitCommandCaptureAllowExitCodes(
      ["-C", workspacePath, "rev-list", logRange],
      [0],
      githubToken,
      gitUsername
    );

    return new Set(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    );
  }

  async getTaskGitStateSnapshot(task: Task): Promise<TaskGitStateSnapshot> {
    return this.measureTaskGitRead(
      { success: "git_state_snapshot_loaded", failure: "git_state_snapshot_failed" },
      task.id,
      async () => {
        const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
        const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
        if (!branchName) {
          throw new Error("No target branch available for publishing");
        }

        const workspacePath = this.resolveWorkspacePath(task.id);
        const exists = await access(workspacePath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          throw new Error("No local workspace exists for this task. Build it again before pushing.");
        }

        const { githubToken, gitUsername } = runtimeCredentials;
        await this.refreshWorkspaceRemoteState(task, workspacePath, githubToken, gitUsername, "status");
        const pushPreview = await this.collectTaskPushPreview(task, workspacePath, branchName, githubToken, gitUsername);
        const { pullCount, pushCount } = await this.computeTaskBranchSyncCounts(
          task,
          workspacePath,
          branchName,
          pushPreview.hasUncommittedChanges,
          githubToken,
          gitUsername
        );

        return {
          fetchedAt: new Date().toISOString(),
          pullCount,
          pushCount,
          pushPreview
        };
      },
      (snapshot) => ({
        pull_count: snapshot.pullCount,
        push_count: snapshot.pushCount,
        changed_file_count: snapshot.pushPreview.changedFiles.length,
        unpushed_commit_count: snapshot.pushPreview.unpushedCommitSubjects.length
      })
    );
  }

  private async getCommitSubject(
    workspacePath: string,
    commitSha: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    return (
      await this.gitCommandCapture(
        ["-C", workspacePath, "show", "-s", "--format=%s", commitSha],
        githubToken,
        gitUsername
      )
    ).trim();
  }

  private async appendGitActivityMessage(taskId: string, content: string): Promise<void> {
    await this.taskStore.appendMessage(taskId, {
      role: "system",
      content
    });
  }

  private async finalizeBuild(
    task: Task,
    workspacePath: string,
    diffBaseRef: string,
    runStartRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{
    branchDiff: string;
    diffStat: string;
    changedFiles: string[];
    diffTruncated: boolean;
    toRef: string;
    commitSha: string;
      providerCommitted: boolean;
      changeOutcome: "changed" | "no_change";
    }> {
    return this.measureTaskGitRead(
      { success: "build_finalize_diff_collected", failure: "build_finalize_diff_failed" },
      task.id,
      async () => {
        // Keep repo-owned .agentswarm files. Only strip workspace scratch paths from diffs/commits.
        await this.stripEphemeralWorkspaceFiles(workspacePath);
        const commitSha = await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);
        const providerCommitted = commitSha !== runStartRef;
        const { diff: branchDiff, diffStat, changedFiles, diffTruncated, toRef } = await this.collectWorkingTreeDiffSinceRef(
          workspacePath,
          diffBaseRef,
          githubToken,
          gitUsername
        );
        const changeOutcome = changedFiles.length > 0 ? "changed" : "no_change";
        return { branchDiff, diffStat, changedFiles, diffTruncated, toRef, commitSha, providerCommitted, changeOutcome };
      },
      (result) => ({
        diff_base_ref: diffBaseRef,
        changed_file_count: result.changedFiles.length,
        diff_chars: result.branchDiff.length,
        diff_truncated: result.diffTruncated,
        provider_committed: result.providerCommitted,
        change_outcome: result.changeOutcome
      })
    );
  }

  private async collectReviewDiff(task: Task, workspacePath: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string | null> {
    if (task.repoDefaultBranch === task.baseBranch) {
      const diff = await this.gitCommandCapture(["-C", workspacePath, "diff", `origin/${task.repoDefaultBranch}...HEAD`], githubToken, gitUsername).catch(() => "");
      return diff.trim() || null;
    }

    const diff = await this.gitCommandCapture(["-C", workspacePath, "diff", `origin/${task.repoDefaultBranch}...HEAD`], githubToken, gitUsername).catch(() => "");
    return diff.trim() || null;
  }

  private isCancellationRequested(taskId: string): boolean {
    return this.cancelRequestedTaskIds.has(taskId);
  }

  private async collectDiffRangeVersusHead(
    workspacePath: string,
    fromRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ diff: string; diffStat: string; changedFiles: string[]; diffTruncated: boolean; toRef: string }> {
    const toRef = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername)).trim();
    let diff = await this.gitCommandCapture(["-C", workspacePath, "diff", `${fromRef}..${toRef}`], githubToken, gitUsername);
    let diffStat = await this.gitCommandCapture(["-C", workspacePath, "diff", `${fromRef}..${toRef}`, "--stat"], githubToken, gitUsername);
    const namesRaw = await this.gitCommandCapture(["-C", workspacePath, "diff", `${fromRef}..${toRef}`, "--name-only"], githubToken, gitUsername);
    const changedFiles = namesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let diffTruncated = false;
    if (diff.length > SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS) {
      diff = `${diff.slice(0, SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS)}\n\n… (diff truncated for preview)`;
      diffTruncated = true;
    }
    if (diffStat.length > SpawnerService.CHANGE_PROPOSAL_STAT_MAX_CHARS) {
      diffStat = `${diffStat.slice(0, SpawnerService.CHANGE_PROPOSAL_STAT_MAX_CHARS)}\n… (stat truncated)`;
    }
    return {
      diff: diff.trim() || "(no changes)",
      diffStat: diffStat.trim() || "—",
      changedFiles,
      diffTruncated,
      toRef
    };
  }

  private async collectWorkingTreeDiffSinceRef(
    workspacePath: string,
    fromRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ diff: string; diffStat: string; changedFiles: string[]; diffTruncated: boolean; toRef: string }> {
    const toRef = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername)).trim();
    let workingDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", fromRef], githubToken, gitUsername);
    const untrackedDiff = await this.collectUntrackedFileDiff(workspacePath, githubToken, gitUsername);
    let diff = [workingDiff, untrackedDiff].filter((chunk) => chunk.trim().length > 0).join("\n").trim();
    let diffStat = await this.gitCommandCapture(["-C", workspacePath, "diff", fromRef, "--stat"], githubToken, gitUsername);
    if (untrackedDiff.trim().length > 0) {
      diffStat = [diffStat.trim(), "(untracked files included in diff)"].filter(Boolean).join("\n");
    }
    const namesFromDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", fromRef, "--name-only"], githubToken, gitUsername);
    const untrackedNames = await this.gitCommandCaptureRaw(
      ["-C", workspacePath, "ls-files", "--others", "--exclude-standard", "-z"],
      githubToken,
      gitUsername
    );
    const untrackedList = untrackedNames.split("\0").filter((line) => line.length > 0);
    const changedFiles = [...new Set([...namesFromDiff.split("\n").map((l) => l.trim()).filter(Boolean), ...untrackedList])];
    let diffTruncated = false;
    if (diff.length > SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS) {
      diff = `${diff.slice(0, SpawnerService.CHANGE_PROPOSAL_DIFF_MAX_CHARS)}\n\n… (diff truncated for preview)`;
      diffTruncated = true;
    }
    if (diffStat.length > SpawnerService.CHANGE_PROPOSAL_STAT_MAX_CHARS) {
      diffStat = `${diffStat.slice(0, SpawnerService.CHANGE_PROPOSAL_STAT_MAX_CHARS)}\n… (stat truncated)`;
    }
    return {
      diff: diff.trim() || "(no changes)",
      diffStat: diffStat.trim() || "—",
      changedFiles,
      diffTruncated,
      toRef
    };
  }

  async refreshPendingChangeProposalPreview(task: Task): Promise<TaskChangeProposal | null> {
    const proposals = await this.taskStore.listChangeProposals(task.id);
    const proposal = proposals.find((item) => item.status === "pending") ?? null;
    if (!proposal) {
      return null;
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return null;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;
    const { diff, diffStat, changedFiles, diffTruncated, toRef } = await this.collectWorkingTreeDiffSinceRef(
      workspacePath,
      proposal.fromRef,
      githubToken,
      gitUsername
    );

    return this.taskStore.updateChangeProposalStatus(proposal.id, "pending", task.id, {
      toRef,
      diff,
      diffStat,
      changedFiles,
      diffTruncated
    });
  }

  async createBuildRunChangeProposal(
    task: Task,
    runId: string,
    workspacePath: string,
    precomputed?:
      | {
          fromRef: string;
          diff: string;
          diffStat: string;
          changedFiles: string[];
          diffTruncated: boolean;
          toRef: string;
          alreadyApplied?: boolean;
        }
      | undefined
  ): Promise<TaskChangeProposal | null> {
    const run = await this.taskStore.getRun(runId);
    if (!run || run.taskId !== task.id) {
      return null;
    }
    const fromRef = run.changeProposalCheckpointRef?.trim();
    if (!fromRef) {
      return null;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return null;
    }

    const { diff, diffStat, changedFiles, diffTruncated, toRef } =
      precomputed && precomputed.fromRef === fromRef
        ? precomputed
        : await this.collectWorkingTreeDiffSinceRef(workspacePath, fromRef, githubToken, gitUsername);

    if (changedFiles.length === 0) {
      await this.taskStore.appendLog(task.id, `Build run ${runId}: no changes since checkpoint; checkpoint not created.`);
      return null;
    }

    const createdAt = new Date().toISOString();
    const untrackedPathsAtCheckpoint = Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : [];

    const proposal = await this.taskStore.createChangeProposal({
      id: nanoid(),
      taskId: task.id,
      sourceType: "build_run",
      sourceId: runId,
      status: precomputed?.alreadyApplied ? "applied" : task.autoApplyCheckpoints ? "applying" : "pending",
      fromRef,
      toRef,
      diff,
      diffStat,
      changedFiles,
      diffTruncated,
      untrackedPathsAtCheckpoint,
      createdAt
    });

    if (!proposal) {
      await this.taskStore.appendLog(
        task.id,
        "Checkpoint for this build could not be created because another pending checkpoint already exists."
      );
    } else if (proposal.status === "applied") {
      await this.taskStore.appendLog(
        task.id,
        `Checkpoint ${proposal.id}: marked applied because the agent already created local commit ${toRef.slice(0, 7)}.`
      );
    }

    return proposal ?? null;
  }

  private async syncTaskReviewStatus(taskId: string): Promise<Task | null> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return null;
    }

    return this.taskStore.patchTask(task.id, {
      hasPendingCheckpoint: task.hasPendingCheckpoint
    });
  }

  async beginInteractiveTerminalSession(taskId: string, mode: TaskTerminalSessionMode = "terminal"): Promise<{ sessionId: string }> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (task.status === "archived") {
      throw new Error("Archived tasks are read-only.");
    }
    if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
      throw new Error("Terminal unavailable while the task is queued or running. Finish or cancel that run first (one action at a time).");
    }
    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      throw new Error("Apply or reject the pending checkpoint before opening a terminal.");
    }
    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      throw new Error("A terminal session is already active for this task.");
    }

    const workspacePath = this.resolveWorkspacePath(taskId);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      throw new Error("No workspace folder on disk for this task yet.");
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const checkpointRef = (
      await this.gitCommandCapture(
        ["-C", workspacePath, "rev-parse", "HEAD"],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      )
    ).trim();

    const untrackedPathsAtCheckpoint = await this.listUntrackedRelativePaths(
      workspacePath,
      runtimeCredentials.githubToken,
      runtimeCredentials.gitUsername
    );

    const sessionId = nanoid();
    const startedAt = new Date().toISOString();
    await this.taskStore.setActiveInteractiveSession(taskId, {
      sessionId,
      checkpointRef,
      startedAt,
      untrackedPathsAtCheckpoint,
      mode
    });
    await this.taskStore.appendMessage(taskId, {
      role: "system",
      content: getTaskTerminalSessionStartMessage(mode),
      sessionId
    });
    return { sessionId };
  }

  async endInteractiveTerminalSession(taskId: string, sessionId: string): Promise<void> {
    const active = await this.taskStore.getActiveInteractiveSession(taskId);
    if (!active || active.sessionId !== sessionId) {
      return;
    }

    await this.taskStore.clearActiveInteractiveSession(taskId);

    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      return;
    }

    const workspacePath = this.resolveWorkspacePath(taskId);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await this.taskStore.appendMessage(taskId, {
        role: "system",
        content: getTaskTerminalSessionEndMessage(active.mode),
        sessionId
      });
      return;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;
    const { diff, diffStat, changedFiles, diffTruncated, toRef } = await this.collectWorkingTreeDiffSinceRef(
      workspacePath,
      active.checkpointRef,
      githubToken,
      gitUsername
    );

    if (changedFiles.length === 0) {
      await this.taskStore.appendMessage(taskId, {
        role: "system",
        content: getTaskTerminalSessionNoChangesMessage(active.mode),
        sessionId
      });
      await this.taskStore.appendLog(taskId, "Terminal session ended with no workspace changes; checkpoint not created.");
      return;
    }

    await this.taskStore.appendMessage(taskId, {
      role: "system",
      content: getTaskTerminalSessionReviewMessage(active.mode),
      sessionId
    });

      const proposal = await this.taskStore.createChangeProposal({
        id: nanoid(),
        taskId,
        sourceType: "interactive_session",
      sourceId: sessionId,
      status: task.autoApplyCheckpoints ? "applying" : "pending",
      fromRef: active.checkpointRef,
      toRef,
      diff,
      diffStat,
      changedFiles,
      diffTruncated,
      untrackedPathsAtCheckpoint: active.untrackedPathsAtCheckpoint,
      createdAt: new Date().toISOString()
    });

    if (!proposal) {
      await this.taskStore.appendLog(
        taskId,
        "Checkpoint for this terminal session could not be created because another pending checkpoint already exists."
      );
      return;
    }

    if (task.autoApplyCheckpoints) {
      await this.autoApplyCheckpointIfEnabled(taskId, proposal.id);
    }

    await this.syncTaskReviewStatus(taskId);
  }

  /**
   * After a terminal session, changes are only in the working tree.
   * On apply, mirror {@link finalizeBuild}: strip workspace scratch paths, stage all, and commit when needed.
   */
  private async commitWorkspaceAfterCheckpointApply(
    task: Task,
    workspacePath: string,
    customCommitMessage?: string | null,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ didCommit: boolean }> {
    await this.stripEphemeralWorkspaceFiles(workspacePath);
    await this.gitCommand(["-C", workspacePath, "add", "-A"], githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], githubToken, gitUsername);
      return { didCommit: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
    }

    const subject = customCommitMessage?.trim()
      ? this.toCommitSubject(customCommitMessage)
      : await this.buildGeneratedCommitSubject(task, workspacePath, githubToken, gitUsername);
    await this.commitWorkspaceChanges(task, workspacePath, subject, githubToken, gitUsername);
    return { didCommit: true };
  }

  /**
   * After a checkpoint revert (patch or ref restore), stage the repo and create a commit so HEAD matches the
   * reverted tree — avoids leaving unstaged changes on the branch.
   */
  private async commitWorkspaceAfterCheckpointRevert(
    task: Task,
    workspacePath: string,
    proposalId: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ didCommit: boolean }> {
    await this.stripEphemeralWorkspaceFiles(workspacePath);
    await this.gitCommand(["-C", workspacePath, "add", "-A"], githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], githubToken, gitUsername);
      return { didCommit: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
    }

    const shortId = proposalId.slice(0, 8);
    const subject = this.toCommitSubject(`revert(checkpoint): undo checkpoint ${shortId}`);
    await this.commitWorkspaceChanges(task, workspacePath, subject, githubToken, gitUsername);
    return { didCommit: true };
  }

  /** After re-applying a reverted checkpoint, stage and commit so the branch stays clean (same pattern as revert). */
  private async commitWorkspaceAfterCheckpointReapply(
    task: Task,
    workspacePath: string,
    proposalId: string,
    customCommitMessage?: string | null,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ didCommit: boolean }> {
    await this.stripEphemeralWorkspaceFiles(workspacePath);
    await this.gitCommand(["-C", workspacePath, "add", "-A"], githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], githubToken, gitUsername);
      return { didCommit: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
    }

    const shortId = proposalId.slice(0, 8);
    const subject = customCommitMessage?.trim()
      ? this.toCommitSubject(customCommitMessage)
      : this.toCommitSubject(`chore(checkpoint): reapply checkpoint ${shortId}`);
    await this.commitWorkspaceChanges(task, workspacePath, subject, githubToken, gitUsername);
    return { didCommit: true };
  }

  /**
   * After re-apply, either we created a commit or the tree already matched HEAD. If there is still a diff vs HEAD,
   * refuse to mark applied (avoids silent dirty workspaces).
   */
  private async assertReapplyWorkspaceCleanOrCommitted(
    workspacePath: string,
    didCommit: boolean,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (didCommit) {
      return { ok: true };
    }
    try {
      await this.gitCommand(["-C", workspacePath, "diff", "HEAD", "--quiet"], githubToken, gitUsername);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
      return {
        ok: false,
        message:
          "Re-apply left the branch dirty (uncommitted changes vs HEAD). Checkpoint not marked applied; fix git state or try again."
      };
    }
  }

  async applyChangeProposal(
    task: Task,
    proposalId: string,
    options?: { commitMessage?: string | null; allowDuringExecution?: boolean }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    const checkpointBlocked =
      !options?.allowDuringExecution &&
      (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running")
        ? "Checkpoint actions are unavailable while task execution is queued or running."
        : null;
    if (checkpointBlocked) {
      return { ok: false, message: checkpointBlocked };
    }
    if (proposal.status !== "pending" && proposal.status !== "applying" && proposal.status !== "reverted") {
      return { ok: false, message: "Checkpoint must be pending, applying, or reverted to apply." };
    }

    const isReapply = proposal.status === "reverted";
    if (isReapply) {
      if (proposal.diffTruncated) {
        return { ok: false, message: "Cannot re-apply: diff was truncated when the checkpoint was saved." };
      }
      const diffBody = proposal.diff.trim();
      if (!diffBody || diffBody === "(no changes)") {
        return { ok: false, message: "Cannot re-apply: no stored diff." };
      }
      const workspacePath = this.resolveWorkspacePath(task.id);
      const workspaceExists = await access(workspacePath)
        .then(() => true)
        .catch(() => false);
      if (!workspaceExists) {
        return { ok: false, message: "No local workspace exists for this task." };
      }
      const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
      const { githubToken, gitUsername } = runtimeCredentials;
      try {
        await this.reapplyRevertedCheckpointToWorkspace(proposal, workspacePath, githubToken, gitUsername);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ok: false, message: `Could not re-apply checkpoint: ${detail}` };
      }
    }

    if (proposal.sourceType === "interactive_session" || proposal.sourceType === "build_run") {
      const workspacePath = this.resolveWorkspacePath(task.id);
      const workspaceExists = await access(workspacePath)
        .then(() => true)
        .catch(() => false);
      if (!workspaceExists) {
        return { ok: false, message: "No local workspace exists for this task." };
      }
      const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
      const { githubToken, gitUsername } = runtimeCredentials;
      try {
        const { didCommit } = isReapply
          ? await this.commitWorkspaceAfterCheckpointReapply(
              task,
              workspacePath,
              proposalId,
              options?.commitMessage ?? null,
              githubToken,
              gitUsername
            )
          : await this.commitWorkspaceAfterCheckpointApply(
              task,
              workspacePath,
              options?.commitMessage ?? null,
              githubToken,
              gitUsername
            );
        if (isReapply) {
          const clean = await this.assertReapplyWorkspaceCleanOrCommitted(
            workspacePath,
            didCommit,
            githubToken,
            gitUsername
          );
          if (!clean.ok) {
            return { ok: false, message: clean.message };
          }
        }
        const appliedHeadRef = (
          await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername)
        ).trim();
        await this.taskStore.updateChangeProposalStatus(proposalId, "applied", task.id, {
          toRef: appliedHeadRef || proposal.toRef
        });
        await this.syncTaskReviewStatus(task.id);
        await this.taskStore.appendLog(
          task.id,
          isReapply
            ? didCommit
              ? `Checkpoint ${proposalId} re-applied; committed for a clean branch.`
              : `Checkpoint ${proposalId} re-applied; tree already matched HEAD after staging.`
            : didCommit
              ? `Checkpoint ${proposalId} applied; created local commit.`
              : `Checkpoint ${proposalId} applied; nothing new to commit (tree already matched HEAD after staging).`
        );
        return { ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          message: `Could not commit workspace when applying checkpoint: ${detail}${isReapply ? " Checkpoint not marked applied." : ""}`
        };
      }
    }

    return { ok: false, message: "Unsupported checkpoint source." };
  }

  /** Alias for `applyChangeProposal` (same HTTP route kept for compatibility). */
  async acceptChangeProposal(
    task: Task,
    proposalId: string,
    options?: { commitMessage?: string | null }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.applyChangeProposal(task, proposalId, options);
  }

  private safeSortedCheckpointPaths(changedFiles: string[]): string[] {
    const unique = [
      ...new Set(
        changedFiles
          .map((p) => p.replace(/\\/g, "/").trim())
          .filter((rel) => rel.length > 0 && !path.isAbsolute(rel) && !rel.split("/").some((s) => s === ".."))
      )
    ];
    unique.sort((a, b) => b.length - a.length);
    return unique;
  }

  /**
   * When `git apply -R` fails (tree moved on since the patch was saved), restore each path from `fromRef`.
   * Matches reject semantics for “new” paths: removes files that did not exist at `fromRef`.
   */
  private async revertCheckpointPathsFromRef(
    workspacePath: string,
    fromRef: string,
    changedFiles: string[],
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", fromRef], githubToken, gitUsername);

    const unique = this.safeSortedCheckpointPaths(changedFiles);
    if (unique.length === 0) {
      throw new Error("Checkpoint has no safe paths to restore from the base ref.");
    }

    const pathsPresentAtBase: string[] = [];
    const pathsMissingAtBase: string[] = [];

    for (const rel of unique) {
      try {
        await this.gitCommandCapture(["-C", workspacePath, "cat-file", "-e", `${fromRef}:${rel}`], githubToken, gitUsername);
        pathsPresentAtBase.push(rel);
      } catch {
        pathsMissingAtBase.push(rel);
      }
    }

    if (pathsPresentAtBase.length > 0) {
      try {
        await this.gitCommand(
          ["-C", workspacePath, "restore", `--source=${fromRef}`, "--worktree", "--", ...pathsPresentAtBase],
          githubToken,
          gitUsername
        );
      } catch {
        await this.gitCommand(["-C", workspacePath, "checkout", fromRef, "--", ...pathsPresentAtBase], githubToken, gitUsername);
        await this.gitCommand(["-C", workspacePath, "reset", "HEAD", "--", ...pathsPresentAtBase], githubToken, gitUsername);
      }
    }

    for (const rel of pathsMissingAtBase) {
      const fullPath = resolveSafeWorkspaceFilePath(workspacePath, rel);
      if (fullPath) {
        await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Opposite of {@link revertCheckpointPathsFromRef}: bring paths back to `toRef` (checkpoint “after” state). */
  private async reapplyCheckpointPathsFromToRef(
    workspacePath: string,
    toRef: string,
    changedFiles: string[],
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", toRef], githubToken, gitUsername);

    const unique = this.safeSortedCheckpointPaths(changedFiles);
    if (unique.length === 0) {
      throw new Error("Checkpoint has no safe paths to restore from the end ref.");
    }

    try {
      await this.gitCommand(
        ["-C", workspacePath, "restore", `--source=${toRef}`, "--worktree", "--", ...unique],
        githubToken,
        gitUsername
      );
    } catch {
      await this.gitCommand(["-C", workspacePath, "checkout", toRef, "--", ...unique], githubToken, gitUsername);
      await this.gitCommand(["-C", workspacePath, "reset", "HEAD", "--", ...unique], githubToken, gitUsername);
    }
  }

  /**
   * Re-apply a reverted checkpoint: try forward `git apply` of the saved diff, else restore paths from `toRef`.
   */
  private async reapplyRevertedCheckpointToWorkspace(
    proposal: TaskChangeProposal,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<void> {
    const diffBody = proposal.diff.trim();
    let patchDir: string | null = null;
    try {
      patchDir = await mkdtemp(path.join(tmpdir(), "agentswarm-reapply-"));
      const patchPath = path.join(patchDir, "checkpoint.patch");
      await writeFile(patchPath, `${diffBody}\n`, "utf8");
      await this.gitCommand(["-C", workspacePath, "apply", "--check", patchPath], githubToken, gitUsername);
      await this.gitCommand(["-C", workspacePath, "apply", patchPath], githubToken, gitUsername);
    } catch {
      await this.reapplyCheckpointPathsFromToRef(
        workspacePath,
        proposal.toRef,
        proposal.changedFiles,
        githubToken,
        gitUsername
      );
    } finally {
      if (patchDir) {
        await rm(patchDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async revertPendingChangeProposalFile(
    task: Task,
    proposalId: string,
    filePath: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    const checkpointBlocked =
      task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running"
        ? "Checkpoint actions are unavailable while task execution is queued or running."
        : null;
    if (checkpointBlocked) {
      return { ok: false, message: checkpointBlocked };
    }
    if (proposal.status !== "pending") {
      return { ok: false, message: "Only a pending checkpoint supports file-level revert." };
    }

    const target = this.safeSortedCheckpointPaths([filePath])[0] ?? null;
    if (!target) {
      return { ok: false, message: "Invalid file path." };
    }

    const allowedPaths = new Set(this.safeSortedCheckpointPaths(proposal.changedFiles));
    if (!allowedPaths.has(target)) {
      return { ok: false, message: "File is not part of this checkpoint diff." };
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      return { ok: false, message: "No local workspace exists for this task." };
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;
    try {
      await this.revertCheckpointPathsFromRef(workspacePath, proposal.fromRef, [target], githubToken, gitUsername);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Could not revert file from checkpoint base: ${detail}` };
    }

    const refreshed = await this.refreshPendingChangeProposalPreview(task);
    if (refreshed && refreshed.id === proposalId && refreshed.changedFiles.length === 0) {
      await this.taskStore.updateChangeProposalStatus(proposalId, "rejected", task.id, {
        toRef: proposal.fromRef,
        diff: "(no changes)",
        diffStat: "—",
        changedFiles: [],
        diffTruncated: false
      });
      await this.syncTaskReviewStatus(task.id);
      await this.taskStore.appendLog(task.id, `Checkpoint ${proposalId}: reverted ${target}; no files remain, checkpoint rejected.`);
      return { ok: true };
    }

    await this.syncTaskReviewStatus(task.id);
    await this.taskStore.appendLog(task.id, `Checkpoint ${proposalId}: reverted file ${target} to checkpoint base.`);
    return { ok: true };
  }

  async revertChangeProposal(task: Task, proposalId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    const checkpointBlocked =
      task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running"
        ? "Checkpoint actions are unavailable while task execution is queued or running."
        : null;
    if (checkpointBlocked) {
      return { ok: false, message: checkpointBlocked };
    }
    if (proposal.status !== "applied") {
      return { ok: false, message: "Only an applied checkpoint can be reverted." };
    }
    const latestAppliedId = await this.taskStore.getLatestAppliedChangeProposalId(task.id);
    if (latestAppliedId !== proposalId) {
      return {
        ok: false,
        message: "Revert checkpoints in order: undo the most recently applied checkpoint first."
      };
    }
    if (proposal.diffTruncated) {
      return { ok: false, message: "Cannot revert: diff was truncated when the checkpoint was saved." };
    }
    const diffBody = proposal.diff.trim();
    if (!diffBody || diffBody === "(no changes)") {
      return { ok: false, message: "Cannot revert: no patch was stored for this checkpoint." };
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      return { ok: false, message: "No local workspace exists for this task." };
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;

    let usedPatchReverse = false;
    let patchError: string | null = null;
    let patchDir: string | null = null;
    try {
      patchDir = await mkdtemp(path.join(tmpdir(), "agentswarm-revert-"));
      const patchPath = path.join(patchDir, "checkpoint.patch");
      await writeFile(patchPath, `${diffBody}\n`, "utf8");
      await this.gitCommand(["-C", workspacePath, "apply", "--check", patchPath], githubToken, gitUsername);
      await this.gitCommand(["-C", workspacePath, "apply", "-R", patchPath], githubToken, gitUsername);
      usedPatchReverse = true;
    } catch (err) {
      patchError = err instanceof Error ? err.message : String(err);
      try {
        await this.revertCheckpointPathsFromRef(
          workspacePath,
          proposal.fromRef,
          proposal.changedFiles,
          githubToken,
          gitUsername
        );
      } catch (fallbackErr) {
        const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        return {
          ok: false,
          message: `Revert failed: ${patchError}. Restoring files from checkpoint base also failed: ${fb}`
        };
      }
    } finally {
      if (patchDir) {
        await rm(patchDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    try {
      const { didCommit } = await this.commitWorkspaceAfterCheckpointRevert(
        task,
        workspacePath,
        proposalId,
        githubToken,
        gitUsername
      );
      const updated = await this.taskStore.markCheckpointReverted(proposalId, task.id);
      if (!updated) {
        return { ok: false, message: "Could not record revert in store." };
      }
      await this.syncTaskReviewStatus(task.id);
      const how = usedPatchReverse
        ? "stored diff"
        : `restored ${proposal.changedFiles.length} path(s) from checkpoint base`;
      await this.taskStore.appendLog(
        task.id,
        didCommit
          ? `Checkpoint ${proposalId} reverted (${how}); committed so the branch has no unstaged revert changes.`
          : `Checkpoint ${proposalId} reverted (${how}); index already matched HEAD after staging (no new commit).`
      );
      return { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Revert updated the working tree but committing a clean snapshot failed: ${detail}. Checkpoint was not marked reverted; fix git state or retry.`
      };
    }
  }

  async rejectChangeProposal(task: Task, proposalId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    if (proposal.status !== "pending") {
      return { ok: false, message: "Proposal is not pending." };
    }
    const checkpointBlocked =
      task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running"
        ? "Checkpoint actions are unavailable while task execution is queued or running."
        : null;
    if (checkpointBlocked) {
      return { ok: false, message: checkpointBlocked };
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!workspaceExists) {
      return { ok: false, message: "No local workspace exists for this task." };
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;

    await this.gitCommand(["-C", workspacePath, "reset", "--hard", proposal.fromRef], githubToken, gitUsername);

    const beforeUntracked = new Set(proposal.untrackedPathsAtCheckpoint ?? []);
    const currentUntracked = await this.listUntrackedRelativePaths(workspacePath, githubToken, gitUsername);
    const toRemove = currentUntracked.filter((rel) => !beforeUntracked.has(rel));
    toRemove.sort((a, b) => b.length - a.length);
    for (const rel of toRemove) {
      const fullPath = resolveSafeWorkspaceFilePath(workspacePath, rel);
      if (fullPath) {
        await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    await this.taskStore.updateChangeProposalStatus(proposalId, "rejected", task.id);
    await this.syncTaskReviewStatus(task.id);
    await this.taskStore.appendLog(
      task.id,
      `Checkpoint ${proposalId} rejected; reset to ${proposal.fromRef.slice(0, 7)}… and removed ${toRemove.length} new untracked path(s).`
    );
    return { ok: true };
  }

  async cancelTask(taskId: string): Promise<boolean> {
    this.cancelRequestedTaskIds.add(taskId);

    const executions = [...(this.activeExecutions.get(taskId)?.values() ?? [])];
    if (executions.length === 0) {
      return true;
    }

    for (const execution of executions) {
      await this.taskStore.appendLog(taskId, `Spawner: stopping ${execution.label} (graceful shutdown).`);

      if (execution.containerName) {
        try {
          await this.runCommand("docker", ["stop", "-t", "15", execution.containerName]);
        } catch {
          // Container may already be gone or stop may fail; force remove below.
        }

        try {
          await this.runCommand("docker", ["rm", "-f", execution.containerName]);
          continue;
        } catch {
          // Fall through to direct process kill below.
        }
      }

      try {
        execution.process.kill("SIGTERM");
      } catch {
        try {
          execution.process.kill("SIGKILL");
        } catch {
          // Ignore process kill errors.
        }
      }
    }

    return true;
  }

  async cleanupTaskArtifacts(task: Task): Promise<void> {
    const payloadDir = this.resolveRuntimePayloadDir(task.id);
    const workspacePath = this.resolveWorkspacePath(task.id);
    const promptAttachmentRoot = resolveTaskPromptAttachmentRoot(task.id);
    const taskStateRootPath = resolveTaskStateRootPaths(task.id).serverPath;
    const legacyCodexStatePath = resolveTaskProviderStatePaths(task.id, "codex").legacyServerPath;
    const legacyClaudeStatePath = resolveTaskProviderStatePaths(task.id, "claude").legacyServerPath;
    await rm(payloadDir, { recursive: true, force: true });
    await rm(promptAttachmentRoot, { recursive: true, force: true }).catch(() => undefined);
    const repoCachePath = this.resolveRepoCachePath(task);
    await this.withRepoLock(repoCachePath, async () => {
      const repoExists = await access(path.join(repoCachePath, ".git"))
        .then(() => true)
        .catch(() => false);
      if (repoExists) {
        await this.removeWorkspaceFromManagedRepo(repoCachePath, workspacePath);
      }
    });
    await rm(workspacePath, { recursive: true, force: true });
    await rm(taskStateRootPath, { recursive: true, force: true });
    await rm(legacyCodexStatePath, { recursive: true, force: true });
    await rm(legacyClaudeStatePath, { recursive: true, force: true });
  }

  async pullTaskBranch(task: Task): Promise<Task> {
    return this.withTrackedTaskGitOperation(task, "pull_task_branch", async () => this.pullTaskBranchCore(task));
  }

  private async pullTaskBranchCore(task: Task): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for pulling");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before pulling.");
    }

    await this.taskStore.appendLog(task.id, `Spawner: pulling remote changes into ${branchName}.`);

    if (await this.localBranchExists(workspacePath, branchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "checkout", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    }

    await this.refreshWorkspaceRemoteState(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "pull");

    const remoteRef = `origin/${branchName}`;
    if (!(await this.refExists(workspacePath, remoteRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      throw new Error(`Remote branch ${branchName} does not exist yet. Push it first before pulling.`);
    }

    if (!(await this.localBranchExists(workspacePath, branchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, remoteRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    }

    await this.gitCommand(["-C", workspacePath, "add", "-A"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    let createdLocalCommit = false;
    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }

      const generatedSubject = await this.buildGeneratedCommitSubject(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.commitWorkspaceChanges(
        task,
        workspacePath,
        generatedSubject,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      createdLocalCommit = true;
    }

    if (createdLocalCommit) {
      await this.taskStore.appendLog(task.id, "Spawner: created a local commit from workspace changes before pulling.");
    }

    await this.refreshWorkspaceRemoteState(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "pull");
    await this.gitCommand(["-C", workspacePath, "rebase", remoteRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername, task).catch(
      async (error) => {
        await this.gitCommand(["-C", workspacePath, "rebase", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername, task).catch(
          () => undefined
        );
        throw error;
      }
    );

    await this.taskStore.appendLog(task.id, `Spawner: pulled remote branch ${branchName} into the local workspace.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async pushTaskBranch(task: Task, options?: { commitMessage?: string | null }): Promise<Task> {
    return this.withTrackedTaskGitOperation(task, "push_task_branch", async () => this.pushTaskBranchCore(task, options));
  }

  async resetTaskBranchLocalState(task: Task): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for reset");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before resetting.");
    }

    const { githubToken, gitUsername } = runtimeCredentials;
    await this.taskStore.appendLog(task.id, `Spawner: resetting local Git state for ${branchName}.`);
    await this.refreshWorkspaceRemoteState(task, workspacePath, githubToken, gitUsername, "pull").catch(() => undefined);

    const remoteRef = `origin/${branchName}`;
    const remoteExists = await this.refExists(workspacePath, remoteRef, githubToken, gitUsername);
    const fallbackBaseRef = task.workspaceBaseRef?.trim() || null;
    const fallbackRemoteBaseRef =
      !remoteExists && task.baseBranch && task.baseBranch !== branchName && (await this.refExists(workspacePath, `origin/${task.baseBranch}`, githubToken, gitUsername))
        ? `origin/${task.baseBranch}`
        : null;
    const resetTarget = remoteExists ? remoteRef : fallbackBaseRef ?? fallbackRemoteBaseRef;

    if (!resetTarget) {
      throw new Error("No remote branch or saved base ref is available for reset.");
    }

    if (await this.localBranchExists(workspacePath, branchName, githubToken, gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "checkout", branchName], githubToken, gitUsername);
    }

    await this.gitCommand(["-C", workspacePath, "reset", "--hard", resetTarget], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "clean", "-fd"], githubToken, gitUsername);

    await this.appendGitActivityMessage(
      task.id,
      remoteExists
        ? `Local Git state reset to ${remoteRef}.`
        : `Local Git state reset to ${resetTarget}.`
    );
    await this.taskStore.appendLog(
      task.id,
      remoteExists
        ? `Spawner: reset local branch ${branchName} to ${remoteRef}.`
        : `Spawner: reset local branch ${branchName} to ${resetTarget}.`
    );

    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async revertTaskCommit(task: Task, commitSha: string): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for revert");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before reverting.");
    }

    const { githubToken, gitUsername } = runtimeCredentials;
    const subject = await this.getCommitSubject(workspacePath, commitSha, githubToken, gitUsername).catch(() => "");
    await this.gitCommand(["-C", workspacePath, "revert", "--no-edit", commitSha], githubToken, gitUsername, task);
    const revertSha = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername)).trim();
    const revertSubject = await this.getCommitSubject(workspacePath, revertSha, githubToken, gitUsername).catch(() => "");
    await this.appendGitActivityMessage(
      task.id,
      `Reverted commit ${commitSha.slice(0, 7)}${subject ? `: ${subject}` : ""}${revertSubject ? ` with ${revertSha.slice(0, 7)}: ${revertSubject}` : "."}`
    );
    await this.taskStore.appendLog(task.id, `Spawner: reverted commit ${commitSha.slice(0, 7)} on ${branchName}.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async resetTaskBranchToCommit(task: Task, commitSha: string): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for reset");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before resetting.");
    }

    const { githubToken, gitUsername } = runtimeCredentials;
    const unpushedShas = await this.getUnpushedCommitShas(workspacePath, branchName, task.baseBranch, githubToken, gitUsername);
    if (!unpushedShas.has(commitSha)) {
      throw new Error("Only local-only commits can be used as a reset target.");
    }

    const subject = await this.getCommitSubject(workspacePath, commitSha, githubToken, gitUsername).catch(() => "");
    await this.gitCommand(["-C", workspacePath, "reset", "--hard", commitSha], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "clean", "-fd"], githubToken, gitUsername);
    await this.appendGitActivityMessage(
      task.id,
      `Reset local branch ${branchName} to commit ${commitSha.slice(0, 7)}${subject ? `: ${subject}` : ""}`
    );
    await this.taskStore.appendLog(task.id, `Spawner: reset local branch ${branchName} to commit ${commitSha.slice(0, 7)}.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  private async pushTaskBranchCore(task: Task, options?: { commitMessage?: string | null }): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchStrategy === "work_on_branch" ? task.baseBranch : task.branchName;
    if (!branchName) {
      throw new Error("No target branch available for publishing");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error("No local workspace exists for this task. Build it again before pushing.");
    }

    await this.taskStore.appendLog(task.id, `Spawner: pushing local commits from ${branchName}.`);

    await this.gitCommand(["-C", workspacePath, "add", "-A"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    let createdLocalCommit = false;
    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }

      const custom = options?.commitMessage?.trim();
      const subject =
        custom && custom.length > 0
          ? this.toCommitSubject(custom)
          : await this.buildGeneratedCommitSubject(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.commitWorkspaceChanges(task, workspacePath, subject, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      createdLocalCommit = true;
    }

    if (createdLocalCommit) {
      const commitSha = (await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername)).trim();
      const commitSubject = await this.getCommitSubject(workspacePath, commitSha, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.appendGitActivityMessage(task.id, `Local commit created ${commitSha.slice(0, 7)}: ${commitSubject}`);
      await this.taskStore.appendLog(task.id, "Spawner: created a local commit from workspace changes before pushing.");
    } else {
      const unpushedSubjects = await this.getUnpushedCommitSubjects(
        workspacePath,
        branchName,
        task.baseBranch,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      if (unpushedSubjects.length > 0) {
        const preview = unpushedSubjects.slice(0, 3).map((subject) => `"${subject}"`).join(", ");
        const extra = unpushedSubjects.length > 3 ? ` (+${unpushedSubjects.length - 3} more)` : "";
        await this.taskStore.appendLog(
          task.id,
          `Spawner: no new uncommitted changes; pushing ${unpushedSubjects.length} unpushed commit(s): ${preview}${extra}.`
        );
      }
    }

    try {
      await this.gitCommand(["-C", workspacePath, "push", "--no-verify", "-u", "origin", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } catch {
      await this.refreshWorkspaceRemoteState(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "push").catch(
        () => undefined
      );
      try {
        await this.gitCommandCapture(
          ["-C", workspacePath, "rev-parse", "--verify", `origin/${branchName}`],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        await this.gitCommand(["-C", workspacePath, "rebase", `origin/${branchName}`], runtimeCredentials.githubToken, runtimeCredentials.gitUsername, task).catch(
          async (error) => {
            await this.gitCommand(["-C", workspacePath, "rebase", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername, task).catch(
              () => undefined
            );
            throw error;
          }
        );
      } catch {
        // origin/<branch> may not exist yet; ignore.
      }
      await this.gitCommand(["-C", workspacePath, "push", "--no-verify", "-u", "origin", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    }

    await this.taskStore.appendLog(task.id, `Spawner: pushed local branch ${branchName} to origin.`);
    await this.appendGitActivityMessage(task.id, `Pushed branch ${branchName} to origin.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async getTaskMergePreview(task: Task, targetBranch: string): Promise<TaskMergePreview> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const sourceBranch = task.branchName;
    const normalizedTargetBranch = targetBranch.trim();

    if (task.branchStrategy !== "feature_branch") {
      throw new Error("Only feature-branch tasks have a mergeable branch");
    }

    if (!sourceBranch) {
      throw new Error("Task branch is not available for merging");
    }

    if (!normalizedTargetBranch) {
      throw new Error("Target branch is required");
    }

    if (normalizedTargetBranch === sourceBranch) {
      const suggestedCommitMessage = this.buildGeneratedCommitSubjectFromFiles(task, []);
      return {
        sourceBranch,
        targetBranch: normalizedTargetBranch,
        mergeable: false,
        message: "Select a target branch other than the task branch.",
        suggestedCommitMessage
      };
    }

    const repoCachePath = this.resolveRepoCachePath(task);
    return this.withFreshManagedRepo(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "merge_preview", async (managedRepoPath) => {
      const sourceRef = `origin/${sourceBranch}`;
      const targetRef = `origin/${normalizedTargetBranch}`;

      try {
        await this.gitCommandCapture(["-C", managedRepoPath, "rev-parse", "--verify", sourceRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      } catch {
        throw new Error(`Task branch ${sourceBranch} is not available on origin`);
      }

      try {
        await this.gitCommandCapture(["-C", managedRepoPath, "rev-parse", "--verify", targetRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      } catch {
        throw new Error(`Target branch ${normalizedTargetBranch} does not exist on origin`);
      }

      const changedFilesRaw = await this.gitCommandCapture(
        ["-C", managedRepoPath, "diff", "--name-only", `${targetRef}...${sourceRef}`],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      const changedFiles = changedFilesRaw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const suggestedCommitMessage = this.buildGeneratedCommitSubjectFromFiles(task, changedFiles);

      try {
        await this.gitCommandCapture(
          ["-C", managedRepoPath, "merge-base", "--is-ancestor", sourceRef, targetRef],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        return {
          sourceBranch,
          targetBranch: normalizedTargetBranch,
          mergeable: false,
          message: `${sourceBranch} is already merged into ${normalizedTargetBranch}.`,
          suggestedCommitMessage
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("exited with code 1")) {
          throw error;
        }
      }

      const mergeTreeOutput = await this.gitCommandCaptureAllowExitCodes(
        ["-C", managedRepoPath, "merge-tree", "--write-tree", "--messages", targetRef, sourceRef],
        [0, 1],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      const conflictLine = mergeTreeOutput
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^CONFLICT\b/i.test(line));

      return {
        sourceBranch,
        targetBranch: normalizedTargetBranch,
        mergeable: !conflictLine,
        message: conflictLine ?? `Can squash merge ${sourceBranch} into ${normalizedTargetBranch}.`,
        suggestedCommitMessage
      };
    });
  }

  async mergeTaskBranch(task: Task, targetBranch: string, options?: { commitMessage?: string | null }): Promise<Task> {
    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const branchName = task.branchName;
    const targetBranchName = targetBranch.trim();
    if (!branchName) {
      throw new Error("No task branch recorded for merging");
    }

    if (!targetBranchName) {
      throw new Error("No target branch was provided for merging");
    }

    const workspacePath = this.resolveWorkspacePath(task.id);
    const workspaceExists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);

    if (workspaceExists && (await this.localBranchExists(workspacePath, branchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      await this.gitCommand(["-C", workspacePath, "checkout", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.pushTaskBranch(task);
    }

    await this.withFreshManagedRepo(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "merge", async (managedRepoPath) => {
      const defaultRef = `origin/${targetBranchName}`;
      const remoteBranchRef = `origin/${branchName}`;

      if (!(await this.refExists(managedRepoPath, defaultRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
        throw new Error(`Target branch ${targetBranchName} does not exist on origin`);
      }

      if (!(await this.refExists(managedRepoPath, remoteBranchRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
        throw new Error(`Task branch ${branchName} is not available on origin`);
      }

      const mergeRoot = await mkdtemp(path.join(tmpdir(), `agentswarm-merge-${task.id}-`));
      const mergeWorkspacePath = path.join(mergeRoot, "workspace");
      const mergeBranchName = `agentswarm-merge-${sanitizePathSegment(task.id).replace(/\//g, "-")}-${nanoid(6).toLowerCase()}`;

      try {
        await this.addManagedWorktree(
          managedRepoPath,
          mergeWorkspacePath,
          mergeBranchName,
          defaultRef,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );

        await this.gitCommand(
          ["-C", mergeWorkspacePath, "merge", "--squash", "--no-commit", remoteBranchRef],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername,
          task
        );

        const custom = options?.commitMessage?.trim();
        const subject =
          custom && custom.length > 0
            ? this.toCommitSubject(custom)
            : await this.buildGeneratedCommitSubject(task, mergeWorkspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        await this.commitWorkspaceChanges(task, mergeWorkspacePath, subject, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        await this.gitCommand(
          ["-C", mergeWorkspacePath, "push", "--no-verify", "origin", `HEAD:refs/heads/${targetBranchName}`],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
      } catch (error) {
        await this.gitCommand(["-C", mergeWorkspacePath, "merge", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
          () => undefined
        );
        await this.gitCommand(["-C", mergeWorkspacePath, "reset", "--hard", defaultRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
          () => undefined
        );
        throw error;
      } finally {
        await this.removeWorkspaceFromManagedRepo(managedRepoPath, mergeWorkspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        await rm(mergeRoot, { recursive: true, force: true });
      }
    });

    await this.taskStore.appendLog(task.id, `Spawner: squash merged ${branchName} into ${targetBranchName}.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async deleteTaskRemoteBranch(task: Task): Promise<void> {
    const branchName = task.branchName?.trim();
    if (task.branchStrategy !== "feature_branch" || !branchName) {
      await this.taskStore.appendLog(task.id, "Spawner: skipped remote branch deletion because this task does not own a feature branch.");
      return;
    }

    if (branchName === task.repoDefaultBranch || branchName === task.baseBranch) {
      await this.taskStore.appendLog(task.id, `Spawner: skipped remote branch deletion for protected branch ${branchName}.`);
      return;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    await this.withFreshManagedRepo(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername, "delete_remote_branch", async (managedRepoPath) => {
      const remoteBranchRef = `origin/${branchName}`;
      if (!(await this.refExists(managedRepoPath, remoteBranchRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
        await this.taskStore.appendLog(task.id, `Spawner: remote branch ${branchName} does not exist; nothing to delete.`);
        return;
      }

      await this.gitCommand(
        ["-C", managedRepoPath, "push", "--no-verify", "origin", "--delete", branchName],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
    });

    await this.taskStore.appendLog(task.id, `Spawner: deleted remote branch ${branchName} from origin.`);
  }

  async publishAcceptedTask(task: Task): Promise<Task> {
    await this.pushTaskBranch(task);
    const published = await this.taskStore.setStatus(task.id, "open", {
      errorMessage: null,
      enqueued: false
    });
    await this.cleanupTaskArtifacts(task);
    if (!published) {
      throw new Error("Failed to update task after publishing");
    }
    await this.taskStore.appendLog(task.id, "Task branch pushed; task remains open for more work.");
    return published;
  }

  /**
   * Clone/fetch and check out the task workspace only (no agent container). Used for Interactive-first task sessions.
   */
  async prepareTaskWorkspaceOnly(task: Task): Promise<Task> {
    const [settings, runtimeCredentialsRaw] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials(null, task.codexCredentialSource ?? "auto")
    ]);
    const runtimeCredentials = runtimeCredentialsRaw;
    const providerDefinition = getProviderRuntimeDefinition(task.provider);
    const missingCredentialMessage = providerDefinition.getMissingCredentialMessage(runtimeCredentials);
    if (missingCredentialMessage) {
      throw new Error(missingCredentialMessage);
    }

    const branchName =
      task.branchStrategy === "work_on_branch"
        ? task.baseBranch
        : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix);

    let workingTask = task;
    if (task.branchStrategy !== "work_on_branch" && !task.branchName) {
      const patched = await this.taskStore.patchTask(task.id, { branchName });
      if (patched) {
        workingTask = patched;
      }
    }

    const action: TaskAction = workingTask.taskType === "ask" ? "ask" : "build";
    let workspace: WorkspacePreparation;
    const preparedWorkspace = await this.withTrackedTaskGitOperation(workingTask, "clone_for_task", async () => {
      this.emitWorkspacePrepareEvent("workspace_prepare_started", {
        taskId: workingTask.id,
        taskType: workingTask.taskType,
        workspaceKind: WORKSPACE_KIND,
        mode: settings.workspaceProvisioningMode
      });
      try {
        const prepared = await this.withFreshManagedRepo(
          workingTask,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername,
          "workspace_prepare",
          async (managedRepoPath) => ({
            workspace: await this.prepareWorkspace(
              workingTask,
              action,
              branchName,
              managedRepoPath,
              settings.workspaceProvisioningMode,
              runtimeCredentials.githubToken,
              runtimeCredentials.gitUsername
            )
          })
        );
        this.emitWorkspacePrepareEvent("workspace_prepare_succeeded", {
          taskId: workingTask.id,
          taskType: workingTask.taskType,
          workspaceKind: WORKSPACE_KIND,
          mode: settings.workspaceProvisioningMode
        });
        return prepared.workspace;
      } catch (error) {
        const reason = error instanceof WorkspacePrepareError ? error.reason : this.classifyWorkspacePrepareFailure(error);
        this.emitWorkspacePrepareEvent("workspace_prepare_failed", {
          taskId: workingTask.id,
          taskType: workingTask.taskType,
          workspaceKind: WORKSPACE_KIND,
          failureReason: reason,
          mode: settings.workspaceProvisioningMode
        });
        throw error;
      }
    });
    workspace = preparedWorkspace;

    let nextTask = (await this.taskStore.getTask(workingTask.id)) ?? workingTask;
    if (action === "build" && !nextTask.workspaceBaseRef) {
      const patched = await this.taskStore.patchTask(workingTask.id, { workspaceBaseRef: workspace.workspaceBaseRef });
      if (patched) {
        nextTask = patched;
      }
    }

    if (action === "build") {
      const workspacePath = workspace.workspacePath;
      await this.ensureWorkspaceGitHooks(workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    }

    await this.taskStore.patchTask(workingTask.id, {
      executionStatus: "idle",
      executionAction: null,
      enqueued: false,
      errorMessage: null,
      finishedAt: new Date().toISOString()
    });
    await this.taskStore.appendMessage(workingTask.id, {
      role: "system",
      content: "Workspace prepared and ready for changes."
    });
    return (await this.taskStore.getTask(workingTask.id)) ?? nextTask;
  }

  async runTaskPostflight(task: Task): Promise<void> {
    this.cancelRequestedTaskIds.delete(task.id);
    await this.validateTaskPostflight(task);

    const [settings, runtimeCredentialsRaw] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials(null, task.codexCredentialSource ?? "auto")
    ]);
    const runtimeCredentials = runtimeCredentialsRaw;

    const branchName =
      task.branchStrategy === "work_on_branch"
        ? task.baseBranch
        : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix);
    const workspacePath = this.resolveWorkspacePath(task.id);
    const hostWorkspacePath = this.resolveWorkspaceHostPath(task.id);

    let runId: string | null = null;
    let executionId = nanoid();

    try {
      const run = await this.taskStore.createRun(task.id, {
        action: "build",
        provider: task.provider,
        providerProfile: task.providerProfile,
        modelOverride: task.modelOverride,
        branchName
      });
      runId = run?.id ?? null;
      executionId = runId ?? executionId;
      this.executionContextStorage.enterWith({ taskId: task.id, executionId });
      const payloadDir = this.resolveRuntimePayloadDir(task.id, executionId);
      await mkdir(payloadDir, { recursive: true });

      const appendRunLog = (line: string) => this.taskStore.appendLogForRun(task.id, line, runId);
      await this.syncTaskStatusForRunningRuns(task.id, {
        branchName,
        lastAction: "build"
      });
      this.ensureTaskNotCancelled(task.id);

      const checkpointRef = (
        await this.gitCommandCapture(
          ["-C", workspacePath, "rev-parse", "HEAD"],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        )
      ).trim();
      const changeProposalUntrackedPaths = await this.listUntrackedRelativePaths(
        workspacePath,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );

      if (runId) {
        await this.taskStore.updateRun(runId, {
          changeProposalCheckpointRef: checkpointRef,
          changeProposalUntrackedPaths
        });
      }

      const workspace: WorkspacePreparation = {
        workspacePath,
        hostWorkspacePath,
        startRef: checkpointRef,
        workspaceBaseRef: task.workspaceBaseRef ?? checkpointRef,
        kind: WORKSPACE_KIND,
        ephemeral: false,
        cleanupRepoPath: null
      };

      await appendRunLog("Spawner: starting manual postflight run.");
      await this.runConfiguredPostflight(task, workspace, executionId, runId, payloadDir, appendRunLog);

      this.ensureTaskNotCancelled(task.id);

      await this.stripEphemeralWorkspaceFiles(workspacePath);
      const diffBaseRef = task.workspaceBaseRef ?? checkpointRef;
      const { diff: branchDiff, diffStat, changedFiles, diffTruncated, toRef } = await this.collectWorkingTreeDiffSinceRef(
        workspacePath,
        diffBaseRef,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      const finishedAt = new Date().toISOString();
      const summary =
        changedFiles.length > 0
          ? "Postflight completed locally. Review the generated changes in the pending checkpoint."
          : "Postflight completed with no workspace changes.";

      if (runId) {
        await this.taskStore.updateRun(runId, {
          status: "succeeded",
          finishedAt,
          summary
        });
      }

      const createdProposal =
        runId && changedFiles.length > 0
          ? await this.createBuildRunChangeProposal(task, runId, workspacePath, {
              fromRef: diffBaseRef,
              diff: branchDiff,
              diffStat,
              changedFiles,
              diffTruncated,
              toRef
            })
          : null;
      const nextBranchDiff = changedFiles.length > 0 ? branchDiff : task.branchDiff;
      if (task.autoApplyCheckpoints && createdProposal) {
        await this.autoApplyCheckpointIfEnabled(task.id, createdProposal.id);
      }

      if (
        !(await this.syncTaskStatusForRunningRuns(task.id, {
          finishedAt,
          branchDiff: nextBranchDiff,
          lastAction: "build",
          branchName,
          errorMessage: null
        }))
      ) {
        await this.taskStore.setExecutionState(task.id, "idle", {
          finishedAt,
          enqueued: false,
          branchDiff: nextBranchDiff,
          lastAction: "build",
          executionAction: null,
          branchName,
          errorMessage: null
        });
      }

      await appendRunLog(
        changedFiles.length > 0
          ? "Spawner: postflight finished successfully and generated workspace changes."
          : "Spawner: postflight finished successfully with no workspace changes."
      );
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      const isCancelled = error instanceof CancelledTaskError || this.isCancellationRequested(task.id);

      if (runId) {
        await this.taskStore.updateRun(runId, {
          status: isCancelled ? "cancelled" : "failed",
          finishedAt,
          errorMessage: isCancelled ? null : message,
          summary: isCancelled ? "Task cancelled by user." : null
        });
      }

      if (
        !(await this.syncTaskStatusForRunningRuns(task.id, {
          lastAction: "build"
        }))
      ) {
        await this.taskStore.setExecutionState(task.id, isCancelled ? "cancelled" : "failed", {
          finishedAt,
          enqueued: false,
          errorMessage: isCancelled ? "Cancelled by user" : message,
          lastAction: "build"
        });
      }

      throw error;
    } finally {
      if (executionId) {
        this.unregisterActiveExecution(task.id, executionId);
      }
      if ((this.activeExecutions.get(task.id)?.size ?? 0) === 0) {
        this.cancelRequestedTaskIds.delete(task.id);
      }
      await this.cleanupWorkspaceGitLocks(workspacePath).catch(() => undefined);
      if (executionId) {
        await rm(this.resolveRuntimePayloadDir(task.id, executionId), { recursive: true, force: true });
      }
    }
  }

  async runTask(task: Task, action: TaskAction, input?: TaskExecutionInput | string, promptMessageId: string | null = null): Promise<void> {
    this.cancelRequestedTaskIds.delete(task.id);
    const [settings, runtimeCredentialsRaw, repositoryRuntimeEnvEntries, responsePreferenceUser] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials(null, task.codexCredentialSource ?? "auto"),
      this.repositoryStore.getRepositoryRuntimeEnvEntries(task.repoId),
      task.ownerUserId ? this.userStore.getAuthSessionUser(task.ownerUserId) : Promise.resolve(null)
    ]);
    const gitIdentity = resolveTaskGitCommitIdentity(settings, {
      ...DEFAULT_GIT_COMMIT_IDENTITY
    });
    const runtimeCredentials = runtimeCredentialsRaw;
    const providerDefinition = getProviderRuntimeDefinition(task.provider);
    const missingCredentialMessage = providerDefinition.getMissingCredentialMessage(runtimeCredentials);
    if (missingCredentialMessage) {
      throw new Error(missingCredentialMessage);
    }

    const branchName =
      task.branchStrategy === "work_on_branch"
        ? task.baseBranch
        : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix);
    let runId: string | null = null;
    let executionId = nanoid();
    let workspace: WorkspacePreparation | null = null;
    let rawEventsJsonlPath: string | null = null;
    let liveTimelineStream: { stop: () => Promise<void> } | null = null;

    try {
      const run = await this.taskStore.createRun(task.id, {
        action,
        promptMessageId,
        provider: task.provider,
        providerProfile: task.providerProfile,
        modelOverride: task.modelOverride,
        branchName
      });
      runId = run?.id ?? null;
      executionId = runId ?? executionId;
      this.executionContextStorage.enterWith({ taskId: task.id, executionId });
      const payloadDir = this.resolveRuntimePayloadDir(task.id, executionId);
      const appendRunLog = (line: string) => this.taskStore.appendLogForRun(task.id, line, runId);
      rawEventsJsonlPath = runId
        ? await this.prepareTaskRunRawEventsJsonl(task.id, runId)
        : path.join(payloadDir, "raw-events.jsonl");
      if (runId) {
        await this.taskStore.updateRun(runId, { hasRawJson: true });
      }
      await this.syncTaskStatusForRunningRuns(task.id, {
        branchName,
        ...(action === "ask" && task.executionStatus === "running" ? {} : { lastAction: action })
      });
      this.ensureTaskNotCancelled(task.id);
      await appendRunLog("Spawner: using existing task workspace.");
      workspace = await this.requireExistingTaskWorkspace(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      const repoProfile = await this.ensureRepoProfile(
        task,
        workspace.workspacePath,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      this.ensureTaskNotCancelled(task.id);
      if (action === "build" && !task.workspaceBaseRef) {
        await this.taskStore.patchTask(task.id, { workspaceBaseRef: workspace.workspaceBaseRef });
      }
      const runtimeMcp = await this.buildRuntimeMcpConfig(task, settings.mcpServers, executionId);
      const runtimeMcpEnv = runtimeMcp.env;
      const missingMcpBearerEnvVars = collectMissingMcpServerBearerTokenEnvVars(runtimeMcp.servers, {
        ...process.env,
        ...runtimeMcpEnv
      });
      const providerConfigPath = path.join(payloadDir, providerDefinition.configFileName);
      const resultMarkdownPath = path.join(payloadDir, "result.md");
      const resultJsonPath = path.join(payloadDir, "result.json");
      const resolvedModel = providerDefinition.getResolvedModel(task.modelOverride, task.providerProfile);
      const resolvedProfileSettings = providerDefinition.getResolvedProfileSettings(task.providerProfile, resolvedModel);
      const normalizedInput =
        typeof input === "string"
          ? {
              content: input,
              attachments: []
            }
          : {
              content: input?.content ?? "",
              attachments: input?.attachments ?? []
            };
      const manifestAttachments = normalizedInput.attachments.map((attachment) => {
        const absolutePath = resolveTaskPromptAttachmentServerPath(task.id, attachment.relativePath);
        if (!absolutePath) {
          throw new Error(`Prompt attachment path is invalid for ${attachment.name}.`);
        }

        return {
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          absolutePath
        };
      });
      const manifest: RuntimeManifest = {
        taskId: task.id,
        provider: task.provider,
        taskType: task.taskType,
        action,
        title: task.title,
        prompt: task.prompt,
        executionSummary: task.executionSummary,
        repoProfile,
        content: normalizedInput.content,
        attachments: manifestAttachments,
        baseBranch: task.baseBranch,
        repoDefaultBranch: task.repoDefaultBranch,
        branchStrategy: task.branchStrategy,
        branchName,
        providerProfile: task.providerProfile,
        modelOverride: task.modelOverride,
        resolvedModel,
        resolvedReasoningEffort: resolvedProfileSettings.reasoningEffort,
        resolvedThinkingBudgetTokens: resolvedProfileSettings.thinkingBudgetTokens,
        agentResponsePreference: responsePreferenceUser?.agentResponsePreference ?? {},
        workspacePath: workspace.workspacePath,
        resultMarkdownPath,
        resultJsonPath,
        rawEventsJsonlPath,
        providerConfigPath
      };
      await appendRunLog(`Spawner: preparing ${task.provider} runtime image (${action}).`);
      await this.ensureRuntimeImage(task.provider);
      await appendRunLog("Spawner: repository profile ready.");
      await appendRunLog(`Spawner: ${workspace.kind} workspace ready at ${workspace.workspacePath}.`);

      const payloadPaths = await this.writeRuntimePayloadFiles(manifest, providerDefinition.getProviderConfig(runtimeMcp.servers));
      const repositoryRuntimeEnv = await materializeRepositoryRuntimeEnvEntries({
        destinationDir: path.join(payloadPaths.payloadDir, "repository-env-files"),
        entries: repositoryRuntimeEnvEntries,
        fileStore: this.repositoryEnvFileStore
      });
      await appendRunLog(`Spawner: runtime payload files ready at ${payloadDir}.`);
      this.ensureTaskNotCancelled(task.id);

      if (action === "build") {
        await this.ensureWorkspaceGitHooks(workspace.workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        await appendRunLog("Spawner: workspace Git integration is ready.");
      }
      if (!runtimeCredentials.githubToken) {
        await appendRunLog("Spawner: GitHub token is not configured; in-agent git pull/push against remote repositories may fail.");
      }

      await appendRunLog(
        `Spawner: runtime config includes provider=${task.provider}, profile=${task.providerProfile}, and ${runtimeMcp.servers.length} MCP server${runtimeMcp.servers.length === 1 ? "" : "s"}.`
      );
      if (runtimeMcp.injectedAgentSwarmMcp) {
        await appendRunLog("Spawner: AgentSwarm MCP is connected automatically for this run.");
      }
      if (missingMcpBearerEnvVars.length > 0) {
        await appendRunLog(
          `Spawner: warning - missing MCP bearer token env var${missingMcpBearerEnvVars.length === 1 ? "" : "s"}: ${missingMcpBearerEnvVars.join(", ")}`
        );
      }

      this.ensureTaskNotCancelled(task.id);

      if (runId && action === "build") {
        const checkpointRef = await this.resolveWorkspaceHeadRef(
          workspace.workspacePath,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        if (!checkpointRef) {
          throw new Error("Task workspace has no commits yet. Create an initial commit before running build mode.");
        }
        const changeProposalUntrackedPaths = await this.listUntrackedRelativePaths(
          workspace.workspacePath,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        await this.taskStore.updateRun(runId, {
          changeProposalCheckpointRef: checkpointRef,
          changeProposalUntrackedPaths
        });
      }

      const containerName = `agentswarm-task-${sanitizePathSegment(task.id).replace(/\//g, "-")}-${executionId.slice(0, 8).toLowerCase()}`;
      const workspaceMountMode = action === "ask" ? "ro" : "rw";
      const rawEventsMount = runId ? this.resolveTaskRunRawEventsMount(task.id, runId) : null;
      const gitRuntimeMounts = await resolveWorkspaceGitRuntimeMounts(workspace.workspacePath);
      const attachmentRoot = manifestAttachments.length > 0 ? resolveTaskPromptAttachmentRoot(task.id) : null;
      const attachmentRelativeRoot = attachmentRoot ? path.relative(env.TASK_WORKSPACE_ROOT, attachmentRoot) : null;
      const linkedWorkspaceMountPlan = await buildLinkedWorkspaceMountPlan({
        rootWorkspacePath: workspace.workspacePath,
        containerWorkspacePath: workspace.workspacePath,
        linkedWorkspaces: task.linkedWorkspaces
      });
      const providerStateContainerPath = this.resolveProviderStateContainerPath(task.provider);
      const providerStatePaths = await ensureTaskProviderStatePaths(task.id, task.provider);
      const dockerSocketPolicy = resolveDockerSocketAccessPolicy(task.provider);
      const dockerSocketMountArgs = resolveDockerSocketMountArgs(dockerSocketPolicy);
      const dockerSocketEnvEntries = resolveDockerSocketEnvEntries(dockerSocketPolicy);
      const taskRuntimeGitEnvEntries = buildTaskRuntimeGitEnvEntries({
        workspacePath: workspace.workspacePath,
        githubToken: runtimeCredentials.githubToken,
        gitUsername: runtimeCredentials.gitUsername,
        gitIdentity
      });
      if (workspaceMountMode === "ro") {
        await appendRunLog("Spawner: mounting workspace read-only (ask mode).");
      }
      if (linkedWorkspaceMountPlan.mounted.length > 0) {
        await appendRunLog(
          `Spawner: mounted ${linkedWorkspaceMountPlan.mounted.length} linked workspace${linkedWorkspaceMountPlan.mounted.length === 1 ? "" : "s"} read-only under ${LINKED_WORKSPACE_DIRNAME}.`
        );
      }
      if (linkedWorkspaceMountPlan.skipped.length > 0) {
        await appendRunLog(
          `Spawner: skipped ${linkedWorkspaceMountPlan.skipped.length} linked workspace mount${linkedWorkspaceMountPlan.skipped.length === 1 ? "" : "s"} because the workspace folder was unavailable.`
        );
      }
      if (dockerSocketPolicy.enabled) {
        emitDockerSocketEnabledEventOnce({ provider: task.provider, policy: dockerSocketPolicy });
        await appendRunLog(
          `Spawner: docker socket access enabled for provider runtime (${dockerSocketPolicy.appEnvironment} environment).`
        );
      }
      const args = [
        "run",
        "--rm",
        "--name",
        containerName,
        ...(runtimeMcp.injectedAgentSwarmMcp ? this.buildInternalAgentSwarmMcpDockerArgs() : []),
        "-v",
        `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
        ...this.buildTaskWorkspaceMountArgs(task.id, workspace.workspacePath, workspaceMountMode),
        ...(attachmentRoot && attachmentRelativeRoot
          ? this.buildTaskWorkspaceMountArgs(attachmentRelativeRoot, attachmentRoot, "ro")
          : []),
        ...(rawEventsMount
          ? this.buildTaskWorkspaceMountArgs(
              path.relative(env.TASK_WORKSPACE_DOCKER_SOURCE, rawEventsMount.hostDir),
              rawEventsMount.containerDir,
              "rw"
            )
          : []),
        ...linkedWorkspaceMountPlan.mountArgs,
        ...gitRuntimeMounts,
        ...this.buildTaskWorkspaceMountArgs(
          path.relative(env.TASK_WORKSPACE_DOCKER_SOURCE, providerStatePaths.hostPath),
          providerStateContainerPath,
          "rw"
        ),
        ...dockerSocketMountArgs,
        "-e",
        `TASK_MANIFEST_FILE=${payloadPaths.manifestPath}`,
        "-e",
        `PROVIDER_CONFIG_FILE=${payloadPaths.providerConfigPath}`,
        "-e",
        `TASK_WORKSPACE_PATH=${workspace.hostWorkspacePath}`,
        "-e",
        `TASK_WORSPACE_PATH=${workspace.hostWorkspacePath}`,
        "-e",
        `TASK_PROVIDER_STATE_PATH=${providerStateContainerPath}`,
        "-e",
        `TASK_PROVIDER_HOME=${path.dirname(providerStateContainerPath)}`
      ];

      const addRuntimeEnv = (name: string, value: string): void => {
        args.push("-e", `${name}=${value}`);
      };
      const providerRuntimeEnv = providerDefinition.getRuntimeEnv(runtimeCredentials);
      for (const [name, value] of Object.entries(providerRuntimeEnv)) {
        if (value) {
          addRuntimeEnv(name, value);
        }
      }
      for (const [name, value] of dockerSocketEnvEntries) {
        addRuntimeEnv(name, value);
      }
      for (const [name, value] of Object.entries(runtimeMcpEnv)) {
        addRuntimeEnv(name, value);
      }
      for (const [name, value] of taskRuntimeGitEnvEntries) {
        addRuntimeEnv(name, value);
      }
      for (const [name, value] of repositoryRuntimeEnv) {
        addRuntimeEnv(name, value);
      }
      args.push(providerDefinition.image, ...providerDefinition.command);

      await appendRunLog(`Spawner: launching ${task.provider} container for branch ${branchName}.`);
      emitNestedContainerSpawnedEvent({
        source: "task_runtime",
        taskId: task.id,
        provider: task.provider,
        policy: dockerSocketPolicy
      });

      liveTimelineStream = this.startLiveRunTimelineStream(task, runId, rawEventsJsonlPath);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
        this.registerActiveExecution(task.id, executionId, { label: containerName, containerName, process: proc });

        let stdoutRemainder = "";
        let stderrRemainder = "";
        const processLine = (prefix: "stdout" | "stderr", line: string): void => {
          if (line.trim().length > 0) {
            void this.taskStore.appendLogForRun(task.id, `[${prefix}] ${line}`, runId);
          }
        };

        const pushLines = (prefix: "stdout" | "stderr", chunk: string): void => {
          const sanitized = sanitizeChunk(chunk);
          if (prefix === "stdout") {
            stdoutRemainder += sanitized;
            const lines = stdoutRemainder.split("\n");
            stdoutRemainder = lines.pop() ?? "";
            for (const line of lines) {
              processLine("stdout", line.trimEnd());
            }
            return;
          }

          stderrRemainder += sanitized;
          const lines = stderrRemainder.split("\n");
          stderrRemainder = lines.pop() ?? "";
          for (const line of lines) {
            processLine("stderr", line.trimEnd());
          }
        };

        proc.stdout.on("data", (data) => {
          pushLines("stdout", data.toString());
        });
        proc.stderr.on("data", (data) => {
          pushLines("stderr", data.toString());
        });

        proc.on("error", reject);
        proc.on("close", (code) => {
          this.unregisterActiveExecution(task.id, executionId, proc);

          if (stdoutRemainder.trim().length > 0) {
            processLine("stdout", stdoutRemainder.trimEnd());
          }
          if (stderrRemainder.trim().length > 0) {
            processLine("stderr", stderrRemainder.trimEnd());
          }

          if (this.isCancellationRequested(task.id)) {
            reject(new CancelledTaskError());
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`Runtime container exited with code ${code ?? "unknown"}`));
        });
      });

      this.ensureTaskNotCancelled(task.id);
      await liveTimelineStream.stop();
      liveTimelineStream = null;
      await this.parseAndStoreRunTimeline(task, runId, rawEventsJsonlPath);

      const runtimeResult = await this.readRuntimeResult(payloadPaths.resultMarkdownPath, payloadPaths.resultJsonPath);
      if (action === "build") {
        await this.runConfiguredPostflight(task, workspace, executionId, runId, payloadPaths.payloadDir, appendRunLog);
      }
      const finishedAt = new Date().toISOString();

      if (action === "ask") {
        const finalMarkdown = runtimeResult.summaryMarkdown.trim();
        if (finalMarkdown.length === 0) {
          throw new Error(`${action} action returned empty markdown output`);
        }

        const branchDiff = null;
        await this.taskStore.updateResultArtifacts(task.id, finalMarkdown);
        await this.taskStore.appendMessage(task.id, {
          role: "assistant",
          action,
          content: finalMarkdown
        });
        if (runId) {
          await this.taskStore.updateRun(runId, {
            status: "succeeded",
            finishedAt,
            summary: finalMarkdown
          });
        }
        if (
          !(await this.syncTaskStatusForRunningRuns(task.id, {
            finishedAt,
            lastAction: action,
            errorMessage: null
          }))
        ) {
          await this.taskStore.setExecutionState(task.id, "idle", {
            finishedAt,
            enqueued: false,
            branchDiff,
            lastAction: action,
            executionAction: null,
            errorMessage: null
          });
        }
      } else {
        const diffBaseRef = task.workspaceBaseRef ?? workspace.workspaceBaseRef;
        const { branchDiff, diffStat, changedFiles, diffTruncated, toRef, providerCommitted, changeOutcome, commitSha } = await this.finalizeBuild(
          task,
          workspace.workspacePath,
          diffBaseRef,
          workspace.startRef,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        if (providerCommitted) {
          await appendRunLog("Spawner: detected provider-created local commit; reusing it instead of creating a new commit.");
          const commitSubject = await this.getCommitSubject(
            workspace.workspacePath,
            commitSha,
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          ).catch(() => "");
          await this.appendGitActivityMessage(
            task.id,
            `Agent created local commit ${commitSha.slice(0, 7)}${commitSubject ? `: ${commitSubject}` : "."}`
          );
        }
        const finalSummary =
          runtimeResult.summaryMarkdown.trim() ||
          (changeOutcome === "no_change"
            ? "No code changes were needed. Reviewed current implementation and kept files unchanged."
            : "Build completed locally. Review the diff, then push the branch when ready.");
        if (finalSummary) {
          await this.taskStore.updateResultArtifacts(task.id, finalSummary);
        }
        await this.taskStore.appendMessage(task.id, {
          role: "assistant",
          action,
          content: finalSummary
        });
        if (runId) {
          await this.taskStore.updateRun(runId, {
            status: "succeeded",
            finishedAt,
            summary: finalSummary,
            changeOutcome
          });
        }
        const createdProposal =
          runId && action === "build"
            ? await this.createBuildRunChangeProposal(task, runId, workspace.workspacePath, {
                fromRef: diffBaseRef,
                diff: branchDiff,
                diffStat,
                changedFiles,
                diffTruncated,
                toRef,
                alreadyApplied: providerCommitted
              })
            : null;
        const nextBranchDiff = branchDiff.length > 0 ? branchDiff : task.branchDiff;
        if (task.autoApplyCheckpoints && createdProposal) {
          await this.autoApplyCheckpointIfEnabled(task.id, createdProposal.id);
        }

        if (
          !(await this.syncTaskStatusForRunningRuns(task.id, {
            finishedAt,
            branchDiff: nextBranchDiff,
            lastAction: action,
            branchName,
            errorMessage: null
          }))
        ) {
          await this.taskStore.setExecutionState(task.id, "idle", {
            finishedAt,
            enqueued: false,
            branchDiff: nextBranchDiff,
            lastAction: action,
            executionAction: null,
            branchName,
            errorMessage: null
          });
        }
      }

      await appendRunLog("Spawner: task finished successfully.");
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      const isCancelled = error instanceof CancelledTaskError || this.isCancellationRequested(task.id);
      if (liveTimelineStream) {
        await liveTimelineStream.stop();
        liveTimelineStream = null;
      }
      await this.parseAndStoreRunTimeline(task, runId, rawEventsJsonlPath);
      if (runId) {
        await this.taskStore.updateRun(runId, {
          status: isCancelled ? "cancelled" : "failed",
          finishedAt,
          errorMessage: isCancelled ? null : message,
          summary: isCancelled ? "Task cancelled by user." : null
        });
      }
      if (
        !(await this.syncTaskStatusForRunningRuns(task.id, {
          lastAction: action
        }))
      ) {
        await this.taskStore.setExecutionState(task.id, isCancelled ? "cancelled" : "failed", {
          finishedAt,
          enqueued: false,
          errorMessage: isCancelled ? "Cancelled by user" : message,
          lastAction: action
        });
      }
      throw error;
    } finally {
      if (liveTimelineStream) {
        await liveTimelineStream.stop();
      }
      if (executionId) {
        this.unregisterActiveExecution(task.id, executionId);
      }
      if ((this.activeExecutions.get(task.id)?.size ?? 0) === 0) {
        this.cancelRequestedTaskIds.delete(task.id);
      }
      if (workspace?.workspacePath) {
        await this.cleanupWorkspaceGitLocks(workspace.workspacePath).catch(() => undefined);
      }
      await this.cleanupPreparedWorkspace(workspace, runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(() => undefined);
      if (executionId) {
        await rm(this.resolveRuntimePayloadDir(task.id, executionId), { recursive: true, force: true });
      }
    }
  }
}

export class CancelledTaskError extends Error {
  constructor() {
    super("Task cancelled by user");
    this.name = "CancelledTaskError";
  }
}
