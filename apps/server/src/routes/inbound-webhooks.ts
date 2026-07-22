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

const verifySlackSignature = (rawBody: string, timestamp: string | null, signatureHeader: string, secret: string): boolean => {
  if (!timestamp) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 60 * 5) {
    return false;
  }
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader.trim());
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const verifySignature = (rawBody: string, signatureHeader: string | null, secret: string, slackTimestamp: string | null): boolean => {
  if (signatureHeader?.trim().startsWith("v0=")) {
    return verifySlackSignature(rawBody, slackTimestamp, signatureHeader, secret);
  }
  const digest = extractSha256Digest(signatureHeader);
  if (!digest) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(digest);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const readSignatureHeaders = (request: FastifyRequest, headerNames: string[] | undefined): Array<{ header: string; value: string }> => {
  const configuredHeaderNames =
    Array.isArray(headerNames) && headerNames.length > 0 ? headerNames : ["x-webhook-signature", "x-hub-signature-256"];
  const signatures: Array<{ header: string; value: string }> = [];
  for (const headerName of configuredHeaderNames) {
    const header = headerName.toLowerCase();
    const headerValue = readHeader(request.headers[header]);
    if (headerValue) {
      signatures.push({ header, value: headerValue });
    }
  }
  return signatures;
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

const isSlackUrlVerificationPayload = (body: unknown): body is { challenge: string } =>
  Boolean(
    body &&
      typeof body === "object" &&
      "type" in body &&
      body.type === "url_verification" &&
      "challenge" in body &&
      typeof body.challenge === "string" &&
      body.challenge.trim().length > 0
  );

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

    const body = request.body ?? {};
    const headers = flattenHeaders(request.headers);
    const sourceIp = request.ip || null;

    const [secret, signatureSecrets] = await Promise.all([
      deps.repositoryStore.getRepositoryInboundWebhookSecret(repository.id),
      deps.repositoryStore.getRepositoryInboundWebhookSignatureSecrets(repository.id)
    ]);
    const signatureSecretHeaders = Object.keys(signatureSecrets);
    if (secret || signatureSecretHeaders.length > 0) {
      const rawBody = (request as RawBodyRequest).rawBody ?? "";
      const signatures = readSignatureHeaders(
        request,
        signatureSecretHeaders.length > 0 ? signatureSecretHeaders : repository.inboundWebhookSignatureHeaders
      );
      const slackTimestamp = readHeader(request.headers["x-slack-request-timestamp"]);
      const valid = signatures.some((signature) => {
        if (Object.prototype.hasOwnProperty.call(signatureSecrets, signature.header) && signatureSecrets[signature.header] === "") {
          return true;
        }
        const signatureSecret = signatureSecrets[signature.header] ?? secret;
        return signatureSecret ? verifySignature(rawBody, signature.value, signatureSecret, slackTimestamp) : false;
      });
      if (!valid) {
        await deps.webhookInboxStore.insertEntry({
          repositoryId: repository.id,
          headers,
          body,
          sourceIp,
          status: "rejected",
          reason: "invalid_signature"
        });
        return reply.status(401).send({ message: "Invalid webhook signature." });
      }
    }

    if (isSlackUrlVerificationPayload(body)) {
      return reply.status(200).send({ challenge: body.challenge });
    }

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
      await deps.webhookInboxStore.markDropped(inboxEntry.id, "no_matching_rule");
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
      await deps.webhookInboxStore.markDropped(inboxEntry.id, "no_task_owner", matchedRule.id);
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
      await deps.webhookInboxStore.markDropped(inboxEntry.id, "task_start_failed", matchedRule.id);
      return reply.status(startResult.statusCode).send({ message: startResult.message });
    }

    await deps.webhookInboxStore.updateMatchResult(inboxEntry.id, matchedRule.id, openedTask.id);
    return reply.status(202).send({ received: true, matched: true, ruleId: matchedRule.id, taskId: openedTask.id, created: true });
  });
};
