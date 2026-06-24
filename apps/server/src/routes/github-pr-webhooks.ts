import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS } from "@agentswarm/shared-types";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { TaskStore } from "../services/task-store.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

interface GitHubPrFeedback {
  externalId: string;
  kind: "pr_comment" | "review_comment" | "review";
  prNumber: number;
  author: string;
  body: string;
  url: string;
  path?: string;
  line?: number;
  diffHunk?: string;
  reviewState?: string;
}

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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");

const stringValue = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const numberValue = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
};

const normalizeGitHubLogin = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().replace(/^@+/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const mentionsGitHubLogin = (body: string, login: string): boolean => {
  const escapedLogin = escapeRegExp(login);
  return new RegExp(`(^|[^A-Za-z0-9_-])@${escapedLogin}(?=$|[^A-Za-z0-9_-])`, "i").test(body);
};

const verifySignature = (rawBody: string, signatureHeader: string | null, secret: string): boolean => {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const normalizeGitHubPrFeedback = (event: string | null, payload: unknown): GitHubPrFeedback | null => {
  if (!event || !isRecord(payload)) {
    return null;
  }

  const action = stringValue(payload, "action");
  const sender = isRecord(payload.sender) ? payload.sender : null;
  const author = sender ? stringValue(sender, "login") ?? "unknown" : "unknown";
  const senderType = sender ? stringValue(sender, "type") : null;
  if (senderType === "Bot") {
    return null;
  }

  if (event === "issue_comment") {
    if (action !== "created" || !isRecord(payload.issue) || !isRecord(payload.comment)) {
      return null;
    }
    if (!isRecord(payload.issue.pull_request)) {
      return null;
    }
    const prNumber = numberValue(payload.issue, "number");
    const commentId = numberValue(payload.comment, "id");
    const body = stringValue(payload.comment, "body") ?? "";
    const url = stringValue(payload.comment, "html_url") ?? "";
    if (!prNumber || !commentId || body.trim().length === 0) {
      return null;
    }
    return {
      externalId: `github:pr_comment:${commentId}`,
      kind: "pr_comment",
      prNumber,
      author,
      body,
      url
    };
  }

  if (event === "pull_request_review_comment") {
    if (action !== "created" || !isRecord(payload.pull_request) || !isRecord(payload.comment)) {
      return null;
    }
    const prNumber = numberValue(payload.pull_request, "number");
    const commentId = numberValue(payload.comment, "id");
    const body = stringValue(payload.comment, "body") ?? "";
    const url = stringValue(payload.comment, "html_url") ?? "";
    if (!prNumber || !commentId || body.trim().length === 0) {
      return null;
    }
    return {
      externalId: `github:review_comment:${commentId}`,
      kind: "review_comment",
      prNumber,
      author,
      body,
      url,
      path: stringValue(payload.comment, "path") ?? undefined,
      line: numberValue(payload.comment, "line") ?? numberValue(payload.comment, "original_line") ?? undefined,
      diffHunk: stringValue(payload.comment, "diff_hunk") ?? undefined
    };
  }

  if (event === "pull_request_review") {
    if (action !== "submitted" || !isRecord(payload.pull_request) || !isRecord(payload.review)) {
      return null;
    }
    const prNumber = numberValue(payload.pull_request, "number");
    const reviewId = numberValue(payload.review, "id");
    const body = stringValue(payload.review, "body") ?? "";
    const url = stringValue(payload.review, "html_url") ?? "";
    if (!prNumber || !reviewId || body.trim().length === 0) {
      return null;
    }
    return {
      externalId: `github:review:${reviewId}`,
      kind: "review",
      prNumber,
      author,
      body,
      url,
      reviewState: stringValue(payload.review, "state") ?? undefined
    };
  }

  return null;
};

const formatFeedbackMessage = (feedback: GitHubPrFeedback, instructions: string | null | undefined): string => {
  const lines = [
    `A new GitHub pull request feedback item was added to linked PR #${feedback.prNumber}.`,
    "",
    `Type: ${feedback.kind}`,
    `Author: @${feedback.author}`
  ];
  if (feedback.reviewState) {
    lines.push(`Review state: ${feedback.reviewState}`);
  }
  if (feedback.path) {
    lines.push(`File: ${feedback.path}${feedback.line ? `:${feedback.line}` : ""}`);
  }
  if (feedback.url) {
    lines.push(`URL: ${feedback.url}`);
  }
  if (feedback.diffHunk) {
    lines.push("", "Diff context:", "```diff", feedback.diffHunk, "```");
  }
  lines.push(
    "",
    "Feedback:",
    feedback.body.trim() || "(No body provided.)",
    "",
    instructions?.trim() || DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS
  );
  return lines.join("\n");
};

export const registerGitHubPrWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
  }
): void => {
  app.post<{ Params: { repositoryId: string } }>("/github/webhooks/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const secret = await deps.repositoryStore.getRepositoryGitHubPrWebhookSecret(repository.id);
    if (!secret) {
      return reply.status(409).send({ message: "GitHub PR feedback webhook secret is not configured." });
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? "";
    const signature = readHeader(request.headers["x-hub-signature-256"]);
    if (!verifySignature(rawBody, signature, secret)) {
      return reply.status(401).send({ message: "Invalid GitHub webhook signature." });
    }

    const feedback = normalizeGitHubPrFeedback(readHeader(request.headers["x-github-event"]), request.body);
    if (!feedback) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    const ignoredBotLogin = normalizeGitHubLogin(repository.githubIntegrationBotLogin);
    if (ignoredBotLogin && normalizeGitHubLogin(feedback.author) === ignoredBotLogin) {
      return reply.status(202).send({ queued: false, reason: "ignored_bot_user" });
    }
    if (repository.githubPrRequireBotMention === true && ignoredBotLogin && !mentionsGitHubLogin(feedback.body, ignoredBotLogin)) {
      return reply.status(202).send({ queued: false, reason: "missing_bot_mention" });
    }

    const task = await deps.taskStore.findTaskByGitHubPrNumber(repository.id, feedback.prNumber);
    if (!task) {
      return reply.status(202).send({ queued: false, reason: "no_linked_task" });
    }

    const existing = await deps.taskStore.listMessages(task.id);
    if (existing.some((message) => message.externalId === feedback.externalId)) {
      return reply.status(202).send({ queued: false, reason: "duplicate" });
    }

    const message = await deps.taskStore.appendMessage(task.id, {
      role: "user",
      action: "build",
      queueState: "pending",
      queueSource: "github_pr",
      externalId: feedback.externalId,
      content: formatFeedbackMessage(feedback, repository.githubPrFeedbackInstructions)
    });

    if (message && task.executionStatus === "idle" && !(await deps.taskStore.hasPendingChangeProposal(task.id))) {
      const blocked = await getMutationBlocked(deps.taskStore, task.id);
      if (!blocked) {
        await deps.scheduler.triggerAction(task.id, "build", { content: message.content }, { promptMessageId: message.id });
      }
    } else if (
      message &&
      (task.executionStatus === "failed" || task.executionStatus === "cancelled") &&
      !(await deps.taskStore.hasPendingChangeProposal(task.id))
    ) {
      await deps.scheduler.triggerNextPendingAction(task.id, "auto");
    }

    return reply.status(202).send({ queued: true, taskId: task.id, messageId: message?.id ?? null });
  });
};
