import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const booleanEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/verft"),
  EVENT_CHANNEL: z.string().default("verft:events"),
  REPO_CACHE_ROOT: z.string().default("/repo-cache"),
  REPO_CACHE_VOLUME: z.string().default("verft_repo_cache"),
  VERFT_BASE_VOLUME: z.string().default("verft_base"),
  RUNTIME_PAYLOAD_ROOT: z.string().default("/runtime-payloads"),
  RUNTIME_PAYLOAD_VOLUME: z.string().default("verft_runtime_payloads"),
  REPOSITORY_ENV_FILE_STORE_ROOT: z.string().default("/secrets/repository-env-files"),
  TASK_WORKSPACE_ROOT: z.string().default("/task-workspaces"),
  TASK_WORKSPACE_DOCKER_SOURCE: z.string().optional(),
  TASK_WORKSPACE_HOST_SOURCE: z.string().optional(),
  AGENT_RUNTIME_IMAGE: z
    .string()
    .default(
      process.env.CODEX_RUNTIME_IMAGE?.trim() ||
        process.env.CLAUDE_RUNTIME_IMAGE?.trim() ||
        "verft-agent-toolbox:latest"
    ),
  SECRET_KEY_PATH: z.string().default("/secrets/verft.key"),
  CORS_ORIGIN: z.string().default("http://localhost:3217"),
  DEFAULT_ADMIN_NAME: z.string().default("Administrator"),
  DEFAULT_ADMIN_EMAIL: z.string().email().default("admin@verft.local"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default("admin123!"),
  AUTH_COOKIE_NAME: z.string().default("verft_session"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  LOG_REQUESTS: booleanEnv.default(false),
  /** When true, toolbox runtime containers can receive Docker socket access. */
  DOCKER_SOCKET_ACCESS_ENABLED: booleanEnv.default(true),
  /** Host path for docker.sock mount source. */
  DOCKER_SOCKET_HOST_PATH: z.string().default("/var/run/docker.sock"),
  /** Container path for docker.sock mount target in Codex runtime containers. */
  DOCKER_SOCKET_CONTAINER_PATH_CODEX: z.string().default("/var/run/docker.sock"),
  /** Container path for docker.sock mount target in Claude runtime containers. */
  DOCKER_SOCKET_CONTAINER_PATH_CLAUDE: z.string().default("/var/run/docker.sock")
});

const parsed = envSchema.parse(process.env);

type DockerMount = {
  Type?: string;
  Source?: string;
  Destination?: string;
  Name?: string;
};

function resolveOwnDockerMountSource(containerPath: string): string | null {
  try {
    const output = execFileSync("docker", ["inspect", hostname(), "--format", "{{json .Mounts}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim();
    const mounts = JSON.parse(output) as DockerMount[];
    const mount = mounts.find((candidate) => candidate.Destination === containerPath);
    if (mount?.Type === "bind" && mount.Source) {
      return mount.Source;
    }
    if (mount?.Type === "volume" && mount.Name) {
      return mount.Name;
    }
  } catch {
    return null;
  }
  return null;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const configuredTaskWorkspaceDockerSource = parsed.TASK_WORKSPACE_DOCKER_SOURCE?.trim();
const taskWorkspaceDockerSource =
  configuredTaskWorkspaceDockerSource ||
  (existsSync("/.dockerenv")
    ? (resolveOwnDockerMountSource(parsed.TASK_WORKSPACE_ROOT) ?? "verft_task_workspaces")
    : parsed.TASK_WORKSPACE_ROOT !== "/task-workspaces"
      ? parsed.TASK_WORKSPACE_ROOT
      : path.join(repoRoot, "task-workspaces"));
const configuredTaskWorkspaceHostSource = parsed.TASK_WORKSPACE_HOST_SOURCE?.trim();
const taskWorkspaceHostSource =
  configuredTaskWorkspaceHostSource ||
  (taskWorkspaceDockerSource.startsWith("/host_mnt/")
    ? taskWorkspaceDockerSource.slice("/host_mnt".length)
    : taskWorkspaceDockerSource);

export const AUTO_RUN_POSTGRES_MIGRATIONS = true;
export const DEPLOYMENT_ENVIRONMENT_LABEL = "local";
export const DEFAULT_GIT_COMMIT_IDENTITY = {
  name: "Verft Bot",
  email: "verft@local.dev"
} as const;
export const AGENT_RUNTIME_IMAGE = parsed.AGENT_RUNTIME_IMAGE;

export const env = {
  ...parsed,
  TASK_WORKSPACE_DOCKER_SOURCE: taskWorkspaceDockerSource,
  TASK_WORKSPACE_HOST_SOURCE: taskWorkspaceHostSource
};
