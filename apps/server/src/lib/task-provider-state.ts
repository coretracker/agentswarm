import path from "node:path";
import type { AgentProvider } from "@verft/shared-types";
import { env } from "../config/env.js";

const TASK_PROVIDER_STATE_ROOT = ".task-state";
const LEGACY_INTERACTIVE_STATE_ROOT = ".interactive-homes";
const AGENT_HOME_DIRNAME = "agent-home";

function sanitizeTaskStateSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.length > 0 ? normalized : "unknown-task";
}

function providerStateDirName(provider: AgentProvider): string {
  return provider === "claude" ? ".claude" : ".codex";
}

export function resolveTaskProviderStatePaths(taskId: string, provider: AgentProvider): {
  serverPath: string;
  hostPath: string;
  homeServerPath: string;
  homeHostPath: string;
  legacyServerPath: string;
  legacyHostPath: string;
  configServerPath: string | null;
  configHostPath: string | null;
} {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const stateRootRelativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment);
  const agentHomeRelativePath = path.join(stateRootRelativePath, AGENT_HOME_DIRNAME);
  const relativePath = path.join(agentHomeRelativePath, providerStateDirName(provider));
  const legacyRelativePath = path.join(LEGACY_INTERACTIVE_STATE_ROOT, provider, taskSegment);
  const hasSidecarConfig = provider === "claude";

  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, relativePath),
    homeServerPath: path.join(env.TASK_WORKSPACE_ROOT, agentHomeRelativePath),
    homeHostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, agentHomeRelativePath),
    legacyServerPath: path.join(env.TASK_WORKSPACE_ROOT, legacyRelativePath),
    legacyHostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, legacyRelativePath),
    configServerPath: hasSidecarConfig ? path.join(env.TASK_WORKSPACE_ROOT, agentHomeRelativePath, ".claude.json") : null,
    configHostPath: hasSidecarConfig ? path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, agentHomeRelativePath, ".claude.json") : null
  };
}

export function resolveTaskStateRootPaths(taskId: string): { serverPath: string; hostPath: string } {
  const taskSegment = sanitizeTaskStateSegment(taskId);
  const relativePath = path.join(TASK_PROVIDER_STATE_ROOT, taskSegment);
  return {
    serverPath: path.join(env.TASK_WORKSPACE_ROOT, relativePath),
    hostPath: path.join(env.TASK_WORKSPACE_DOCKER_SOURCE, relativePath)
  };
}
