import type { FastifyReply, FastifyRequest } from "fastify";
import {
  getRequiredTaskCapabilityScopes,
  getTaskCapabilityScopeForTaskAction,
  type AgentProvider,
  type PermissionScope,
  type ProviderProfile,
  type TaskAction,
  type TaskReasoningEffort,
  type TaskStartMode,
  type TaskType
} from "@agentswarm/shared-types";
import {
  defaultModelForProvider,
  normalizeModelOverride,
  normalizeProvider,
  normalizeProviderProfile
} from "./provider-config.js";

const requireScopes = (
  request: FastifyRequest,
  reply: FastifyReply,
  scopes: PermissionScope[],
  message: string
): boolean => {
  const auth = request.auth;
  if (!auth) {
    void reply.status(401).send({ message: "Authentication required" });
    return false;
  }

  const missingScopes = scopes.filter((scope) => !auth.scopes.has(scope));
  if (missingScopes.length > 0) {
    void reply.status(403).send({ message });
    return false;
  }

  return true;
};

export const requireTaskCapabilityAccess = (
  request: FastifyRequest,
  reply: FastifyReply,
  input: { taskType?: TaskType; startMode?: TaskStartMode }
): boolean =>
  requireScopes(
    request,
    reply,
    getRequiredTaskCapabilityScopes(input),
    input.startMode === "prepare_workspace"
      ? "Interactive terminal access is not permitted for this role."
      : input.taskType === "ask"
        ? "Ask access is not permitted for this role."
        : "Build access is not permitted for this role."
  );

export const requireTaskActionCapabilityAccess = (
  request: FastifyRequest,
  reply: FastifyReply,
  action: TaskAction
): boolean =>
  requireScopes(
    request,
    reply,
    [getTaskCapabilityScopeForTaskAction(action)],
    action === "ask" ? "Ask access is not permitted for this role." : "Build access is not permitted for this role."
  );

export const requireInteractiveTerminalAccess = (request: FastifyRequest, reply: FastifyReply): boolean =>
  requireScopes(
    request,
    reply,
    ["task:interactive"],
    "Interactive terminal access is not permitted for this role."
  );

export const requireTaskExecutionConfigAccess = (
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    provider?: AgentProvider | string | null;
    providerProfile?: ProviderProfile | string | null;
    modelOverride?: string | null;
    model?: string | null;
    reasoningEffort?: TaskReasoningEffort | null;
  }
): boolean => {
  const auth = request.auth;
  if (!auth) {
    void reply.status(401).send({ message: "Authentication required" });
    return false;
  }

  const provider = normalizeProvider(input.provider);
  const effort = normalizeProviderProfile(input.providerProfile, input.reasoningEffort);
  const model = normalizeModelOverride(input.modelOverride, input.model) ?? defaultModelForProvider(provider, effort) ?? "";

  const allowedProviders = auth.user.allowedProviders ?? [];
  if (allowedProviders.length > 0 && !allowedProviders.includes(provider)) {
    void reply.status(403).send({ message: `Provider "${provider}" is not permitted for this role.` });
    return false;
  }

  const allowedModels = auth.user.allowedModels ?? [];
  if (allowedModels.length > 0 && !allowedModels.includes(model)) {
    void reply.status(403).send({ message: `Model "${model}" is not permitted for this role.` });
    return false;
  }

  const allowedEfforts = auth.user.allowedEfforts ?? [];
  if (allowedEfforts.length > 0 && !allowedEfforts.includes(effort)) {
    void reply.status(403).send({ message: `Effort "${effort}" is not permitted for this role.` });
    return false;
  }

  return true;
};
