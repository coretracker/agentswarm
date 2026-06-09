import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { SnippetStore } from "../services/snippet-store.js";

const snippetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20000),
  variables: z
    .array(
      z
        .object({
          name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128),
          type: z.enum(["text", "multiline"]),
          title: z.string().trim().max(200).default(""),
          description: z.string().trim().max(200).default(""),
          defaultValue: z.string().max(2000).default("")
        })
        .superRefine((value, ctx) => {
          if (value.type === "text" && /[\r\n]/.test(value.defaultValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["defaultValue"],
              message: "Default value for text variables must be a single line."
            });
          }
        })
    )
    .max(100)
    .optional()
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

  app.post<{ Params: { id: string } }>("/snippets/:id/duplicate", { preHandler: deps.auth.requireAllScopes(["snippet:create"]) }, async (request, reply) => {
    const source = await deps.snippetStore.getSnippet(request.params.id);
    if (!source) {
      return reply.status(404).send({ message: "Snippet not found" });
    }

    const duplicated = await deps.snippetStore.createSnippet({
      name: `Copy of ${source.name}`,
      content: source.content,
      variables: source.variables
    });
    return reply.status(201).send(duplicated);
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
