import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth.js";
import type { TaskDraftStore } from "../services/task-draft-store.js";

const stringMapSchema = z.record(z.string()).optional();

const deadlineSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), "Deadline must be a valid date.")
  .nullable()
  .optional();

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  dataBase64: z.string().min(1)
});

const draftDefinitionSchema = z.object({
  sourceType: z.enum(["blank", "snippet", "sequence", "issue", "pull_request"]).optional(),
  title: z.string().max(500).optional(),
  deadline: deadlineSchema,
  repoId: z.string().max(120).optional(),
  prompt: z.string().max(48_000).optional(),
  notes: z.string().max(48_000).optional(),
  taskType: z.enum(["build", "ask"]).optional(),
  provider: z.enum(["codex", "claude"]).optional(),
  model: z.string().max(256).optional(),
  providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
  codexCredentialSource: z.enum(["auto", "profile", "global"]).optional(),
  baseBranch: z.string().max(255).optional(),
  branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional(),
  issueNumber: z.number().int().nonnegative().optional(),
  includeComments: z.boolean().optional(),
  pullRequestNumber: z.number().int().nonnegative().optional(),
  snippetId: z.string().max(120).optional(),
  snippetVariables: stringMapSchema,
  sequenceId: z.string().max(120).optional(),
  sequenceVariables: stringMapSchema,
  attachments: z.array(attachmentSchema).max(6).optional()
});

const createDraftSchema = z.object({
  title: z.string().trim().max(500).optional(),
  definition: draftDefinitionSchema
});

const updateDraftSchema = z.object({
  title: z.string().trim().max(500).optional(),
  definition: draftDefinitionSchema.optional()
});

export const registerTaskDraftRoutes = (
  app: FastifyInstance,
  deps: {
    taskDraftStore: TaskDraftStore;
    auth: AuthService;
  }
): void => {
  app.get("/task-drafts", { preHandler: deps.auth.requireAllScopes(["task:list"]) }, async (request) =>
    deps.taskDraftStore.listDrafts(request.auth!.user.id)
  );

  app.get<{ Params: { id: string } }>("/task-drafts/:id", { preHandler: deps.auth.requireAllScopes(["task:read"]) }, async (request, reply) => {
    const draft = await deps.taskDraftStore.getDraft(request.auth!.user.id, request.params.id);
    if (!draft) {
      return reply.status(404).send({ message: "Task draft not found" });
    }
    return reply.send(draft);
  });

  app.post("/task-drafts", { preHandler: deps.auth.requireAllScopes(["task:create"]) }, async (request, reply) => {
    const parsed = createDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }
    const draft = await deps.taskDraftStore.createDraft(request.auth!.user.id, parsed.data);
    return reply.status(201).send(draft);
  });

  app.patch<{ Params: { id: string } }>("/task-drafts/:id", { preHandler: deps.auth.requireAllScopes(["task:create"]) }, async (request, reply) => {
    const parsed = updateDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }
    const draft = await deps.taskDraftStore.updateDraft(request.auth!.user.id, request.params.id, parsed.data);
    if (!draft) {
      return reply.status(404).send({ message: "Task draft not found" });
    }
    return reply.send(draft);
  });

  app.delete<{ Params: { id: string } }>("/task-drafts/:id", { preHandler: deps.auth.requireAllScopes(["task:create"]) }, async (request, reply) => {
    const deleted = await deps.taskDraftStore.deleteDraft(request.auth!.user.id, request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Task draft not found" });
    }
    return reply.status(204).send();
  });
};
