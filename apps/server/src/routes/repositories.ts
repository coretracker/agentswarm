import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { AuthSessionUser, CreateRepositoryInput, UpdateRepositoryInput } from "@verft/shared-types";
import type { AuthService } from "../lib/auth.js";
import { buildGitProcessEnv } from "../lib/git-env.js";
import { sendHttpError } from "../lib/http-error.js";
import { canUserAccessRepository } from "../lib/task-ownership.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { UserStore } from "../services/user-store.js";

const execFileAsync = promisify(execFile);

const REPOSITORY_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_ENV_VAR_MAX_COUNT = 250;
const REPOSITORY_ENV_VAR_KEY_MAX_LENGTH = 128;
const REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH = 8192;
const REPOSITORY_ENV_FILE_NAME_MAX_LENGTH = 255;
const REPOSITORY_ENV_FILE_CONTENT_MAX_LENGTH = 350_000;
const REPOSITORY_ENV_SECRET_KEY_PATTERN = REPOSITORY_ENV_VAR_KEY_PATTERN;
const REPOSITORY_ENV_SECRET_MAX_COUNT = REPOSITORY_ENV_VAR_MAX_COUNT;
const REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH = REPOSITORY_ENV_VAR_KEY_MAX_LENGTH;
const REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH = REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH;
const GITHUB_ALLOWED_USERS_MAX_COUNT = 100;
const GITHUB_LOGIN_PATTERN = /^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{2,}$/;
const HOST_COMMAND_MAX_COUNT = 80;
const HOST_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const parseLsRemoteBranchOutput = (output: string): string[] =>
  Array.from(
    new Set(
      output
        .split(/\r?\n/)
        .map((line) => {
          const ref = line.trim().split(/\s+/)[1] ?? "";
          return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
        })
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

const listRepositoryRemoteBranches = async (
  repositoryUrl: string,
  settingsStore?: SettingsStore
): Promise<string[]> => {
  const credentials = await settingsStore?.getRuntimeCredentials().catch(() => null);
  const gitEnv = await buildGitProcessEnv({
    githubToken: credentials?.githubToken ?? null,
    gitUsername: credentials?.gitUsername ?? "x-access-token"
  });
  const { stdout } = await execFileAsync("git", ["ls-remote", "--heads", repositoryUrl], {
    env: {
      ...process.env,
      ...gitEnv,
      GIT_TERMINAL_PROMPT: "0"
    },
    maxBuffer: 1024 * 1024,
    timeout: 15_000
  });

  return parseLsRemoteBranchOutput(stdout);
};

const hostCommandsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(HOST_COMMAND_PATTERN, "Host command names must be simple command names, not paths.")
  )
  .max(HOST_COMMAND_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const normalized = entries[index]?.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate host command: ${entries[index]}`
        });
      } else {
        seen.add(normalized);
      }
    }
  });

const inboundWebhookSignatureHeadersSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(HTTP_HEADER_NAME_PATTERN, "Header names must be valid HTTP field names.")
  )
  .max(10)
  .optional();

const inboundWebhookSignatureHeaderSecretsSchema = z
  .array(
    z.object({
      header: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(HTTP_HEADER_NAME_PATTERN, "Header names must be valid HTTP field names."),
      secret: z.string().trim().optional(),
      clearSecret: z.boolean().optional()
    })
  )
  .max(10)
  .optional();

const repositoryEnvKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(REPOSITORY_ENV_VAR_KEY_MAX_LENGTH)
  .regex(REPOSITORY_ENV_VAR_KEY_PATTERN, "Names must match /^[A-Za-z_][A-Za-z0-9_]*$/.");

const repositoryEnvVarsSchema = z
  .array(
    z.union([
      z.object({
        key: repositoryEnvKeySchema,
        type: z.literal("text").optional(),
        value: z.string().max(REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH)
      }),
      z.object({
        key: repositoryEnvKeySchema,
        type: z.literal("file"),
        fileName: z.string().trim().min(1).max(REPOSITORY_ENV_FILE_NAME_MAX_LENGTH).optional(),
        fileContentBase64: z.string().trim().min(1).max(REPOSITORY_ENV_FILE_CONTENT_MAX_LENGTH).optional()
      })
    ])
  )
  .max(REPOSITORY_ENV_VAR_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const key = entries[index]?.key;
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate variable name: ${key}`
        });
      } else {
        seen.add(key);
      }
    }
  });

