import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/agentswarm"),
  EVENT_CHANNEL: z.string().default("agentswarm:events"),
  REPO_CACHE_ROOT: z.string().default("/repo-cache"),
  REPO_CACHE_VOLUME: z.string().default("agentswarm_repo_cache"),
  RUNTIME_PAYLOAD_ROOT: z.string().default("/runtime-payloads"),
  RUNTIME_PAYLOAD_VOLUME: z.string().default("agentswarm_runtime_payloads"),
  REPOSITORY_ENV_FILE_STORE_ROOT: z.string().default("/secrets/repository-env-files"),
  TASK_WORKSPACE_ROOT: z.string().default("/task-workspaces"),
  AGENT_RUNTIME_IMAGE: z
    .string()
    .default(
      process.env.CODEX_RUNTIME_IMAGE?.trim() ||
        process.env.CLAUDE_RUNTIME_IMAGE?.trim() ||
        "agentswarm-agent-toolbox:latest"
    ),
  SECRET_KEY_PATH: z.string().default("/secrets/agentswarm.key"),
  CORS_ORIGIN: z.string().default("http://localhost:3217"),
  DEFAULT_ADMIN_NAME: z.string().default("Administrator"),
  DEFAULT_ADMIN_EMAIL: z.string().email().default("admin@agentswarm.local"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default("admin123!"),
  AUTH_COOKIE_NAME: z.string().default("agentswarm_session"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  SENTRY_ENABLED: z.coerce.boolean().default(true),
  SENTRY_DSN: z.string().default("https://464566b3787dde0e2da9f69760ef8f40@o4511433840525312.ingest.de.sentry.io/4511433841901649"),
  /** Opt-in flag: when true, Codex/Claude runtime containers can receive Docker socket access. */
  DOCKER_SOCKET_ACCESS_ENABLED: z.coerce.boolean().default(false),
  /** Host path for docker.sock mount source. */
  DOCKER_SOCKET_HOST_PATH: z.string().default("/var/run/docker.sock"),
  /** Container path for docker.sock mount target in Codex runtime containers. */
  DOCKER_SOCKET_CONTAINER_PATH_CODEX: z.string().default("/var/run/docker.sock"),
  /** Container path for docker.sock mount target in Claude runtime containers. */
  DOCKER_SOCKET_CONTAINER_PATH_CLAUDE: z.string().default("/var/run/docker.sock")
});

const parsed = envSchema.parse(process.env);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const taskWorkspaceDockerSource = existsSync("/.dockerenv")
  ? "agentswarm_task_workspaces"
  : parsed.TASK_WORKSPACE_ROOT !== "/task-workspaces"
    ? parsed.TASK_WORKSPACE_ROOT
    : path.join(repoRoot, "task-workspaces");

export const AUTO_RUN_POSTGRES_MIGRATIONS = true;
export const DEPLOYMENT_ENVIRONMENT_LABEL = "local";
export const DEFAULT_GIT_COMMIT_IDENTITY = {
  name: "AgentSwarm Bot",
  email: "agentswarm@local.dev"
} as const;
export const AGENT_RUNTIME_IMAGE = parsed.AGENT_RUNTIME_IMAGE;

export const env = { ...parsed, TASK_WORKSPACE_DOCKER_SOURCE: taskWorkspaceDockerSource };
