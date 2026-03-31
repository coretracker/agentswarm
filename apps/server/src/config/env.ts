import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  EVENT_CHANNEL: z.string().default("agentswarm:events"),
  GIT_USER_NAME: z.string().default("AgentSwarm Bot"),
  GIT_USER_EMAIL: z.string().default("agentswarm@local.dev"),
  LOCAL_PLANS_ROOT: z.string().default("/plans"),
  REPO_CACHE_ROOT: z.string().default("/repo-cache"),
  REPO_CACHE_VOLUME: z.string().default("agentswarm_repo_cache"),
  RUNTIME_PAYLOAD_ROOT: z.string().default("/runtime-payloads"),
  RUNTIME_PAYLOAD_VOLUME: z.string().default("agentswarm_runtime_payloads"),
  TASK_WORKSPACE_ROOT: z.string().default("/task-workspaces"),
  TASK_WORKSPACE_HOST_ROOT: z.string().default("/tmp/agentswarm-task-workspaces"),
  SECRET_KEY_PATH: z.string().default("/secrets/agentswarm.key"),
  CORS_ORIGIN: z.string().default("http://localhost:3217"),
  DEFAULT_ADMIN_NAME: z.string().default("Administrator"),
  DEFAULT_ADMIN_EMAIL: z.string().email().default("admin@agentswarm.local"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default("admin123!"),
  AUTH_COOKIE_NAME: z.string().default("agentswarm_session"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  /** Docker image for in-browser interactive Codex (see tools/codex-web-terminal/Dockerfile.codex). Empty disables Codex interactive terminals. */
  CODEX_INTERACTIVE_IMAGE: z.string().default(""),
  /** Docker image for in-browser interactive Claude Code (see tools/codex-web-terminal/Dockerfile.claude). Empty disables Claude interactive terminals. */
  CLAUDE_INTERACTIVE_IMAGE: z.string().default("")
});

const parsed = envSchema.parse(process.env);

/**
 * Paths the server reads/writes via Node (clone, commit, status) live under TASK_WORKSPACE_ROOT.
 * `docker run -v …` for agents + interactive terminal sessions must bind the *same host directory*, or edits in
 * containers land in the wrong place and push / local git state will not match what you see in the UI.
 *
 * When unset, default HOST_ROOT is /tmp/… (wrong for most setups). If TASK_WORKSPACE_ROOT is not the
 * in-container default (/task-workspaces), assume it is already an absolute host path and reuse it.
 * Docker Compose should still set TASK_WORKSPACE_HOST_ROOT explicitly (e.g. ${PWD}/task-workspaces).
 */
const taskWorkspaceHostRoot =
  process.env.TASK_WORKSPACE_HOST_ROOT?.trim() ||
  (parsed.TASK_WORKSPACE_ROOT !== "/task-workspaces" ? parsed.TASK_WORKSPACE_ROOT : parsed.TASK_WORKSPACE_HOST_ROOT);

export const env = { ...parsed, TASK_WORKSPACE_HOST_ROOT: taskWorkspaceHostRoot };
