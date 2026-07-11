import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../lib/auth.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskQueueStore } from "../services/task-queue-store.js";
import type { TaskStore } from "../services/task-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import { createMcpTools, McpToolError, type McpToolDeps } from "./tools.js";

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional()
});

const toolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.unknown().optional()
});

type JsonRpcId = string | number | null;

const readBearerToken = (request: FastifyRequest): string | null => {
  const raw = request.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
};

const ok = (id: JsonRpcId, result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result
});

const error = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data })
  }
});

const toToolContent = (value: unknown) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2)
    }
  ],
  structuredContent: value
});

export const registerMcpRoutes = (
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    repositoryStore: RepositoryStore;
    settingsStore: SettingsStore;
    taskStore: TaskStore;
    taskQueueStore: TaskQueueStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
  }
): void => {
  const tools = createMcpTools();
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolDeps: McpToolDeps = {
    repositoryStore: deps.repositoryStore,
    settingsStore: deps.settingsStore,
    taskStore: deps.taskStore,
    taskQueueStore: deps.taskQueueStore,
    scheduler: deps.scheduler,
    spawner: deps.spawner
  };

  app.post("/mcp", async (request, reply) => {
    const parsed = jsonRpcRequestSchema.safeParse(request.body);
    const id = parsed.success ? (parsed.data.id ?? null) : null;
    if (!parsed.success) {
      return reply.status(400).send(error(id, -32600, "Invalid JSON-RPC request", parsed.error.message));
    }

    if (parsed.data.method === "initialize") {
      return reply.send(
        ok(id, {
          protocolVersion: "2025-03-26",
          serverInfo: {
            name: "verft",
            version: "0.1.0"
          },
          capabilities: {
            tools: {}
          }
        })
      );
    }

    if (parsed.data.method.startsWith("notifications/")) {
      return reply.status(202).send();
    }

    const auth = await deps.auth.authenticateBearerToken(readBearerToken(request));
    if (!auth) {
      return reply.status(401).send(error(id, -32001, "Authentication required"));
    }

    if (parsed.data.method === "tools/list") {
      const context = {
        user: auth.user,
        deps: toolDeps,
        runtimeContext: auth.personalAccessTokenRuntimeContext ?? null
      };
      return reply.send(
        ok(id, {
          tools: tools
            .filter((tool) => tool.available?.(context) ?? true)
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
        })
      );
    }

    if (parsed.data.method === "tools/call") {
      const params = toolCallParamsSchema.safeParse(parsed.data.params ?? {});
      if (!params.success) {
        return reply.status(400).send(error(id, -32602, "Invalid tool call parameters", params.error.message));
      }
      const tool = toolsByName.get(params.data.name);
      if (!tool) {
        return reply.status(404).send(error(id, -32601, `Unknown tool: ${params.data.name}`));
      }

      const context = {
        user: auth.user,
        deps: toolDeps,
        runtimeContext: auth.personalAccessTokenRuntimeContext ?? null
      };
      if (!(tool.available?.(context) ?? true)) {
        return reply.status(404).send(error(id, -32601, `Unknown tool: ${params.data.name}`));
      }

      const granted = new Set(auth.user.scopes);
      const missingScopes = tool.scopes.filter((scope) => !granted.has(scope));
      if (missingScopes.length > 0) {
        return reply.status(403).send(error(id, -32003, "Forbidden", { missingScopes }));
      }

      try {
        const result = await tool.handler(params.data.arguments ?? {}, context);
        return reply.send(ok(id, toToolContent(result)));
      } catch (err) {
        if (err instanceof McpToolError) {
          return reply.status(err.statusCode).send(error(id, -32000, err.message, { reasonCode: err.reasonCode }));
        }
        if (err instanceof z.ZodError) {
          return reply.status(400).send(error(id, -32602, "Invalid tool arguments", err.message));
        }
        const message = err instanceof Error ? err.message : "Tool call failed";
        return reply.status(500).send(error(id, -32603, message));
      }
    }

    return reply.status(404).send(error(id, -32601, `Unknown method: ${parsed.data.method}`));
  });
};
