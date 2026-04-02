import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { SnippetStore } from "../services/snippet-store.js";

const snippetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20000)
});

export const registerSnippetRoutes = (
  app: FastifyInstance,
  deps: {
    snippetStore: SnippetStore;
    auth: AuthService;
  }
): void => {
  app.get("/snippets", { preHandler: deps.auth.requireAllScopes(["snippet:list"]) }, async () => deps.snippetStore.listSnippets());

  app.get<{ Params: { id: string } }>("/snippets/:id", { preHandler: deps.auth.requireAllScopes(["snippet:read"]) }, async (request, reply) => {
    const snippet = await deps.snippetStore.getSnippet(request.params.id);
    if (!snippet) {
      return reply.status(404).send({ message: "Snippet not found" });
    }

    return reply.send(snippet);
  });

  app.post("/snippets", { preHandler: deps.auth.requireAllScopes(["snippet:create"]) }, async (request, reply) => {
    const parsed = snippetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const snippet = await deps.snippetStore.createSnippet(parsed.data);
    return reply.status(201).send(snippet);
  });

  app.patch<{ Params: { id: string } }>("/snippets/:id", { preHandler: deps.auth.requireAllScopes(["snippet:edit"]) }, async (request, reply) => {
    const parsed = snippetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    const snippet = await deps.snippetStore.updateSnippet(request.params.id, parsed.data);
    if (!snippet) {
      return reply.status(404).send({ message: "Snippet not found" });
    }

    return reply.send(snippet);
  });

  app.delete<{ Params: { id: string } }>("/snippets/:id", { preHandler: deps.auth.requireAllScopes(["snippet:delete"]) }, async (request, reply) => {
    const deleted = await deps.snippetStore.deleteSnippet(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Snippet not found" });
    }

    return reply.status(204).send();
  });
};