const repositoryEnvSecretsSchema = z
  .array(
    z.union([
      z.object({
        key: repositoryEnvKeySchema
          .max(REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH)
          .regex(REPOSITORY_ENV_SECRET_KEY_PATTERN, "Secret names must match /^[A-Za-z_][A-Za-z0-9_]*$/."),
        type: z.literal("text").optional(),
        value: z.string().max(REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH).optional()
      }),
      z.object({
        key: repositoryEnvKeySchema
          .max(REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH)
          .regex(REPOSITORY_ENV_SECRET_KEY_PATTERN, "Secret names must match /^[A-Za-z_][A-Za-z0-9_]*$/."),
        type: z.literal("file"),
        fileName: z.string().trim().min(1).max(REPOSITORY_ENV_FILE_NAME_MAX_LENGTH).optional(),
        fileContentBase64: z.string().trim().min(1).max(REPOSITORY_ENV_FILE_CONTENT_MAX_LENGTH).optional()
      })
    ])
  )
  .max(REPOSITORY_ENV_SECRET_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const key = entries[index]?.key;
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate secret name: ${key}`
        });
      } else {
        seen.add(key);
      }
    }
  });

const githubAllowedUsersSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(GITHUB_LOGIN_PATTERN, "GitHub usernames may include alphanumeric characters or hyphens.")
  )
  .max(GITHUB_ALLOWED_USERS_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const normalized = entries[index]?.trim().replace(/^@+/, "").toLowerCase();
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate GitHub user: ${entries[index]}`
        });
      } else {
        seen.add(normalized);
      }
    }
  });

const createRepositorySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  defaultProvider: z.enum(["codex", "claude"]).nullable().optional(),
  defaultModel: z.string().trim().min(1).max(120).nullable().optional(),
  defaultProviderProfile: z.enum(["low", "medium", "high", "max"]).nullable().optional(),
  envVars: repositoryEnvVarsSchema.optional(),
  envSecrets: repositoryEnvSecretsSchema.optional(),
  hostCommands: hostCommandsSchema.optional(),
  webhookUrl: z.string().trim().url().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookSecret: z.string().trim().min(1).optional(),
  githubPrWebhookSecret: z.string().trim().min(1).optional(),
  inboundWebhookSecret: z.string().trim().min(1).optional(),
  inboundWebhookSignatureHeaders: inboundWebhookSignatureHeadersSchema,
  inboundWebhookSignatureHeaderSecrets: inboundWebhookSignatureHeaderSecretsSchema,
  githubIntegrationBotLogin: z.string().trim().max(255).nullable().optional(),
  githubPrAllowedUsers: githubAllowedUsersSchema.optional(),
  githubPrRequireBotMention: z.boolean().optional(),
  githubPrAutoArchiveOnMerge: z.boolean().optional(),
  githubPrInitialInstructions: z.string().trim().max(8000).nullable().optional(),
  githubPrFeedbackInstructions: z.string().trim().max(8000).nullable().optional(),
  githubPrReviewInstructions: z.string().trim().max(8000).nullable().optional(),
  githubPrTaskCreatedCommentTemplate: z.string().trim().max(8000).nullable().optional(),
  githubPrTaskOwnerUserId: z.string().trim().min(1).nullable().optional(),
  slackChannelId: z.string().trim().regex(SLACK_CHANNEL_ID_PATTERN, "Slack channel ID must look like C... or G...").nullable().optional(),
  slackInitialInstructions: z.string().trim().max(8000).nullable().optional(),
  slackFeedbackInstructions: z.string().trim().max(8000).nullable().optional(),
  slackTaskCreatedReplyTemplate: z.string().trim().max(8000).nullable().optional(),
  slackTaskOwnerUserId: z.string().trim().min(1).nullable().optional(),
  harnessWhatExists: z.string().trim().max(8000).nullable().optional(),
  harnessAllowedActions: z.string().trim().max(8000).nullable().optional(),
  harnessNotAllowedActions: z.string().trim().max(8000).nullable().optional(),
  harnessHowToWork: z.string().trim().max(8000).nullable().optional(),
  harnessDefinitionOfDone: z.string().trim().max(8000).nullable().optional(),
  harnessEvidenceExpectations: z.string().trim().max(8000).nullable().optional()
});

