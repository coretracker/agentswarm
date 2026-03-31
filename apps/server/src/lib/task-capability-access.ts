import type { FastifyReply, FastifyRequest } from "fastify";
import {
  getRequiredTaskCapabilityScopes,
  getTaskCapabilityScopeForTaskAction,
  type PermissionScope,
  type TaskAction,
  type TaskStartMode,
  type TaskType
} from "@agentswarm/shared-types";

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
