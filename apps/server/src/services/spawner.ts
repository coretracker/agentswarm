import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getActiveStatusForAction,
  getCheckpointMutationBlockedReason,
  getSuccessfulStatusForAction,
  getTaskStatusLabel,
  isActiveTaskStatus,
  isQueuedTaskStatus,
  type AgentProvider,
  type McpServerConfig,
  type Task,
  type TaskChangeProposal,
  type TaskLiveDiff,
  type TaskAction,
  type TaskRun,
  type TaskMergePreview,
  type TaskPushPreview,
  type TaskWorkspaceCommit,
  type TaskWorkspaceCommitLog
} from "@agentswarm/shared-types";
import { makeBranchName } from "../lib/branch.js";
import { extractGitLockPathFromErrorMessage, isPathInside, resolveGitTargetLockKey } from "../lib/git-locks.js";
import { resolveSafeWorkspaceFilePath } from "../lib/safe-workspace-file.js";
import { ensureTaskProviderStatePaths, resolveTaskProviderStatePaths, resolveTaskStateRootPaths } from "../lib/task-provider-state.js";
import { env } from "../config/env.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";
import { TaskStore } from "./task-store.js";
import { SettingsStore } from "./settings-store.js";

const ansiPattern = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\))/g;

const sanitizeChunk = (chunk: string): string =>
  chunk.replace(/\r/g, "\n").replace(ansiPattern, "").replace(/[^\x09\x0A\x20-\x7E]/g, "");

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
  input: string;
  baseBranch: string;
  repoDefaultBranch: string;
  branchStrategy: Task["branchStrategy"];
  branchName: string;
  providerProfile: Task["providerProfile"];
  modelOverride: string | null;
  resolvedModel: string | null;
  resolvedReasoningEffort?: string;
  resolvedMaxTurns?: number;
  workspacePath: string;
  resultMarkdownPath: string;
  resultJsonPath: string;
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
  startRef: string;
  workspaceBaseRef: string;
}