const updateRepositorySchema = createRepositorySchema.partial().extend({
  clearWebhookSecret: z.boolean().optional(),
  clearGithubPrWebhookSecret: z.boolean().optional(),
  inboundWebhookSecret: z.string().trim().min(1).optional(),
  clearInboundWebhookSecret: z.boolean().optional()
});

type ParsedRepositoryInput = z.infer<typeof createRepositorySchema>;
type ParsedRepositoryUpdateInput = z.infer<typeof updateRepositorySchema>;
const toCreateRepositoryInput = (input: ParsedRepositoryInput): CreateRepositoryInput => input;

const toUpdateRepositoryInput = (input: ParsedRepositoryUpdateInput): UpdateRepositoryInput => input;

export const registerRepositoryRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    auth: AuthService;
    userStore: UserStore;
    settingsStore?: SettingsStore;
    listRepositoryBranches?: (repositoryUrl: string) => Promise<string[]>;
  }
): void => {
  const addRepositoryAccessForUser = async (userId: string, repositoryId: string): Promise<void> => {
    const user = await deps.userStore.getUser(userId);
    if (!user) {
      return;
    }

    const resolvedRepositoryIds = await Promise.all(
      user.repositoryIds.map(async (currentRepositoryId) =>
        (await deps.repositoryStore.getRepository(currentRepositoryId)) ? currentRepositoryId : null
      )
    );
    const nextRepositoryIds = resolvedRepositoryIds.filter((currentRepositoryId): currentRepositoryId is string =>
      Boolean(currentRepositoryId)
    );
    if (!nextRepositoryIds.includes(repositoryId)) {
      nextRepositoryIds.push(repositoryId);
    }
    await deps.userStore.updateUser(user.id, {
      repositoryIds: nextRepositoryIds
    });
  };

  const validateIntegrationTaskOwner = async (
    ownerUserId: string | null | undefined,
    repositoryId: string | null,
    label: string
  ): Promise<{ ok: true } | { ok: false; statusCode: 400 | 404; message: string }> => {
    const normalizedOwnerUserId = ownerUserId?.trim() || null;
    if (!normalizedOwnerUserId) {
      return { ok: true };
    }

    const owner = await deps.userStore.getUser(normalizedOwnerUserId);
    if (!owner) {
      return { ok: false, statusCode: 400, message: `${label} task owner was not found.` };
    }
    if (!owner.active) {
      return { ok: false, statusCode: 400, message: `${label} task owner must be active.` };
    }
    if (repositoryId && !canUserAccessRepository(owner, repositoryId)) {
      return { ok: false, statusCode: 400, message: `${label} task owner must have access to this repository.` };
    }

    return { ok: true };
  };

  const validateIntegrationTaskOwnerForCreate = async (
    ownerUserId: string | null | undefined,
    authUser: AuthSessionUser | null | undefined,
    label: string
  ): Promise<{ ok: true } | { ok: false; statusCode: 400 | 404; message: string }> => {
    const normalizedOwnerUserId = ownerUserId?.trim() || null;
    if (!normalizedOwnerUserId) {
      return { ok: true };
    }
    if (!authUser || normalizedOwnerUserId !== authUser.id) {
      return { ok: false, statusCode: 400, message: `${label} task owner must have access to this repository.` };
    }

    return validateIntegrationTaskOwner(normalizedOwnerUserId, null, label);
  };

  app.get("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:list"]) }, async (request) => {
    const repositories = await deps.repositoryStore.listRepositories();
    return repositories.filter((repository) => canUserAccessRepository(request.auth?.user, repository.id));
  });

  app.get<{ Params: { id: string } }>("/repositories/:id", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.id);
    if (!repository || !canUserAccessRepository(request.auth?.user, request.params.id)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.send(repository);
  });

  app.get<{ Params: { id: string } }>("/repositories/:id/branches", { preHandler: deps.auth.requireAllScopes(["repo:read"]) }, async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.id);
    if (!repository || !canUserAccessRepository(request.auth?.user, request.params.id)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    try {
      const branches = deps.listRepositoryBranches
        ? await deps.listRepositoryBranches(repository.url)
        : await listRepositoryRemoteBranches(repository.url, deps.settingsStore);
      return reply.send({ branches });
    } catch (error) {
      const sent = sendHttpError(reply, error);
      if (sent) {
        return sent;
      }
      request.log.warn({ err: error, repositoryId: repository.id }, "repository.branches.failed");
      return reply.status(502).send({ message: "Failed to load repository branches." });
    }
  });

  app.post("/repositories", { preHandler: deps.auth.requireAllScopes(["repo:create"]) }, async (request, reply) => {
    const parsed = createRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const authUser = request.auth?.user;
      for (const ownerValidation of [
        await validateIntegrationTaskOwnerForCreate(parsed.data.githubPrTaskOwnerUserId, authUser, "GitHub-created"),
        await validateIntegrationTaskOwnerForCreate(parsed.data.slackTaskOwnerUserId, authUser, "Slack-created")
      ]) {
        if (!ownerValidation.ok) {
          return reply.status(ownerValidation.statusCode).send({ message: ownerValidation.message });
        }
      }

      const createInput: CreateRepositoryInput = toCreateRepositoryInput(parsed.data);
      const repository = await deps.repositoryStore.createRepository(createInput);
      if (authUser) {
        await addRepositoryAccessForUser(authUser.id, repository.id);
      }
      return reply.status(201).send(repository);
    } catch (error) {
      const sent = sendHttpError(reply, error);
      if (sent) {
        return sent;
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/repositories/:id", { preHandler: deps.auth.requireAllScopes(["repo:edit"]) }, async (request, reply) => {
    const parsed = updateRepositorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.message });
    }

    try {
      const current = await deps.repositoryStore.getRepository(request.params.id);
      if (!current || !canUserAccessRepository(request.auth?.user, request.params.id)) {
        return reply.status(404).send({ message: "Repository not found" });
      }
      for (const ownerValidation of [
        await validateIntegrationTaskOwner(parsed.data.githubPrTaskOwnerUserId, request.params.id, "GitHub-created"),
        await validateIntegrationTaskOwner(parsed.data.slackTaskOwnerUserId, request.params.id, "Slack-created")
      ]) {
        if (!ownerValidation.ok) {
          return reply.status(ownerValidation.statusCode).send({ message: ownerValidation.message });
        }
      }

      const updateInput: UpdateRepositoryInput = toUpdateRepositoryInput(parsed.data);
      const updated = await deps.repositoryStore.updateRepository(request.params.id, updateInput);
      if (!updated) {
        return reply.status(404).send({ message: "Repository not found" });
      }

      return reply.send(updated);
    } catch (error) {
      const sent = sendHttpError(reply, error);
      if (sent) {
        return sent;
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/repositories/:id", { preHandler: deps.auth.requireAllScopes(["repo:delete"]) }, async (request, reply) => {
    const current = await deps.repositoryStore.getRepository(request.params.id);
    if (!current || !canUserAccessRepository(request.auth?.user, request.params.id)) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const deleted = await deps.repositoryStore.deleteRepository(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    return reply.status(204).send();
  });
};
