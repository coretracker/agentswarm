import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { SequenceStore } from "../services/sequence-store.js";

const sequenceVariableSchema = z
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
  });

const sequenceStepSchema = z
  .object({
    id: z.string().trim().min(1).max(80).optional(),
    type: z.enum(["inline", "snippet"]),
    prompt: z.string().max(20_000).default(""),
    snippetId: z.string().trim().min(1).max(120).optional()
  })
  .superRefine((step, ctx) => {
    if (step.type === "inline" && step.prompt.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Inline steps must include prompt content."
      });
    }
    if (step.type === "snippet" && !step.snippetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snippetId"],
        message: "Snippet steps must include snippetId."
      });
    }
  });

const sequenceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    executionMode: z.enum(["auto_apply_changes", "approve_before_continuing"]).optional().default("auto_apply_changes"),
    steps: z.array(sequenceStepSchema).min(1).max(100),
    variables: z.array(sequenceVariableSchema).max(100).optional()
  })
  .superRefine((value, ctx) => {
    const variableNames = new Set<string>();
    for (const variable of value.variables ?? []) {
      if (variableNames.has(variable.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variables"],
          message: `Duplicate variable name: ${variable.name}`
        });
      }
      variableNames.add(variable.name);
    }
    const stepIds = new Set<string>();
    for (const [index, step] of value.steps.entries()) {
      const stepId = step.id?.trim();
      if (!stepId) {
        continue;
      }
      if (stepIds.has(stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "id"],
          message: `Duplicate step id: ${stepId}`
        });
      }
      stepIds.add(stepId);
    }
  });

export const registerSequenceRoutes = (
  app: FastifyInstance,
  deps: {
    sequenceStore: SequenceStore;
    auth: AuthService;
  }
): void => {
  const normalizeInput = (input: z.infer<typeof sequenceSchema>) => ({
    ...input,
    steps: input.steps.map((step, index) => ({
      ...step,
      id: step.id?.trim() || `step_${index + 1}`
    }))
  });

  app.get("/sequences", { preHandler: deps.auth.requireAllScopes(["sequence:list"]) }, async () => deps.sequenceStore.listSequences());

  app.get<{ Params: { id: string } }>("/sequences/:id", { preHandler: deps.auth.requireAllScopes(["sequence:read"]) }, async (request, reply) => {
    const sequence = await deps.sequenceStore.getSequence(request.params.id);
    if (!sequence) {
      return reply.status(404).send({ message: "Sequence not found" });
    }
    return reply.send(sequence);
  });

  app.post("/sequences", { preHandler: deps.auth.requireAllScopes(["sequence:create"]) }, async (request, reply) => {
    const parsed = sequenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }
    const sequence = await deps.sequenceStore.createSequence(normalizeInput(parsed.data));
    return reply.status(201).send(sequence);
  });

  app.post<{ Params: { id: string } }>("/sequences/:id/duplicate", { preHandler: deps.auth.requireAllScopes(["sequence:create"]) }, async (request, reply) => {
    const source = await deps.sequenceStore.getSequence(request.params.id);
    if (!source) {
      return reply.status(404).send({ message: "Sequence not found" });
    }

    const duplicated = await deps.sequenceStore.createSequence({
      name: `Copy of ${source.name}`,
      executionMode: source.executionMode,
      steps: source.steps.map((step) => ({
        id: step.id,
        type: step.type,
        prompt: step.prompt,
        ...(step.snippetId ? { snippetId: step.snippetId } : {})
      })),
      variables: source.variables
    });
    return reply.status(201).send(duplicated);
  });

  app.patch<{ Params: { id: string } }>("/sequences/:id", { preHandler: deps.auth.requireAllScopes(["sequence:edit"]) }, async (request, reply) => {
    const parsed = sequenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }
    const sequence = await deps.sequenceStore.updateSequence(request.params.id, normalizeInput(parsed.data));
    if (!sequence) {
      return reply.status(404).send({ message: "Sequence not found" });
    }
    return reply.send(sequence);
  });

  app.delete<{ Params: { id: string } }>("/sequences/:id", { preHandler: deps.auth.requireAllScopes(["sequence:delete"]) }, async (request, reply) => {
    const deleted = await deps.sequenceStore.deleteSequence(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Sequence not found" });
    }
    return reply.status(204).send();
  });
};
