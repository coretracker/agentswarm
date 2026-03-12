import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getActiveStatusForAction,
  getSuccessfulStatusForAction,
  type AgentProvider,
  type McpServerConfig,
  type Task,
  type TaskAction,
  type TaskReviewVerdict
} from "@agentswarm/shared-types";
import { makeBranchName } from "../lib/branch.js";
import { env } from "../config/env.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";
import { TaskStore } from "./task-store.js";
import { SettingsStore } from "./settings-store.js";
import { RepositoryStore } from "./repository-store.js";

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
  requirements: string;
  planMarkdown: string;
  executionSummary: string;
  repoProfile: string;
  iterationInput: string;
  agentRules: string;
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
  reviewVerdict?: TaskReviewVerdict | null;
  changedFiles?: string[];
  metadata?: Record<string, unknown>;
}

interface WorkspacePreparation {
  workspacePath: string;
  startRef: string;
}

export class SpawnerService {
  private readonly runtimeReady = new Set<AgentProvider>();
  private activeExecutions = new Map<string, { containerName: string; process: ReturnType<typeof spawn> }>();
  private cancelRequestedTaskIds = new Set<string>();
  private gitAskPassPath: string | null = null;
  private repoLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly taskStore: TaskStore,
    private readonly settingsStore: SettingsStore,
    private readonly repositoryStore: RepositoryStore
  ) {}

  private buildMergedAgentRules(globalRules: string, repositoryRules: string): string {
    const sections = [
      globalRules.trim() ? `Global Rules:\n${globalRules.trim()}` : "",
      repositoryRules.trim() ? `Repository Rules:\n${repositoryRules.trim()}` : ""
    ].filter(Boolean);

    return sections.join("\n\n");
  }

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
    const askPassPath = githubToken ? await this.ensureGitAskPassScript() : null;
    const gitEnv: NodeJS.ProcessEnv = askPassPath
      ? {
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: askPassPath,
          GIT_USERNAME: gitUsername,
          GIT_TOKEN: githubToken ?? ""
        }
      : {};

    if (args[0] === "-C" && typeof args[1] === "string" && args[1].startsWith("/")) {
      gitEnv.GIT_CONFIG_COUNT = "1";
      gitEnv.GIT_CONFIG_KEY_0 = "safe.directory";
      gitEnv.GIT_CONFIG_VALUE_0 = args[1];
    }

    return gitEnv;
  }

  private async gitCommand(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<void> {
    await this.runCommand("git", args, await this.buildGitEnv(args, githubToken, gitUsername));
  }

  private async gitCommandCapture(args: string[], githubToken?: string | null, gitUsername = "x-access-token"): Promise<string> {
    return this.runCommandCapture("git", args, await this.buildGitEnv(args, githubToken, gitUsername));
  }

  private async withRepoLock<T>(repoKey: string, fn: () => Promise<T>): Promise<T> {
    const current = this.repoLocks.get(repoKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.repoLocks.set(repoKey, current.then(() => next));
    await current;

    try {
      return await fn();
    } finally {
      release();
      if (this.repoLocks.get(repoKey) === next) {
        this.repoLocks.delete(repoKey);
      }
    }
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

  private resolveLocalPlanPath(task: Task): string {
    if (task.planPath?.startsWith(env.LOCAL_PLANS_ROOT)) {
      return task.planPath;
    }

    const repoSlug = sanitizePathSegment(task.repoName || task.repoId || "repo").replace(/\//g, "-");
    const plansDir = sanitizePathSegment(task.repoPlansDir || "plans");
    return path.join(env.LOCAL_PLANS_ROOT, repoSlug, plansDir, `${task.id}.md`);
  }

  private resolveRuntimePayloadDir(taskId: string): string {
    return path.join(env.RUNTIME_PAYLOAD_ROOT, taskId);
  }

  private resolveWorkspacePath(taskId: string): string {
    return path.join(env.TASK_WORKSPACE_ROOT, taskId);
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

  private buildRepoProfileSummary(baseBranch: string, headSha: string, topLevelEntries: string[], rootPackageJson: string | null, workspacePackageSummaries: string[]): string {
    const lines = [
      "# Repo Profile",
      `- Base branch: ${baseBranch}`,
      `- Head: ${headSha.slice(0, 12)}`,
      `- Top-level entries: ${truncate(topLevelEntries.slice(0, 16).join(", ") || "(unknown)", 240)}`
    ];

    if (rootPackageJson) {
      try {
        const parsed = JSON.parse(rootPackageJson) as { scripts?: Record<string, string>; workspaces?: string[] | { packages?: string[] } };
        const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 8);
        const workspacePatterns = Array.isArray(parsed.workspaces)
          ? parsed.workspaces
          : parsed.workspaces?.packages ?? [];

        if (scripts.length > 0) {
          lines.push(`- Root scripts: ${scripts.join(", ")}`);
        }
        if (workspacePatterns.length > 0) {
          lines.push(`- Workspaces: ${workspacePatterns.slice(0, 8).join(", ")}`);
        }
      } catch {
        // Best effort only.
      }
    }

    if (workspacePackageSummaries.length > 0) {
      lines.push(`- Package summaries: ${workspacePackageSummaries.join(" | ")}`);
    }

    lines.push("- Use deterministic search before broad exploration.");
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

    const topLevelEntriesRaw = await this.gitCommandCapture(["--git-dir", mirrorPath, "ls-tree", "--name-only", ref], githubToken, gitUsername);
    const topLevelEntries = topLevelEntriesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);

    const rootPackageJson = await this.readGitFile(mirrorPath, ref, "package.json", githubToken, gitUsername);
    const packagePathsRaw = await this.gitCommandCapture(["--git-dir", mirrorPath, "ls-tree", "-r", "--name-only", ref], githubToken, gitUsername);
    const workspacePackagePaths = packagePathsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(apps|packages|services)\//.test(line) && line.endsWith("/package.json"))
      .slice(0, 6);

    const workspacePackageSummaries: string[] = [];
    for (const packagePath of workspacePackagePaths) {
      const packageJson = await this.readGitFile(mirrorPath, ref, packagePath, githubToken, gitUsername);
      if (!packageJson) {
        continue;
      }

      try {
        const parsed = JSON.parse(packageJson) as { name?: string; scripts?: Record<string, string> };
        const scripts = Object.keys(parsed.scripts ?? {}).filter((name) => ["build", "test", "lint", "dev", "start"].includes(name)).slice(0, 4);
        workspacePackageSummaries.push(`${parsed.name ?? packagePath}: ${scripts.join("/") || "no common scripts"}`);
      } catch {
        workspacePackageSummaries.push(packagePath);
      }
    }

    const summary = this.buildRepoProfileSummary(task.baseBranch, headSha, topLevelEntries, rootPackageJson, workspacePackageSummaries);
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

  private async prepareWorkspace(
    task: Task,
    action: TaskAction,
    branchName: string,
    repoCachePath: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<WorkspacePreparation> {
    const workspacePath = this.resolveWorkspacePath(task.id);
    await rm(workspacePath, { recursive: true, force: true });
    await mkdir(path.dirname(workspacePath), { recursive: true });

    await this.gitCommand(["clone", "--no-local", repoCachePath, workspacePath], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "remote", "set-url", "origin", task.repoUrl], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "fetch", "origin", task.baseBranch], githubToken, gitUsername);

    if (action === "review" && task.repoDefaultBranch !== task.baseBranch) {
      await this.gitCommand(["-C", workspacePath, "fetch", "origin", task.repoDefaultBranch], githubToken, gitUsername);
    }

    if (action === "build") {
      if (task.branchStrategy === "work_on_branch") {
        await this.gitCommand(["-C", workspacePath, "checkout", "-B", task.baseBranch, `origin/${task.baseBranch}`], githubToken, gitUsername);
      } else if (await this.remoteBranchExists(task.repoUrl, branchName, githubToken, gitUsername)) {
        await this.gitCommand(["-C", workspacePath, "fetch", "origin", branchName], githubToken, gitUsername);
        await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, `origin/${branchName}`], githubToken, gitUsername);
      } else {
        await this.gitCommand(["-C", workspacePath, "checkout", "-B", branchName, `origin/${task.baseBranch}`], githubToken, gitUsername);
      }
    } else {
      await this.gitCommand(["-C", workspacePath, "checkout", "-B", task.baseBranch, `origin/${task.baseBranch}`], githubToken, gitUsername);
    }

    const startRef = await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "HEAD"], githubToken, gitUsername);
    return { workspacePath, startRef };
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

  private async finalizeBuild(
    task: Task,
    workspacePath: string,
    branchName: string,
    startRef: string,
    githubToken?: string | null,
    gitUsername = "x-access-token"
  ): Promise<{ branchDiff: string; changedFiles: string[] }> {
    await this.gitCommand(["-C", workspacePath, "add", "-A"], githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "diff", "--cached", "--quiet"], githubToken, gitUsername);
      throw new Error("No changes detected after provider execution");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("exited with code 1")) {
        throw error;
      }
    }

    await this.gitCommand(["-C", workspacePath, "config", "user.name", env.GIT_USER_NAME], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "config", "user.email", env.GIT_USER_EMAIL], githubToken, gitUsername);
    await this.gitCommand(["-C", workspacePath, "commit", "-m", `feat(agentswarm): ${task.title}`], githubToken, gitUsername);

    const branchDiff = await this.gitCommandCapture(["-C", workspacePath, "diff", `${startRef}..HEAD`], githubToken, gitUsername);
    const changedFiles = await this.collectChangedFiles(workspacePath, startRef, githubToken, gitUsername);

    try {
      await this.gitCommand(["-C", workspacePath, "push", "-u", "origin", branchName], githubToken, gitUsername);
    } catch {
      await this.gitCommand(["-C", workspacePath, "fetch", "origin", branchName], githubToken, gitUsername).catch(() => undefined);
      try {
        await this.gitCommandCapture(["-C", workspacePath, "rev-parse", "--verify", `origin/${branchName}`], githubToken, gitUsername);
        await this.gitCommand(["-C", workspacePath, "rebase", `origin/${branchName}`], githubToken, gitUsername).catch(async (error) => {
          await this.gitCommand(["-C", workspacePath, "rebase", "--abort"], githubToken, gitUsername).catch(() => undefined);
          throw error;
        });
      } catch {
        // origin/<branch> may not exist yet; ignore.
      }
      await this.gitCommand(["-C", workspacePath, "push", "-u", "origin", branchName], githubToken, gitUsername);
    }

    return { branchDiff, changedFiles };
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

  async cancelTask(taskId: string): Promise<boolean> {
    this.cancelRequestedTaskIds.add(taskId);

    const execution = this.activeExecutions.get(taskId);
    if (!execution) {
      return true;
    }

    await this.taskStore.appendLog(taskId, `Spawner: stopping container ${execution.containerName}.`);

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

  async runTask(task: Task, action: TaskAction, iterateInput?: string): Promise<void> {
    this.cancelRequestedTaskIds.delete(task.id);
    const [settings, runtimeCredentials, repository] = await Promise.all([
      this.settingsStore.getSettings(),
      this.settingsStore.getRuntimeCredentials(),
      this.repositoryStore.getRepository(task.repoId)
    ]);
    const providerDefinition = getProviderRuntimeDefinition(task.provider);
    const missingCredentialMessage = providerDefinition.getMissingCredentialMessage(runtimeCredentials);
    if (missingCredentialMessage) {
      throw new Error(missingCredentialMessage);
    }

    const mergedAgentRules = this.buildMergedAgentRules(settings.agentRules, repository?.rules ?? "");
    const branchName =
      action === "build"
        ? task.branchStrategy === "work_on_branch"
          ? task.baseBranch
          : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix)
        : task.taskType === "review" || task.taskType === "ask"
          ? task.baseBranch
          : task.branchName ?? makeBranchName(task.title, task.id, settings.branchPrefix);
    const startedAt = new Date().toISOString();
    const planPath = this.resolveLocalPlanPath(task);

    const repoCachePath = this.resolveRepoCachePath(task);
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

        await this.taskStore.appendLog(task.id, "Spawner: local repo cache looked inconsistent; rebuilding mirror and retrying workspace preparation.");
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
    const runtimeMcpEnv = this.collectRuntimeMcpEnv(settings.mcpServers);
    const payloadDir = this.resolveRuntimePayloadDir(task.id);

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
      requirements: task.requirements,
      planMarkdown: task.planMarkdown ?? "",
      executionSummary: task.executionSummary,
      repoProfile,
      iterationInput: iterateInput ?? "",
      agentRules: mergedAgentRules,
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

    try {
      await this.taskStore.setStatus(task.id, getActiveStatusForAction(action), {
        branchName,
        startedAt,
        finishedAt: null,
        errorMessage: null,
        enqueued: false,
        lastAction: action,
        latestIterationInput: action === "iterate" ? iterateInput ?? task.latestIterationInput : task.latestIterationInput,
        planPath
      });
      await this.taskStore.appendLog(task.id, `Spawner: preparing ${task.provider} runtime image (${action}).`);
      await this.ensureRuntimeImage(task.provider);
      await this.taskStore.appendLog(task.id, "Spawner: refreshing repository mirror cache.");
      await this.taskStore.appendLog(task.id, `Spawner: repository mirror ready at ${repoCachePath}.`);
      await this.taskStore.appendLog(task.id, "Spawner: repository profile ready.");
      await this.taskStore.appendLog(task.id, `Spawner: managed workspace ready at ${workspace.workspacePath}.`);

      const payloadPaths = await this.writeRuntimePayloadFiles(manifest, providerDefinition.getProviderConfig(settings.mcpServers));
      await this.taskStore.appendLog(task.id, `Spawner: runtime payload files ready at ${payloadDir}.`);
      await this.taskStore.appendLog(
        task.id,
        `Spawner: runtime config includes provider=${task.provider}, profile=${task.providerProfile}, ${settings.mcpServers.length} MCP server${settings.mcpServers.length === 1 ? "" : "s"}, ${settings.agentRules.trim() ? "global rules" : "no global rules"}, and ${repository?.rules?.trim() ? "repository rules" : "no repository rules"}.`
      );

      if (this.isCancellationRequested(task.id)) {
        throw new CancelledTaskError();
      }

      const containerName = `agentswarm-task-${task.id}`;
      const args = [
        "run",
        "--rm",
        "--name",
        containerName,
        "-v",
        `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
        "-v",
        `${env.TASK_WORKSPACE_HOST_ROOT}:${env.TASK_WORKSPACE_ROOT}:rw`,
        "-e",
        `TASK_MANIFEST_FILE=${payloadPaths.manifestPath}`,
        "-e",
        `PROVIDER_CONFIG_FILE=${payloadPaths.providerConfigPath}`,
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

      await this.taskStore.appendLog(task.id, `Spawner: launching ${task.provider} container for branch ${branchName}.`);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
        this.activeExecutions.set(task.id, { containerName, process: proc });

        let stdoutRemainder = "";
        let stderrRemainder = "";
        const processLine = (prefix: "stdout" | "stderr", line: string): void => {
          if (line.trim().length > 0) {
            void this.taskStore.appendLog(task.id, `[${prefix}] ${line}`);
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

      if (action === "plan" || action === "iterate") {
        const finalMarkdown = runtimeResult.summaryMarkdown.trim();
        if (finalMarkdown.length === 0) {
          throw new Error(`${action} action returned empty markdown output`);
        }

        await mkdir(path.dirname(planPath), { recursive: true });
        await writeFile(planPath, `${finalMarkdown}\n`, "utf8");
        await this.taskStore.appendLog(task.id, `Spawner: stored local plan file at ${planPath}`);
        await this.taskStore.updatePlanArtifacts(task.id, planPath, finalMarkdown);
        await this.taskStore.setStatus(task.id, getSuccessfulStatusForAction(action), {
          finishedAt,
          enqueued: false,
          branchDiff: null,
          lastAction: action
        });
      } else if (action === "review" || action === "ask") {
        const finalMarkdown = runtimeResult.summaryMarkdown.trim();
        if (finalMarkdown.length === 0) {
          throw new Error(`${action} action returned empty markdown output`);
        }

        const branchDiff = action === "review"
          ? await this.collectReviewDiff(task, workspace.workspacePath, runtimeCredentials.githubToken, runtimeCredentials.gitUsername)
          : null;
        await this.taskStore.updateResultArtifacts(task.id, finalMarkdown, runtimeResult.reviewVerdict ?? null);
        await this.taskStore.setStatus(task.id, getSuccessfulStatusForAction(action), {
          finishedAt,
          enqueued: false,
          branchDiff,
          lastAction: action
        });
      } else {
        const { branchDiff } = await this.finalizeBuild(
          task,
          workspace.workspacePath,
          branchName,
          workspace.startRef,
          runtimeCredentials.githubToken,
          runtimeCredentials.gitUsername
        );
        if (runtimeResult.summaryMarkdown.trim()) {
          await this.taskStore.updateResultArtifacts(task.id, runtimeResult.summaryMarkdown.trim(), null);
        }
        await this.taskStore.setStatus(task.id, getSuccessfulStatusForAction(action), {
          finishedAt,
          enqueued: false,
          branchDiff: branchDiff.length > 0 ? branchDiff : task.branchDiff,
          lastAction: action,
          branchName
        });
      }

      await this.taskStore.appendLog(task.id, "Spawner: task finished successfully.");
    } finally {
      this.activeExecutions.delete(task.id);
      this.cancelRequestedTaskIds.delete(task.id);
      await rm(payloadDir, { recursive: true, force: true });
      await rm(workspace.workspacePath, { recursive: true, force: true });
    }
  }
}

export class CancelledTaskError extends Error {
  constructor() {
    super("Task cancelled by user");
    this.name = "CancelledTaskError";
  }
}
