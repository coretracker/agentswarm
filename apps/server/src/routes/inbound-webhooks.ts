import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import { resolveCreateTaskProviderConfig } from "../lib/task-create-defaults.js";
import {
  findMatchingRule,
  interpolateTemplate,
  resolveCorrelationValue
} from "../lib/inbound-webhook-matcher.js";
import { beginTaskStart } from "../lib/task-start-orchestrator.js";
import type { IntegrationRuleStore } from "../services/integration-rule-store.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { UserStore } from "../services/user-store.js";
import type { WebhookInboxStore } from "../services/webhook-inbox-store.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

const readHeader = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const trimmed = value[0]?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const extractSha256Digest = (signatureHeader: string | null): string | null => {
  if (!signatureHeader) {
    return null;
  }

  const trimmed = signatureHeader.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  for (const part of trimmed.split(/[,\s]+/)) {
    const [_key, value] = part.split("=", 2);
    if (value && /^[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase();
    }
  }

  return null;
};

const verifySignature = (rawBody: string, signatureHeader: string | null, secret: string): boolean => {
  const digest = extractSha256Digest(signatureHeader);
  if (!digest) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(digest);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const readSignatureHeader = (request: FastifyRequest, headerNames: string[] | undefined): string | null => {
  const configuredHeaderNames =
    Array.isArray(headerNames) && headerNames.length > 0 ? headerNames : ["x-webhook-signature", "x-hub-signature-256"];
  for (const headerName of configuredHeaderNames) {
    const headerValue = readHeader(request.headers[headerName.toLowerCase()]);
    if (headerValue) {
      return headerValue;
    }
  }
  return null;
};

const flattenHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const flat = readHeader(value);
    if (flat) {
      result[key] = flat;
    }
  }
  return result;
};

