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
  DEFAULT_ADMIN_EMAIL: z.string().email().default("admin@localhost"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default("admin123!"),
  AUTH_COOKIE_NAME: z.string().default("agentswarm_session"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7)
});

export const env = envSchema.parse(process.env);