export class SpawnerService {
  private readonly runtimeReady = new Set<AgentProvider>();
  private activeExecutions = new Map<string, { containerName: string; process: ReturnType<typeof spawn> }>();
  private cancelRequestedTaskIds = new Set<string>();
  private gitAskPassPath: string | null = null;
  private repoLocks = new Map<string, Promise<void>>();
  private gitTargetLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly taskStore: TaskStore,
    private readonly settingsStore: SettingsStore
  ) {}

  private runCommand(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });

      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }

  private runCommandCapture(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }

  private runCommandCaptureRaw(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
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

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 || (code !== null && allowedExitCodes.includes(code))) {
          resolve(stdout);
          return;
        }

        reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }

  private async ensureGitAskPassScript(): Promise<string | null> {
    if (this.gitAskPassPath) {
      return this.gitAskPassPath;
    }

    const askPassPath = "/tmp/agentswarm-git-askpass.sh";
    await writeFile(
      askPassPath,
      `#!/usr/bin/env sh
case "$1" in
  *sername*) echo "\${GIT_USERNAME:-x-access-token}" ;;
  *assword*) echo "\${GIT_TOKEN:-}" ;;
  *) echo "" ;;
esac
`,
      "utf8"
    );
    await chmod(askPassPath, 0o700);
    this.gitAskPassPath = askPassPath;
    return askPassPath;
  }

  private async buildGitEnv(
    args: string[],
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<NodeJS.ProcessEnv> {
    const gitEnv: NodeJS.ProcessEnv = {
      GIT_OPTIONAL_LOCKS: "0"
    };
    const askPassPath = githubToken ? await this.ensureGitAskPassScript() : null;
    if (askPassPath) {
      gitEnv.GIT_TERMINAL_PROMPT = "0";
      gitEnv.GIT_ASKPASS = askPassPath;
      gitEnv.GIT_USERNAME = gitUsername;
      gitEnv.GIT_TOKEN = githubToken ?? "";
    }

    if (args[0] === "-C" && typeof args[1] === "string" && args[1].startsWith("/")) {
      gitEnv.GIT_CONFIG_COUNT = "1";
      gitEnv.GIT_CONFIG_KEY_0 = "safe.directory";
      gitEnv.GIT_CONFIG_VALUE_0 = args[1];
    }

    return gitEnv;
  }

  private async cleanupWorkspaceGitLocks(workspacePath: string): Promise<void> {
    const gitDir = path.join(workspacePath, ".git");
    await Promise.all(
      ["index.lock", "HEAD.lock", "config.lock", "packed-refs.lock", "shallow.lock"].map((lockFile) =>
        rm(path.join(gitDir, lockFile), { force: true }).catch(() => undefined)
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
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    locks.set(key, current.then(() => next));
    await current;

    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === next) {
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

  private async gitCommand(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<void> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    await this.runGitWithRecovery(args, () => this.runCommand("git", args, gitEnv));
  }

  private async gitCommandCapture(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () => this.runCommandCapture("git", args, gitEnv));
  }

  private async gitCommandCaptureRaw(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () => this.runCommandCaptureRaw("git", args, gitEnv));
  }

  private async gitCommandCaptureAllowExitCodes(
    args: string[],
    allowedExitCodes: number[],
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string> {
    const gitEnv = await this.buildGitEnv(args, githubToken, gitUsername);
    return this.runGitWithRecovery(args, () =>
      this.runCommandCaptureAllowExitCodes(
        "git",
        args,
        allowedExitCodes,
        gitEnv
      )
    );
  }

  private async withRepoLock<T>(repoKey: string, fn: () => Promise<T>): Promise<T> {
    return this.withNamedLock(this.repoLocks, repoKey, fn);
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
    if (this.runtimeReady.has(provider)) {
      return;
    }

    const definition = getProviderRuntimeDefinition(provider);
    await this.runCommand("docker", ["build", "-t", definition.image, definition.context]);
    this.runtimeReady.add(provider);
  }

  private resolveRuntimePayloadDir(taskId: string): string {
    return path.join(env.RUNTIME_PAYLOAD_ROOT, taskId);
  }

  private resolveWorkspacePath(taskId: string): string {
    return path.join(env.TASK_WORKSPACE_ROOT, taskId);
  }

  private resolveWorkspaceHostPath(taskId: string): string {
    return path.join(env.TASK_WORKSPACE_HOST_ROOT, taskId);
  }

  private resolveProviderStateContainerPath(provider: AgentProvider): string {
    return provider === "claude" ? "/runtime/home/.claude" : "/root/.codex";
  }

  private resolveRepoCachePath(task: Task): string {
    const repoCacheKey = sanitizePathSegment(task.repoId || task.repoName || "repo").replace(/\//g, "-");
    return path.join(env.REPO_CACHE_ROOT, `${repoCacheKey}.git`);
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
    mirrorPath: string,
    ref: string,
    filePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<string | null> {
    try {
      return await this.gitCommandCapture(["--git-dir", mirrorPath, "show", `${ref}:${filePath}`], githubToken, gitUsername);
    } catch {
      return null;
    }
  }

  private async ensureRepoProfile(task: Task, mirrorPath: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const ref = `refs/heads/${task.baseBranch}`;
    const profilePath = this.resolveRepoProfilePath(task);
    const headSha = await this.gitCommandCapture(["--git-dir", mirrorPath, "rev-parse", ref], githubToken, gitUsername);

    try {
      const raw = await readFile(profilePath, "utf8");
      const cached = JSON.parse(raw) as CachedRepoProfile;
      if (cached.baseBranch === task.baseBranch && cached.headSha === headSha && cached.summary.trim().length > 0) {
        return cached.summary;
      }
    } catch {
      // Cache miss.
    }

    const rootPackageJson = await this.readGitFile(mirrorPath, ref, "package.json", githubToken, gitUsername);

    // Fetch every file path in the repo once — used for both the directory map
    // and workspace package discovery, so we only pay the git cost once.
    const allFilePathsRaw = await this.gitCommandCapture(["--git-dir", mirrorPath, "ls-tree", "-r", "--name-only", ref], githubToken, gitUsername);
    const allFilePaths = allFilePathsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const workspacePackagePaths = allFilePaths
      .filter((line) => /^(apps|packages|services|libs)\//.test(line) && line.endsWith("/package.json"))
      .slice(0, 8);

    const workspacePackageSummaries: string[] = [];
    for (const packagePath of workspacePackagePaths) {
      const packageJson = await this.readGitFile(mirrorPath, ref, packagePath, githubToken, gitUsername);
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

  private async ensureRepoMirror(task: Task, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    const mirrorPath = this.resolveRepoCachePath(task);
    await mkdir(env.REPO_CACHE_ROOT, { recursive: true });

    try {
      await access(mirrorPath);
    } catch {
      await this.gitCommand(["clone", "--mirror", task.repoUrl, mirrorPath], githubToken, gitUsername);
    }

    await this.gitCommand(["-C", mirrorPath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername);
    await this.gitCommand(
      ["--git-dir", mirrorPath, "fetch", "--prune", "origin", "+refs/heads/*:refs/heads/*"],
      githubToken,
      gitUsername
    );

    return mirrorPath;
  }

  private async remoteBranchExists(repoUrl: string, branchName: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<boolean> {
    try {
      const output = await this.gitCommandCapture(["ls-remote", "--heads", repoUrl, branchName], githubToken, gitUsername);
      return output.trim().length > 0;
    } catch {
      return false;
    }
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

      await this.gitCommand(["-C", workspacePath, "fetch", "origin"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

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
          ["-C", workspacePath, "diff", "--no-index", "--relative", "--", "/dev/null", filePath],
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
        authorName
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

    if (await this.refExists(workspacePath, trimmed, githubToken, gitUsername)) {
      return trimmed;
    }

    if (!trimmed.includes("/") && trimmed.toUpperCase() !== "HEAD") {
      const originRef = `origin/${trimmed}`;
      if (await this.refExists(workspacePath, originRef, githubToken, gitUsername)) {
        return originRef;
      }
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
    const diffKind: "compare" | "working" | "commits" =
      options?.diffKind === "working" ? "working" : options?.diffKind === "commits" ? "commits" : "compare";

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
  }

  private async prepareWorkspace(
    task: Task,
    action: TaskAction,
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
      await this.gitCommand(["clone", "--no-local", repoCachePath, workspacePath], githubToken, gitUsername);
    } else {
      await this.cleanupWorkspaceGitLocks(workspacePath);
    }

    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "fetch", "origin", task.baseBranch], githubToken, gitUsername);

    if (task.branchStrategy === "work_on_branch") {
      if (await this.localBranchExists(workspacePath, task.baseBranch, githubToken, gitUsername)) {
        await this.gitCommand(["-C", workspacePath, "checkout", task.baseBranch], githubToken, gitUsername);
      } else {
        await this.gitCommand(["-C", workspacePath, "checkout", "-B", task.baseBranch, `origin/${task.baseBranch}`], githubToken, gitUsername);
      }
    } else if (await this.localBranchExists(workspacePath, branchName, githubToken, gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "checkout", branchName], githubToken, gitUsername);
    } else if (await this.remoteBranchExists(task.repoUrl, branchName, githubToken, gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "fetch", "origin", branchName], githubToken, gitUsername);
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, `origin/${branchName}`], githubToken, gitUsername);
    } else {
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, `origin/${task.baseBranch}`], githubToken, gitUsername);
    }

    const startRef = await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);
    return { workspacePath, startRef, workspaceBaseRef: task.workspaceBaseRef ?? startRef };
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
    const payloadDir = this.resolveRuntimePayloadDir(manifest.taskId);
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
    const envMap: Record<string, string> = {};

    for (const server of servers) {
      const envVarName = server.transport === "http" ? server.bearerTokenEnvVar?.trim() : "";
      if (!envVarName) {
        continue;
      }

      const value = process.env[envVarName];
      if (value) {
        envMap[envVarName] = value;
      }
    }

    return envMap;
  }

  private async collectChangedFiles(workspacePath: string, startRef: string, githubToken?: string | null, gitUsername = "x-access-token"): Promise<string[]> {
    const output = await this.gitCommandCapture(["-C", workspacePath, "diff", "--name-only", `${startRef}..HEAD`], githubToken, gitUsername);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private toCommitSubject(input: string): string {
    const cleaned = input.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 72 ? `${cleaned.slice(0, 69).trimEnd()}...` : cleaned;
  }

  private inferCommitType(taskTitle: string, files: string[]): "fix" | "feat" | "refactor" | "docs" | "test" | "chore" {
    const title = taskTitle.toLowerCase();
    if (/\bfix\b|\bbug\b|\bregress/.test(title)) return "fix";

    const loweredFiles = files.map((file) => file.toLowerCase());
    if (loweredFiles.length > 0 && loweredFiles.every((file) => file.endsWith(".md") || file.includes("/docs/"))) return "docs";
    if (loweredFiles.length > 0 && loweredFiles.every((file) => file.includes(".test.") || file.includes(".spec.") || file.includes("/test/"))) return "test";
    if (/\brefactor\b|\bcleanup\b/.test(title)) return "refactor";
    if (/\badd\b|\bimplement\b|\bfeature\b|\binteractive\b/.test(title)) return "feat";
    return "chore";
  }

  private summarizeChangedPaths(files: string[]): string {
    const unique = [...new Set(files.filter(Boolean))];
    if (unique.length === 0) {
      return "update workspace changes";
    }
    if (unique.length === 1) {
      return `update ${path.basename(unique[0])}`;
    }
    if (unique.length === 2) {
      return `update ${path.basename(unique[0])} and ${path.basename(unique[1])}`;
    }
    return `update ${unique.length} files`;
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
    const type = this.inferCommitType(task.title, files);
    const subject = this.summarizeChangedPaths(files);
    return this.toCommitSubject(`${type}(agentswarm): ${subject}`);
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

  private async finalizeBuild(
    task: Task,
    workspacePath: string,
    diffBaseRef: string,
    runStartRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ branchDiff: string; changedFiles: string[]; commitSha: string; providerCommitted: boolean }> {
    // Remove the ephemeral .agentswarm directory before staging so it never appears in the PR diff.
    await rm(path.join(workspacePath, ".agentswarm"), { recursive: true, force: true }).catch(() => undefined);

    await this.gitCommand(["-C", workspacePath, "add", "-A"], githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], githubToken, gitUsername);
      const commitSha = await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);
      if (commitSha !== runStartRef) {
        const branchDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", `${diffBaseRef}..HEAD`], githubToken, gitUsername);
        const changedFiles = await this.collectChangedFiles(workspacePath, diffBaseRef, githubToken, gitUsername);
        return { branchDiff, changedFiles, commitSha, providerCommitted: true };
      }

      throw new Error("No changes detected after provider execution");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
    }

    await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], githubToken, gitUsername);
    const generatedSubject = await this.buildGeneratedCommitSubject(task, workspacePath, githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", generatedSubject], githubToken, gitUsername);

    const branchDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", `${diffBaseRef}..HEAD`], githubToken, gitUsername);
    const changedFiles = await this.collectChangedFiles(workspacePath, diffBaseRef, githubToken, gitUsername);
    const commitSha = await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);

    return { branchDiff, changedFiles, commitSha, providerCommitted: false };
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

  async createBuildRunChangeProposal(task: Task, runId: string, workspacePath: string): Promise<void> {
    const run = await this.taskStore.getRun(runId);
    if (!run || run.taskId !== task.id) {
      return;
    }
    const fromRef = run.changeProposalCheckpointRef?.trim();
    if (!fromRef) {
      return;
    }

    const runtimeCredentials = await this.settingsStore.getRuntimeCredentials();
    const { githubToken, gitUsername } = runtimeCredentials;
    const exists = await access(workspacePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return;
    }

    const { diff, diffStat, changedFiles, diffTruncated, toRef } = await this.collectDiffRangeVersusHead(
      workspacePath,
      fromRef,
      githubToken,
      gitUsername
    );

    if (changedFiles.length === 0) {
      await this.taskStore.appendLog(task.id, `Build run ${runId}: no changes since checkpoint; checkpoint not created.`);
      return;
    }

    const createdAt = new Date().toISOString();
    const untrackedPathsAtCheckpoint = Array.isArray(run.changeProposalUntrackedPaths) ? run.changeProposalUntrackedPaths : [];

    const proposal = await this.taskStore.createChangeProposal({
      id: nanoid(),
      taskId: task.id,
      sourceType: "build_run",
      sourceId: runId,
      status: "pending",
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
    }
  }

  async beginInteractiveTerminalSession(taskId: string): Promise<{ sessionId: string }> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (task.status === "archived") {
      throw new Error("Archived tasks are read-only.");
    }
    if (isQueuedTaskStatus(task.status) || isActiveTaskStatus(task.status)) {
      throw new Error(
        `Terminal unavailable while the task is “${getTaskStatusLabel(task.status)}”. Finish or cancel that run first (one action at a time).`
      );
    }
    if (await this.taskStore.hasPendingChangeProposal(taskId)) {
      throw new Error("Apply or reject the pending checkpoint before opening a terminal.");
    }
    if (await this.taskStore.getActiveInteractiveSession(taskId)) {
      throw new Error("An interactive terminal session is already active for this task.");
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
      untrackedPathsAtCheckpoint
    });
    await this.taskStore.appendMessage(taskId, {
      role: "system",
      content: "Interactive terminal session started."
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
        content: "Interactive terminal session ended."
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
        content: "Interactive terminal session ended. No workspace changes were detected."
      });
      await this.taskStore.appendLog(taskId, "Terminal session ended with no workspace changes; checkpoint not created.");
      return;
    }

    await this.taskStore.appendMessage(taskId, {
      role: "system",
      content: "Interactive terminal session ended. Review proposed changes below."
    });

    const proposal = await this.taskStore.createChangeProposal({
      id: nanoid(),
      taskId,
      sourceType: "interactive_session",
      sourceId: sessionId,
      status: "pending",
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
    }
  }

  /**
   * After an interactive terminal session, changes are only in the working tree.
   * On apply, mirror {@link finalizeBuild}: strip `.agentswarm`, stage all, and commit when needed.
   */
  private async commitWorkspaceAfterInteractiveCheckpointApply(
    task: Task,
    workspacePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ didCommit: boolean }> {
    await rm(path.join(workspacePath, ".agentswarm"), { recursive: true, force: true }).catch(() => undefined);
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

    await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], githubToken, gitUsername);
    const generatedSubject = await this.buildGeneratedCommitSubject(task, workspacePath, githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", generatedSubject], githubToken, gitUsername);
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
    await rm(path.join(workspacePath, ".agentswarm"), { recursive: true, force: true }).catch(() => undefined);
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

    await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], githubToken, gitUsername);
    const shortId = proposalId.slice(0, 8);
    const subject = this.toCommitSubject(`revert(agentswarm): undo checkpoint ${shortId}`);
    await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", subject], githubToken, gitUsername);
    return { didCommit: true };
  }

  /** After re-applying a reverted checkpoint, stage and commit so the branch stays clean (same pattern as revert). */
  private async commitWorkspaceAfterCheckpointReapply(
    workspacePath: string,
    proposalId: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ didCommit: boolean }> {
    await rm(path.join(workspacePath, ".agentswarm"), { recursive: true, force: true }).catch(() => undefined);
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

    await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], githubToken, gitUsername);
    const shortId = proposalId.slice(0, 8);
    const subject = this.toCommitSubject(`reapply(agentswarm): checkpoint ${shortId}`);
    await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", subject], githubToken, gitUsername);
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

  async applyChangeProposal(task: Task, proposalId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    const checkpointBlocked = getCheckpointMutationBlockedReason(task.status);
    if (checkpointBlocked) {
      return { ok: false, message: checkpointBlocked };
    }
    if (proposal.status !== "pending" && proposal.status !== "reverted") {
      return { ok: false, message: "Checkpoint must be pending or reverted to apply." };
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

    if (proposal.sourceType === "interactive_session") {
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
          ? await this.commitWorkspaceAfterCheckpointReapply(workspacePath, proposalId, githubToken, gitUsername)
          : await this.commitWorkspaceAfterInteractiveCheckpointApply(
              task,
              workspacePath,
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
        await this.taskStore.updateChangeProposalStatus(proposalId, "applied", task.id);
        await this.taskStore.appendLog(
          task.id,
          isReapply
            ? didCommit
              ? `Checkpoint ${proposalId} re-applied; committed for a clean branch.`
              : `Checkpoint ${proposalId} re-applied; tree already matched HEAD after staging.`
            : didCommit
              ? `Checkpoint ${proposalId} applied; created local commit (same flow as after a build).`
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

    if (isReapply && proposal.sourceType === "build_run") {
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
        const { didCommit } = await this.commitWorkspaceAfterCheckpointReapply(
          workspacePath,
          proposalId,
          githubToken,
          gitUsername
        );
        const clean = await this.assertReapplyWorkspaceCleanOrCommitted(
          workspacePath,
          didCommit,
          githubToken,
          gitUsername
        );
        if (!clean.ok) {
          return { ok: false, message: clean.message };
        }
        await this.taskStore.updateChangeProposalStatus(proposalId, "applied", task.id);
        await this.taskStore.appendLog(
          task.id,
          didCommit
            ? `Checkpoint ${proposalId} re-applied; committed for a clean branch.`
            : `Checkpoint ${proposalId} re-applied; tree already matched HEAD after staging.`
        );
        return { ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          message: `Re-applied changes but committing failed: ${detail}. Checkpoint not marked applied.`
        };
      }
    }

    await this.taskStore.updateChangeProposalStatus(proposalId, "applied", task.id);
    await this.taskStore.appendLog(
      task.id,
      isReapply
        ? `Checkpoint ${proposalId} re-applied (changes kept in workspace).`
        : `Checkpoint ${proposalId} applied (changes kept in workspace).`
    );
    return { ok: true };
  }

  /** Alias for `applyChangeProposal` (same HTTP route kept for compatibility). */
  async acceptChangeProposal(task: Task, proposalId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.applyChangeProposal(task, proposalId);
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

    try {
      await this.gitCommand(
        ["-C", workspacePath, "restore", `--source=${fromRef}`, "--worktree", "--", ...unique],
        githubToken,
        gitUsername
      );
    } catch {
      await this.gitCommand(["-C", workspacePath, "checkout", fromRef, "--", ...unique], githubToken, gitUsername);
      await this.gitCommand(["-C", workspacePath, "reset", "HEAD", "--", ...unique], githubToken, gitUsername);
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

  async revertChangeProposal(task: Task, proposalId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const proposal = await this.taskStore.getChangeProposal(proposalId);
    if (!proposal || proposal.taskId !== task.id) {
      return { ok: false, message: "Proposal not found." };
    }
    const checkpointBlocked = getCheckpointMutationBlockedReason(task.status);
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
    const checkpointBlocked = getCheckpointMutationBlockedReason(task.status);
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
    await this.taskStore.appendLog(
      task.id,
      `Checkpoint ${proposalId} rejected; reset to ${proposal.fromRef.slice(0, 7)}… and removed ${toRemove.length} new untracked path(s).`
    );
    return { ok: true };
  }

  async cancelTask(taskId: string): Promise<boolean> {
    this.cancelRequestedTaskIds.add(taskId);

    const execution = this.activeExecutions.get(taskId);
    if (!execution) {
      return true;
    }

    await this.taskStore.appendLog(taskId, `Spawner: stopping container ${execution.containerName} (graceful shutdown).`);

    try {
      await this.runCommand("docker", ["stop", "-t", "15", execution.containerName]);
    } catch {
      // Container may already be gone or stop may fail; force remove below.
    }

    try {
      await this.runCommand("docker", ["rm", "-f", execution.containerName]);
    } catch {
      try {
        execution.process.kill("SIGTERM");
      } catch {
        // Ignore process kill errors.
      }
    }

    return true;
  }

  async cleanupTaskArtifacts(task: Task): Promise<void> {
    const payloadDir = this.resolveRuntimePayloadDir(task.id);
    const workspacePath = this.resolveWorkspacePath(task.id);
    const taskStateRootPath = resolveTaskStateRootPaths(task.id).serverPath;
    const legacyCodexStatePath = resolveTaskProviderStatePaths(task.id, "codex").legacyServerPath;
    const legacyClaudeStatePath = resolveTaskProviderStatePaths(task.id, "claude").legacyServerPath;
    await rm(payloadDir, { recursive: true, force: true });
    await rm(workspacePath, { recursive: true, force: true });
    await rm(taskStateRootPath, { recursive: true, force: true });
    await rm(legacyCodexStatePath, { recursive: true, force: true });
    await rm(legacyClaudeStatePath, { recursive: true, force: true });
  }

  async pullTaskBranch(task: Task): Promise<Task> {
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

    await this.gitCommand(["-C", workspacePath, "fetch", "origin"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

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

      await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      const generatedSubject = await this.buildGeneratedCommitSubject(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", generatedSubject], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      createdLocalCommit = true;
    }

    if (createdLocalCommit) {
      await this.taskStore.appendLog(task.id, "Spawner: created a local commit from workspace changes before pulling.");
    }

    await this.gitCommand(["-C", workspacePath, "fetch", "origin"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    await this.gitCommand(["-C", workspacePath, "rebase", remoteRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
      async (error) => {
        await this.gitCommand(["-C", workspacePath, "rebase", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
          () => undefined
        );
        throw error;
      }
    );

    await this.taskStore.appendLog(task.id, `Spawner: pulled remote branch ${branchName} into the local workspace.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async pushTaskBranch(task: Task, options?: { commitMessage?: string | null }): Promise<Task> {
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

      await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      const custom = options?.commitMessage?.trim();
      const subject =
        custom && custom.length > 0
          ? this.toCommitSubject(custom)
          : await this.buildGeneratedCommitSubject(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", subject], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      createdLocalCommit = true;
    }

    if (createdLocalCommit) {
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
      await this.gitCommand(["-C", workspacePath, "fetch", "origin", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
        () => undefined
      );
      try {
        await this.gitCommandCapture(
          ["-C", workspacePath, "rev-parse", "--verify", `origin/${branchName}`],
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        await this.gitCommand(["-C", workspacePath, "rebase", `origin/${branchName}`], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
          async (error) => {
            await this.gitCommand(["-C", workspacePath, "rebase", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(
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
    return this.withRepoLock(repoCachePath, async () => {
      const mirrorPath = await this.ensureRepoMirror(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      const sourceRef = `refs/heads/${sourceBranch}`;
      const targetRef = `refs/heads/${normalizedTargetBranch}`;

      try {
        await this.gitCommandCapture(["--git-dir", mirrorPath, "rev-parse", "--verify", sourceRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      } catch {
        throw new Error(`Task branch ${sourceBranch} is not available on origin`);
      }

      try {
        await this.gitCommandCapture(["--git-dir", mirrorPath, "rev-parse", "--verify", targetRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      } catch {
        throw new Error(`Target branch ${normalizedTargetBranch} does not exist on origin`);
      }

      const changedFilesRaw = await this.gitCommandCapture(
        ["--git-dir", mirrorPath, "diff", "--name-only", `${targetRef}...${sourceRef}`],
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
          ["--git-dir", mirrorPath, "merge-base", "--is-ancestor", sourceRef, targetRef],
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
        ["--git-dir", mirrorPath, "merge-tree", "--write-tree", "--messages", targetRef, sourceRef],
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
    if (!workspaceExists) {
      const repoCachePath = this.resolveRepoCachePath(task);
      await this.withRepoLock(repoCachePath, async () => {
        let ensuredRepoCachePath = await this.ensureRepoMirror(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

        try {
          await mkdir(path.dirname(workspacePath), { recursive: true });
          await this.gitCommand(["clone", "--no-local", ensuredRepoCachePath, workspacePath], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        } catch (error) {
          if (!this.shouldRebuildMirror(error)) {
            throw error;
          }

          await rm(ensuredRepoCachePath, { recursive: true, force: true });
          ensuredRepoCachePath = await this.ensureRepoMirror(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
          await mkdir(path.dirname(workspacePath), { recursive: true });
          await this.gitCommand(["clone", "--no-local", ensuredRepoCachePath, workspacePath], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        }
      });
    }

    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", task.repoUrl], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

    if (await this.localBranchExists(workspacePath, branchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername)) {
      await this.gitCommand(["-C", workspacePath, "checkout", branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.pushTaskBranch(task);
    }

    await this.gitCommand(["-C", workspacePath, "fetch", "origin", targetBranchName, branchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);

    const defaultRef = `origin/${targetBranchName}`;
    if (!(await this.refExists(workspacePath, defaultRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      throw new Error(`Target branch ${targetBranchName} does not exist on origin`);
    }

    const remoteBranchRef = `origin/${branchName}`;
    if (!(await this.refExists(workspacePath, remoteBranchRef, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      throw new Error(`Task branch ${branchName} is not available on origin`);
    }

    if (!(await this.localBranchExists(workspacePath, targetBranchName, runtimeCredentials.githubToken, runtimeCredentials.gitUsername))) {
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", targetBranchName, defaultRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } else {
      await this.gitCommand(["-C", workspacePath, "checkout", targetBranchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "reset", "--hard", defaultRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    }

    try {
      await this.gitCommand(
        ["-C", workspacePath, "merge", "--squash", "--no-commit", remoteBranchRef],
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );

      await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      const custom = options?.commitMessage?.trim();
      const subject =
        custom && custom.length > 0
          ? this.toCommitSubject(custom)
          : await this.buildGeneratedCommitSubject(task, workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
      await this.gitCommand(["-C", workspacePath, "commit", "--no-verify", "-m", subject], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    } catch (error) {
      await this.gitCommand(["-C", workspacePath, "merge", "--abort"], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(() => undefined);
      await this.gitCommand(["-C", workspacePath, "reset", "--hard", defaultRef], runtimeCredentials.githubToken, runtimeCredentials.gitUsername).catch(() => undefined);
      throw error;
    }

    await this.gitCommand(["-C", workspacePath, "push", "--no-verify", "origin", targetBranchName], runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
    await this.taskStore.appendLog(task.id, `Spawner: squash merged ${branchName} into ${targetBranchName}.`);
    return (await this.taskStore.getTask(task.id)) ?? task;
  }

  async publishAcceptedTask(task: Task): Promise<Task> {
    await this.pushTaskBranch(task);
    const accepted = await this.taskStore.setStatus(task.id, "accepted", {
      errorMessage: null,
      enqueued: false
    });
    await this.cleanupTaskArtifacts(task);
    if (!accepted) {
      throw new Error("Failed to update task after publishing");
    }
    return accepted;
  }

  /**
   * Clone/fetch and check out the task workspace only (no agent container). Used for Interactive-first flows.
   */
  async prepareTaskWorkspaceOnly(task: Task): Promise<Task> {
    const [settings, runtimeCredentials] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials()
    ]);
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
    const repoCachePath = this.resolveRepoCachePath(workingTask);

    await this.taskStore.appendLog(workingTask.id, "Spawner: preparing workspace for Interactive (clone/checkout only).");

    const { workspace } = await this.withRepoLock(repoCachePath, async () => {
      const ensuredRepoCachePath = await this.ensureRepoMirror(
        workingTask,
        runtimeCredentials.githubToken,
        runtimeCredentials.gitUsername
      );
      try {
        const prepared = await this.prepareWorkspace(
          workingTask,
          action,
          branchName,
          ensuredRepoCachePath,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        return { workspace: prepared };
      } catch (error) {
        if (!this.shouldRebuildMirror(error)) {
          throw error;
        }
        await rm(ensuredRepoCachePath, { recursive: true, force: true });
        const rebuiltRepoCachePath = await this.ensureRepoMirror(
          workingTask,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        const prepared = await this.prepareWorkspace(
          workingTask,
          action,
          branchName,
          rebuiltRepoCachePath,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        return { workspace: prepared };
      }
    });

    let nextTask = (await this.taskStore.getTask(workingTask.id)) ?? workingTask;
    if (action === "build" && !nextTask.workspaceBaseRef) {
      const patched = await this.taskStore.patchTask(workingTask.id, { workspaceBaseRef: workspace.workspaceBaseRef });
      if (patched) {
        nextTask = patched;
      }
    }

    if (action === "build") {
      const workspacePath = workspace.workspacePath;
      const gitDir = path.join(workspacePath, ".git");
      const hooksDir = path.join(gitDir, "hooks");
      await mkdir(hooksDir, { recursive: true });
      await writeFile(
        path.join(hooksDir, "pre-commit"),
        "#!/bin/sh\n# AgentSwarm: only the spawner may create commits.\nexit 1\n",
        "utf8"
      );
      await writeFile(
        path.join(hooksDir, "pre-push"),
        "#!/bin/sh\n# AgentSwarm: only the spawner may push.\nexit 1\n",
        "utf8"
      );
      await chmod(path.join(hooksDir, "pre-commit"), 0o755);
      await chmod(path.join(hooksDir, "pre-push"), 0o755);
      await this.runCommand("chmod", ["-R", "o-w", gitDir]);
      await this.taskStore.appendLog(workingTask.id, "Spawner: installed git hooks (same as automated build).");
    }

    const readyStatus = getSuccessfulStatusForAction(action);
    await this.taskStore.patchTask(workingTask.id, {
      status: readyStatus,
      enqueued: false,
      errorMessage: null,
      finishedAt: new Date().toISOString()
    });
    await this.taskStore.appendMessage(workingTask.id, {
      role: "system",
      content: "Workspace prepared and ready for changes."
    });
    await this.taskStore.appendLog(workingTask.id, `Spawner: workspace ready at ${workspace.workspacePath}.`);
    return (await this.taskStore.getTask(workingTask.id)) ?? nextTask;
  }

  async runTask(task: Task, action: TaskAction, input?: string): Promise<void> {
    this.cancelRequestedTaskIds.delete(task.id);
    const [settings, runtimeCredentials] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials()
    ]);
    const providerDefinition = getProviderRuntimeDefinition(task.provider);
    const missingCredentialMessage = providerDefinition.getMissingCredentialMessage(runtimeCredentials);
    if (missingCredentialMessage) {
      throw new Error(missingCredentialMessage);
    }

    const branchName =
      task.branchStrategy === "work_on_branch"
        ? task.baseBranch
        : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix);
    const startedAt = new Date().toISOString();
    const payloadDir = this.resolveRuntimePayloadDir(task.id);
    let runId: string | null = null;
    let workspacePath: string | null = null;

    try {
      await this.taskStore.setStatus(task.id, getActiveStatusForAction(action), {
        branchName,
        startedAt,
        finishedAt: null,
        errorMessage: null,
        enqueued: false,
        lastAction: action
      });
      const run = await this.taskStore.createRun(task.id, {
        action,
        provider: task.provider,
        providerProfile: task.providerProfile,
        modelOverride: task.modelOverride,
        branchName
      });
      runId = run?.id ?? null;
      const appendRunLog = (line: string) => this.taskStore.appendLogForRun(task.id, line, runId);
      const repoCachePath = this.resolveRepoCachePath(task);
      await appendRunLog("Spawner: preparing repository mirror and workspace.");
      const { repoProfile, workspace } = await this.withRepoLock(repoCachePath, async () => {
        const ensuredRepoCachePath = await this.ensureRepoMirror(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
        let ensuredRepoProfile = await this.ensureRepoProfile(
          task,
          ensuredRepoCachePath,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        let preparedWorkspace: WorkspacePreparation;

        try {
          preparedWorkspace = await this.prepareWorkspace(
            task,
            action,
            branchName,
            ensuredRepoCachePath,
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          );
        } catch (error) {
          if (!this.shouldRebuildMirror(error)) {
            throw error;
          }

          await appendRunLog("Spawner: local repo cache looked inconsistent; rebuilding mirror and retrying workspace preparation.");
          await rm(ensuredRepoCachePath, { recursive: true, force: true });
          const rebuiltRepoCachePath = await this.ensureRepoMirror(task, runtimeCredentials.githubToken, runtimeCredentials.gitUsername);
          ensuredRepoProfile = await this.ensureRepoProfile(
            task,
            rebuiltRepoCachePath,
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          );
          preparedWorkspace = await this.prepareWorkspace(
            task,
            action,
            branchName,
            rebuiltRepoCachePath,
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          );
        }

        return {
          repoProfile: ensuredRepoProfile,
          workspace: preparedWorkspace
        };
      });
      workspacePath = workspace.workspacePath;
      if (action === "build" && !task.workspaceBaseRef) {
        await this.taskStore.patchTask(task.id, { workspaceBaseRef: workspace.workspaceBaseRef });
      }
      const runtimeMcpEnv = this.collectRuntimeMcpEnv(settings.mcpServers);
      const providerConfigPath = path.join(payloadDir, providerDefinition.configFileName);
      const resultMarkdownPath = path.join(payloadDir, "result.md");
      const resultJsonPath = path.join(payloadDir, "result.json");
      const resolvedProfileSettings = providerDefinition.getResolvedProfileSettings(task.providerProfile);
      const manifest: RuntimeManifest = {
        taskId: task.id,
        provider: task.provider,
        taskType: task.taskType,
        action,
        title: task.title,
        prompt: task.prompt,
        executionSummary: task.executionSummary,
        repoProfile,
        input: input ?? "",
        baseBranch: task.baseBranch,
        repoDefaultBranch: task.repoDefaultBranch,
        branchStrategy: task.branchStrategy,
        branchName,
        providerProfile: task.providerProfile,
        modelOverride: task.modelOverride,
        resolvedModel: providerDefinition.getResolvedModel(task.modelOverride, task.providerProfile),
        resolvedReasoningEffort: resolvedProfileSettings.reasoningEffort,
        resolvedMaxTurns: resolvedProfileSettings.maxTurns,
        workspacePath: workspace.workspacePath,
        resultMarkdownPath,
        resultJsonPath,
        providerConfigPath
      };
      await appendRunLog(`Spawner: preparing ${task.provider} runtime image (${action}).`);
      await this.ensureRuntimeImage(task.provider);
      await appendRunLog("Spawner: refreshing repository mirror cache.");
      await appendRunLog(`Spawner: repository mirror ready at ${repoCachePath}.`);
      await appendRunLog("Spawner: repository profile ready.");
      await appendRunLog(`Spawner: managed workspace ready at ${workspace.workspacePath}.`);

      const payloadPaths = await this.writeRuntimePayloadFiles(manifest, providerDefinition.getProviderConfig(settings.mcpServers));
      await appendRunLog(`Spawner: runtime payload files ready at ${payloadDir}.`);

      if (action === "build") {
        const gitDir = path.join(workspace.workspacePath, ".git");
        const hooksDir = path.join(gitDir, "hooks");
        await mkdir(hooksDir, { recursive: true });
        await writeFile(
          path.join(hooksDir, "pre-commit"),
          "#!/bin/sh\n# AgentSwarm: only the spawner may create commits.\nexit 1\n",
          "utf8"
        );
        await writeFile(
          path.join(hooksDir, "pre-push"),
          "#!/bin/sh\n# AgentSwarm: only the spawner may push.\nexit 1\n",
          "utf8"
        );
        await chmod(path.join(hooksDir, "pre-commit"), 0o755);
        await chmod(path.join(hooksDir, "pre-push"), 0o755);
        await this.runCommand("chmod", ["-R", "o-w", gitDir]);
        await appendRunLog("Spawner: installed git hooks and restricted .git so only the spawner can add/commit/push.");
      }

      await appendRunLog(
        `Spawner: runtime config includes provider=${task.provider}, profile=${task.providerProfile}, and ${settings.mcpServers.length} MCP server${settings.mcpServers.length === 1 ? "" : "s"}.`
      );

      if (this.isCancellationRequested(task.id)) {
        throw new CancelledTaskError();
      }

      if (runId && action === "build") {
        const checkpointRef = (
          await this.gitCommandCapture(
            ["-C", workspace.workspacePath, "rev-parse", "HEAD"],
            runtimeCredentials.githubToken,
            runtimeCredentials.gitUsername
          )
        ).trim();
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

      const containerName = `agentswarm-task-${task.id}`;
      const workspaceMountMode = action === "ask" ? "ro" : "rw";
      const hostWorkspacePath = this.resolveWorkspaceHostPath(task.id);
      const providerStateContainerPath = this.resolveProviderStateContainerPath(task.provider);
      const providerStatePaths = await ensureTaskProviderStatePaths(task.id, task.provider);
      if (workspaceMountMode === "ro") {
        await appendRunLog("Spawner: mounting workspace read-only (ask mode).");
      }
      const args = [
        "run",
        "--rm",
        "--name",
        containerName,
        "-v",
        `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
        "-v",
        `${env.TASK_WORKSPACE_HOST_ROOT}:${env.TASK_WORKSPACE_ROOT}:${workspaceMountMode}`,
        "-v",
        `${providerStatePaths.hostPath}:${providerStateContainerPath}:rw`,
        "-e",
        `TASK_MANIFEST_FILE=${payloadPaths.manifestPath}`,
        "-e",
        `PROVIDER_CONFIG_FILE=${payloadPaths.providerConfigPath}`,
        "-e",
        `TASK_WORKSPACE_PATH=${hostWorkspacePath}`,
        "-e",
        `TASK_WORSPACE_PATH=${hostWorkspacePath}`,
        "-e",
        `TASK_PROVIDER_STATE_PATH=${providerStateContainerPath}`,
        "-e",
        `TASK_PROVIDER_HOME=${path.dirname(providerStateContainerPath)}`,
        providerDefinition.image
      ];

      const providerRuntimeEnv = providerDefinition.getRuntimeEnv(runtimeCredentials);
      for (const [name, value] of Object.entries(providerRuntimeEnv)) {
        if (value) {
          args.splice(args.length - 1, 0, "-e", `${name}=${value}`);
        }
      }
      for (const [name, value] of Object.entries(runtimeMcpEnv)) {
        args.splice(args.length - 1, 0, "-e", `${name}=${value}`);
      }

      await appendRunLog(`Spawner: launching ${task.provider} container for branch ${branchName}.`);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
        this.activeExecutions.set(task.id, { containerName, process: proc });

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
          this.activeExecutions.delete(task.id);

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

      if (this.isCancellationRequested(task.id)) {
        throw new CancelledTaskError();
      }

      const runtimeResult = await this.readRuntimeResult(payloadPaths.resultMarkdownPath, payloadPaths.resultJsonPath);
      const finishedAt = new Date().toISOString();

      if (action === "ask") {
        const finalMarkdown = runtimeResult.summaryMarkdown.trim();
        if (finalMarkdown.length === 0) {
          throw new Error(`${action} action returned empty markdown output`);
        }

        const branchDiff = null;
        await this.taskStore.updateResultArtifacts(task.id, finalMarkdown);
        await this.taskStore.setStatus(task.id, getSuccessfulStatusForAction(action), {
          finishedAt,
          enqueued: false,
          branchDiff,
          lastAction: action
        });
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
      } else {
        const diffBaseRef = task.workspaceBaseRef ?? workspace.workspaceBaseRef;
        const { branchDiff, providerCommitted } = await this.finalizeBuild(
          task,
          workspace.workspacePath,
          diffBaseRef,
          workspace.startRef,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        if (providerCommitted) {
          await appendRunLog("Spawner: detected provider-created local commit; reusing it instead of creating a new commit.");
        }
        if (runtimeResult.summaryMarkdown.trim()) {
          await this.taskStore.updateResultArtifacts(task.id, runtimeResult.summaryMarkdown.trim());
        }
        await this.taskStore.setStatus(task.id, getSuccessfulStatusForAction(action), {
          finishedAt,
          enqueued: false,
          branchDiff: branchDiff.length > 0 ? branchDiff : task.branchDiff,
          lastAction: action,
          branchName
        });
        await this.taskStore.appendMessage(task.id, {
          role: "assistant",
          action,
          content:
            runtimeResult.summaryMarkdown.trim() ||
            "Build completed locally. Review the diff, then push the branch when ready."
        });
        if (runId) {
          await this.taskStore.updateRun(runId, {
            status: "succeeded",
            finishedAt,
            summary: runtimeResult.summaryMarkdown.trim() || "Build completed locally. Review the diff and push when ready."
          });
        }
        if (runId && action === "build") {
          await this.createBuildRunChangeProposal(task, runId, workspace.workspacePath);
        }
      }

      await appendRunLog("Spawner: task finished successfully.");
    } catch (error) {
      if (runId) {
        const message = error instanceof Error ? error.message : "Unknown runtime error";
        const isCancelled = error instanceof CancelledTaskError;
        await this.taskStore.updateRun(runId, {
          status: isCancelled ? "cancelled" : "failed",
          finishedAt: new Date().toISOString(),
          errorMessage: isCancelled ? null : message,
          summary: isCancelled ? "Task cancelled by user." : null
        });
      }
      throw error;
    } finally {
      this.activeExecutions.delete(task.id);
      this.cancelRequestedTaskIds.delete(task.id);
      if (workspacePath) {
        await this.cleanupWorkspaceGitLocks(workspacePath).catch(() => undefined);
      }
      await rm(payloadDir, { recursive: true, force: true });
    }
  }
}

export class CancelledTaskError extends Error {
  constructor() {
    super("Task cancelled by user");
    this.name = "CancelledTaskError";
  }
}