export const registerInboundWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    integrationRuleStore: IntegrationRuleStore;
    webhookInboxStore: WebhookInboxStore;
    scheduler: SchedulerService;
    settingsStore: SettingsStore;
    spawner: SpawnerService;
    userStore: UserStore;
  }
): void => {
  app.head<{ Params: { repositoryId: string } }>("/integrations/webhooks/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send();
    }
    return reply.status(200).send();
  });

  app.post<{ Params: { repositoryId: string } }>("/integrations/webhooks/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const secret = await deps.repositoryStore.getRepositoryInboundWebhookSecret(repository.id);
    if (secret) {
      const rawBody = (request as RawBodyRequest).rawBody ?? "";
      const signature = readSignatureHeader(request, repository.inboundWebhookSignatureHeaders);
      if (!verifySignature(rawBody, signature, secret)) {
        return reply.status(401).send({ message: "Invalid webhook signature." });
      }
    }

    const headers = flattenHeaders(request.headers);
    const body = request.body ?? {};
    const sourceIp = request.ip || null;

    const inboxEntry = await deps.webhookInboxStore.insertEntry({
      repositoryId: repository.id,
      headers,
      body,
      sourceIp
    });

    // Fire-and-forget cleanup of old entries
    void deps.webhookInboxStore.deleteOldEntries(repository.id, 30).catch(() => {});

    const rules = await deps.integrationRuleStore.listRules(repository.id);
    const matchedRule = findMatchingRule(rules, headers, body);

    if (!matchedRule) {
      return reply.status(202).send({ received: true, matched: false });
    }

    const correlationValue = resolveCorrelationValue(matchedRule.correlationField ?? null, headers, body);
    const title = matchedRule.mapping.title
      ? interpolateTemplate(matchedRule.mapping.title, headers, body)
      : "Webhook task";
    const instructions = matchedRule.mapping.instructions
      ? interpolateTemplate(matchedRule.mapping.instructions, headers, body)
      : "";
    const branch = matchedRule.mapping.branch
      ? interpolateTemplate(matchedRule.mapping.branch, headers, body)
      : undefined;

    // Find existing task via correlation
    let existingTask = correlationValue
      ? await deps.taskStore.findTaskByExternalTarget(repository.id, "webhook", correlationValue)
      : null;

    if (existingTask) {
      // Feedback on existing task
      const existingMessages = await deps.taskStore.listMessages(existingTask.id);
      const externalId = `webhook:${inboxEntry.id}`;
      if (existingMessages.some((m) => m.externalId === externalId)) {
        return reply.status(202).send({ received: true, matched: true, ruleId: matchedRule.id, taskId: existingTask.id, created: false });
      }

      const message = await deps.taskStore.appendMessage(existingTask.id, {
        role: "user",
        action: "build",
        queueState: "pending",
        queueSource: "webhook",
        externalId,
        content: instructions || title
      });

      if (message && existingTask.executionStatus === "idle" && !(await deps.taskStore.hasPendingChangeProposal(existingTask.id))) {
        const blocked = await getMutationBlocked(deps.taskStore, existingTask.id);
        if (!blocked) {
          await deps.scheduler.triggerAction(existingTask.id, "build", { content: message.content }, { promptMessageId: message.id });
        }
      } else if (
        message &&
        (existingTask.executionStatus === "failed" || existingTask.executionStatus === "cancelled") &&
        !(await deps.taskStore.hasPendingChangeProposal(existingTask.id))
      ) {
        await deps.scheduler.triggerNextPendingAction(existingTask.id, "auto");
      }

      await deps.webhookInboxStore.updateMatchResult(inboxEntry.id, matchedRule.id, existingTask.id);
      return reply.status(202).send({ received: true, matched: true, ruleId: matchedRule.id, taskId: existingTask.id, created: false });
    }

    // Create new task
    const ownerUserId = matchedRule.taskOwnerUserId?.trim() || null;
    let resolvedOwnerUserId = ownerUserId;
    if (!resolvedOwnerUserId) {
      const users = await deps.userStore.listUsers();
      const adminUser = users.find((u) => u.roles?.some((r) => r.name === "admin") && u.active !== false);
      resolvedOwnerUserId = adminUser?.id ?? null;
    }
    if (!resolvedOwnerUserId) {
      return reply.status(202).send({ received: true, matched: true, ruleId: matchedRule.id, created: false, reason: "no_task_owner" });
    }

    const settings = await deps.settingsStore.getSettings();
    const executionOverrides: Record<string, unknown> = {};
    if (matchedRule.execution?.provider) {
      executionOverrides.provider = matchedRule.execution.provider;
    }
    if (matchedRule.execution?.model) {
      executionOverrides.modelOverride = matchedRule.execution.model;
    }
    if (matchedRule.execution?.providerProfile) {
      executionOverrides.providerProfile = matchedRule.execution.providerProfile;
    }

    const createdTask = await deps.taskStore.createTask(
      {
        title,
        draft: true,
        repoId: repository.id,
        prompt: instructions || title,
        taskType: "build",
        baseBranch: branch || repository.defaultBranch,
        branchStrategy: branch ? "work_on_branch" : "feature_branch",
        autoApplyCheckpoints: true,
        ...resolveCreateTaskProviderConfig(executionOverrides, settings, repository, null),
      },
      repository,
      resolvedOwnerUserId
    );

    const openedTask = await deps.taskStore.patchTask(createdTask.id, {
      status: "open",
      workflowStatus: "ready",
      executionStatus: "idle",
      executionAction: "build",
      lastAction: "build"
    });
    if (!openedTask) {
      return reply.status(500).send({ message: "Webhook-created task could not be opened." });
    }

    if (correlationValue) {
      await deps.taskStore.linkTaskExternalTarget(openedTask.id, repository.id, "webhook", correlationValue);
    }

    const externalId = `webhook:${inboxEntry.id}`;
    const message = await deps.taskStore.appendMessage(openedTask.id, {
      role: "user",
      action: "build",
      queueState: "pending",
      queueSource: "webhook",
      externalId,
      content: instructions || title
    });
    if (!message) {
      return reply.status(500).send({ message: "Webhook-created task message could not be queued." });
    }

    const startResult = await beginTaskStart(
      {
        taskStore: deps.taskStore,
        scheduler: deps.scheduler,
        spawner: deps.spawner
      },
      {
        task: openedTask,
        action: "build",
        input: { content: message.content },
        promptMessageId: message.id,
        fallbackMessage: "Webhook-created task start failed"
      }
    );
    if (!startResult.ok) {
      return reply.status(startResult.statusCode).send({ message: startResult.message });
    }

    await deps.webhookInboxStore.updateMatchResult(inboxEntry.id, matchedRule.id, openedTask.id);
    return reply.status(202).send({ received: true, matched: true, ruleId: matchedRule.id, taskId: openedTask.id, created: true });
  });
};
