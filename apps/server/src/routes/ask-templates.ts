import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getAskTemplatePlaceholders, type AskTemplateVariable, type AuthSessionUser } from "@verft/shared-types";
import type { AuthService } from "../lib/auth.js";
import { isAdminUser } from "../lib/task-ownership.js";
import type { AskTemplateStore } from "../services/ask-template-store.js";
import { TeamStore } from "../services/team-store.js";

const variableSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(""),
  type: z.enum(["text", "multiline"]),
  required: z.boolean().default(false),
  defaultValue: z.string().max(4000).default("")
}).superRefine((value, context) => {
  if (value.type === "text" && /[\r\n]/.test(value.defaultValue)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "Text defaults must be one line." });
  }
});

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  prompt: z.string().trim().min(1).max(20000),
  outputFormat: z.string().trim().min(1).max(20000),
  variables: z.array(variableSchema).max(100).default([])
});

const sharingSchema = z.object({
  visibility: z.enum(["private", "teams", "global"]),
  sharedTeamIds: z.array(z.string().trim().min(1)).max(100).optional()
}).superRefine((value, context) => {
  if (value.visibility === "teams" && !(value.sharedTeamIds?.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedTeamIds"], message: "Select at least one team." });
  }
});

const validateTemplate = (input: z.infer<typeof templateSchema>): string | null => {
  const variables = input.variables as AskTemplateVariable[];
  const keys = new Set<string>();
  for (const variable of variables) {
    if (keys.has(variable.key)) return `Variable ${variable.key} is declared more than once.`;
    keys.add(variable.key);
  }
  const placeholders = getAskTemplatePlaceholders(`${input.prompt}\n${input.outputFormat}`);
  for (const placeholder of placeholders) {
    if (!keys.has(placeholder)) return `Placeholder {{${placeholder}}} has no matching variable.`;
  }
  for (const variable of variables) {
    if (!placeholders.includes(variable.key)) return `Variable ${variable.key} is not used in the prompt or output format.`;
  }
  return null;
};

const canManage = (user: Pick<AuthSessionUser, "id" | "roles">, ownerUserId: string | null): boolean =>
  isAdminUser(user) || ownerUserId === user.id;

export const registerAskTemplateRoutes = (
  app: FastifyInstance,
  deps: { auth: AuthService; askTemplateStore: AskTemplateStore; teamStore: TeamStore }
): void => {
  app.get("/ask-templates", { preHandler: deps.auth.requireAllScopes(["template:list"]) }, async (request) =>
    deps.askTemplateStore.listAccessible(request.auth!.user.id, request.auth!.user.teamId ?? null, isAdminUser(request.auth!.user))
  );

  app.get<{ Params: { id: string } }>("/ask-templates/:id", { preHandler: deps.auth.requireAllScopes(["template:read"]) }, async (request, reply) => {
    const template = await deps.askTemplateStore.getAccessible(request.params.id, request.auth!.user.id, request.auth!.user.teamId ?? null, isAdminUser(request.auth!.user));
    return template ? reply.send(template) : reply.status(404).send({ message: "Template not found" });
  });

  app.post("/ask-templates", { preHandler: deps.auth.requireAllScopes(["template:create"]) }, async (request, reply) => {
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
    const error = validateTemplate(parsed.data);
    if (error) return reply.status(400).send({ message: error });
    return reply.status(201).send(await deps.askTemplateStore.createTemplate(request.auth!.user.id, parsed.data));
  });

  app.patch<{ Params: { id: string } }>("/ask-templates/:id", { preHandler: deps.auth.requireAllScopes(["template:edit"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
    const error = validateTemplate(parsed.data);
    if (error) return reply.status(400).send({ message: error });
    return reply.send((await deps.askTemplateStore.updateTemplate(request.params.id, request.auth!.user.id, parsed.data))!);
  });

  app.patch<{ Params: { id: string } }>("/ask-templates/:id/sharing", { preHandler: deps.auth.requireAllScopes(["template:share"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    const parsed = sharingSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.message });
    const teamIds = Array.from(new Set(parsed.data.sharedTeamIds ?? []));
    if (parsed.data.visibility === "teams") {
      const teams = await deps.teamStore.listTeams();
      if (teamIds.some((teamId) => !teams.some((team) => team.id === teamId))) return reply.status(400).send({ message: "One or more teams do not exist." });
    }
    return reply.send((await deps.askTemplateStore.updateSharing(request.params.id, { ...parsed.data, sharedTeamIds: teamIds }))!);
  });

  app.delete<{ Params: { id: string } }>("/ask-templates/:id", { preHandler: deps.auth.requireAllScopes(["template:delete"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    return (await deps.askTemplateStore.deleteTemplate(request.params.id)) ? reply.status(204).send() : reply.status(404).send({ message: "Template not found" });
  });

  app.get<{ Params: { id: string } }>("/ask-templates/:id/versions", { preHandler: deps.auth.requireAllScopes(["template:read"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    return deps.askTemplateStore.listVersions(current.id);
  });

  app.get<{ Params: { id: string; version: string } }>("/ask-templates/:id/versions/:version", { preHandler: deps.auth.requireAllScopes(["template:read"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    const version = Number(request.params.version);
    const snapshot = Number.isInteger(version) ? await deps.askTemplateStore.getVersion(current.id, version) : null;
    return snapshot ? reply.send(snapshot) : reply.status(404).send({ message: "Template version not found" });
  });

  app.post<{ Params: { id: string; version: string } }>("/ask-templates/:id/versions/:version/restore", { preHandler: deps.auth.requireAllScopes(["template:edit"]) }, async (request, reply) => {
    const current = await deps.askTemplateStore.getTemplate(request.params.id);
    if (!current || !canManage(request.auth!.user, current.ownerUserId)) return reply.status(404).send({ message: "Template not found" });
    const version = Number(request.params.version);
    const restored = Number.isInteger(version) ? await deps.askTemplateStore.restoreVersion(current.id, request.auth!.user.id, version) : null;
    return restored ? reply.send(restored) : reply.status(404).send({ message: "Template version not found" });
  });
};
