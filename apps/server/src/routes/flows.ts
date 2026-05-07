import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { FlowStore } from "../services/flow-store.js";

const flowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
  definitionJson: z.string().trim().min(1).max(2_000_000)
});

export const registerFlowRoutes = (
  app: FastifyInstance,
  deps: {
    flowStore: FlowStore;
    auth: AuthService;
  }
): void => {
  app.get("/flows", { preHandler: deps.auth.requireAllScopes(["flow:list"]) }, async () => deps.flowStore.listFlows());

  app.get<{ Params: { id: string } }>("/flows/:id", { preHandler: deps.auth.requireAllScopes(["flow:read"]) }, async (request, reply) => {
    const flow = await deps.flowStore.getFlow(request.params.id);
    if (!flow) {
      return reply.status(404).send({ message: "Flow not found" });
    }

    return reply.send(flow);
  });

  app.post("/flows", { preHandler: deps.auth.requireAllScopes(["flow:create"]) }, async (request, reply) => {
    const parsed = flowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const flow = await deps.flowStore.createFlow(parsed.data);
    return reply.status(201).send(flow);
  });

  app.patch<{ Params: { id: string } }>("/flows/:id", { preHandler: deps.auth.requireAllScopes(["flow:edit"]) }, async (request, reply) => {
    const parsed = flowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const flow = await deps.flowStore.updateFlow(request.params.id, parsed.data);
    if (!flow) {
      return reply.status(404).send({ message: "Flow not found" });
    }

    return reply.send(flow);
  });

  app.delete<{ Params: { id: string } }>("/flows/:id", { preHandler: deps.auth.requireAllScopes(["flow:delete"]) }, async (request, reply) => {
    const deleted = await deps.flowStore.deleteFlow(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Flow not found" });
    }

    return reply.status(204).send();
  });
};
