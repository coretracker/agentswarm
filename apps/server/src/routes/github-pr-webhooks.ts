import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS,
  DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS,
  DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS,
  DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE
} from "@agentswarm/shared-types";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskQueueStore } from "../services/task-queue-store.js";
import type { TaskStore } from "../services/task-store.js";
import { beginTaskStart } from "../lib/task-start-orchestrator.js";
import { env } from "../config/env.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

interface GitHubPrFeedback {
  target: "pr";
  externalId: string;
  kind: "pr_comment" | "review_comment" | "review" | "review_requested";
  prNumber: number;
  title?: string;
  author: string;
  body: string;
  url: string;
  prApiUrl?: string;
  repositoryFullName?: string;
  prHeadBranch?: string;
  prHeadRepositoryFullName?: string;
  path?: string;
  line?: number;
  diffHunk?: string;
  reviewState?: string;
  requestedReviewer?: string;
  commentId?: number;
}

interface GitHubIssueFeedback {
  target: "issue";
  externalId: string;
  kind: "issue" | "issue_comment";
  issueNumber: number;
  issueTitle?: string;
  assigneeLogins: string[];
  author: string;
  body: string;
  url: string;
  repositoryFullName?: string;
  commentId?: number;
}

type GitHubFeedback = GitHubPrFeedback | GitHubIssueFeedback;
type GitHubPromptKind = "initial" | "feedback" | "review";

interface GitHubPrBranchDetails {
  headBranch: string;
  headRepositoryFullName?: string;
}

interface GitHubMergedPullRequest {
  prNumber: number;
  sourceBranch?: string;
  targetBranch?: string;
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

const recordValue = (record: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const value = record[key];
  return isRecord(value) ? value : null;
};

const stringValue = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const numberValue = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
};

const booleanValue = (record: Record<string, unknown>, key: string): boolean | null => {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
};

const GITHUB_TASK_CREATED_COMMENT_MARKER_PREFIX = "<!-- agentswarm-task-created:";

const isGitHubTaskCreatedCommentBody = (body: string): boolean => body.includes(GITHUB_TASK_CREATED_COMMENT_MARKER_PREFIX);

const readRepositoryFullName = (payload: Record<string, unknown>): string | undefined => {
  const repository = recordValue(payload, "repository");
  return repository ? stringValue(repository, "full_name") ?? undefined : undefined;
};

const readIssueAssigneeLogins = (issue: Record<string, unknown>): string[] => {
  const assignees = issue.assignees;
  if (!Array.isArray(assignees)) {
    return [];
  }
  return assignees
    .map((assignee) => (isRecord(assignee) ? stringValue(assignee, "login") : null))
    .filter((login): login is string => Boolean(login));
};

const readPullRequestHeadDetails = (pullRequest: Record<string, unknown>): GitHubPrBranchDetails | null => {
  const head = recordValue(pullRequest, "head");
  if (!head) {
    return null;
  }
  const headBranch = stringValue(head, "ref");
  if (!headBranch) {
    return null;
  }
  const headRepository = recordValue(head, "repo");
  return {
    headBranch,
    headRepositoryFullName: headRepository ? stringValue(headRepository, "full_name") ?? undefined : undefined
  };
};

const readPullRequestBaseBranch = (pullRequest: Record<string, unknown>): string | undefined => {
  const base = recordValue(pullRequest, "base");
  return base ? stringValue(base, "ref") ?? undefined : undefined;
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

const normalizeGitHubFeedback = (event: string | null, payload: unknown): GitHubFeedback | null => {
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
    if ((action !== "created" && action !== "edited") || !isRecord(payload.issue) || !isRecord(payload.comment)) {
      return null;
    }
    const commentId = numberValue(payload.comment, "id");
    const body = stringValue(payload.comment, "body") ?? "";
    const url = stringValue(payload.comment, "html_url") ?? "";
    if (!commentId || body.trim().length === 0) {
      return null;
    }
    if (isGitHubTaskCreatedCommentBody(body)) {
      return null;
    }
    if (!isRecord(payload.issue.pull_request)) {
      const issueNumber = numberValue(payload.issue, "number");
      if (!issueNumber) {
        return null;
      }
      return {
        target: "issue",
        externalId: `github:issue_comment:${commentId}`,
        kind: "issue_comment",
        issueNumber,
        issueTitle: stringValue(payload.issue, "title") ?? undefined,
        assigneeLogins: readIssueAssigneeLogins(payload.issue),
        author,
        body,
        url,
        repositoryFullName: readRepositoryFullName(payload),
        commentId
      };
    }
    const prNumber = numberValue(payload.issue, "number");
    if (!prNumber) {
      return null;
    }
    return {
      target: "pr",
      externalId: `github:pr_comment:${commentId}`,
      kind: "pr_comment",
      prNumber,
      title: stringValue(payload.issue, "title") ?? undefined,
      author,
      body,
      url,
      prApiUrl: stringValue(payload.issue.pull_request, "url") ?? undefined,
      repositoryFullName: readRepositoryFullName(payload),
      commentId
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
      target: "pr",
      externalId: `github:review_comment:${commentId}`,
      kind: "review_comment",
      prNumber,
      title: stringValue(payload.pull_request, "title") ?? undefined,
      author,
      body,
      url,
      repositoryFullName: readRepositoryFullName(payload),
      prHeadBranch: readPullRequestHeadDetails(payload.pull_request)?.headBranch,
      prHeadRepositoryFullName: readPullRequestHeadDetails(payload.pull_request)?.headRepositoryFullName,
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
      target: "pr",
      externalId: `github:review:${reviewId}`,
      kind: "review",
      prNumber,
      title: stringValue(payload.pull_request, "title") ?? undefined,
      author,
      body,
      url,
      repositoryFullName: readRepositoryFullName(payload),
      prHeadBranch: readPullRequestHeadDetails(payload.pull_request)?.headBranch,
      prHeadRepositoryFullName: readPullRequestHeadDetails(payload.pull_request)?.headRepositoryFullName,
      reviewState: stringValue(payload.review, "state") ?? undefined
    };
  }

  if (event === "pull_request") {
    if (action !== "review_requested" || !isRecord(payload.pull_request)) {
      return null;
    }
    const prNumber = numberValue(payload.pull_request, "number");
    const requestedReviewer = recordValue(payload, "requested_reviewer");
    const requestedReviewerLogin = requestedReviewer ? stringValue(requestedReviewer, "login") : null;
    if (!prNumber || !requestedReviewerLogin) {
      return null;
    }
    return {
      target: "pr",
      externalId: `github:review_requested:${prNumber}:reviewer:${requestedReviewerLogin.toLowerCase()}`,
      kind: "review_requested",
      prNumber,
      title: stringValue(payload.pull_request, "title") ?? undefined,
      author,
      body: stringValue(payload.pull_request, "body") ?? "",
      url: stringValue(payload.pull_request, "html_url") ?? "",
      repositoryFullName: readRepositoryFullName(payload),
      prHeadBranch: readPullRequestHeadDetails(payload.pull_request)?.headBranch,
      prHeadRepositoryFullName: readPullRequestHeadDetails(payload.pull_request)?.headRepositoryFullName,
      requestedReviewer: requestedReviewerLogin
    };
  }

  if (event === "issues") {
    if ((action !== "opened" && action !== "edited" && action !== "assigned") || !isRecord(payload.issue)) {
      return null;
    }
    const issueNumber = numberValue(payload.issue, "number");
    const issueId = numberValue(payload.issue, "id");
    const body = stringValue(payload.issue, "body") ?? "";
    const url = stringValue(payload.issue, "html_url") ?? "";
    if (!issueNumber || !issueId || isRecord(payload.issue.pull_request)) {
      return null;
    }
    return {
      target: "issue",
      externalId: `github:issue:${issueId}`,
      kind: "issue",
      issueNumber,
      issueTitle: stringValue(payload.issue, "title") ?? undefined,
      assigneeLogins: readIssueAssigneeLogins(payload.issue),
      author,
      body,
      url,
      repositoryFullName: readRepositoryFullName(payload)
    };
  }

  return null;
};

const normalizeGitHubMergedPullRequest = (event: string | null, payload: unknown): GitHubMergedPullRequest | null => {
  if (event !== "pull_request" || !isRecord(payload)) {
    return null;
  }

  if (stringValue(payload, "action") !== "closed" || !isRecord(payload.pull_request)) {
    return null;
  }

  if (booleanValue(payload.pull_request, "merged") !== true) {
    return null;
  }

  const prNumber = numberValue(payload.pull_request, "number");
  if (!prNumber) {
    return null;
  }

  const headDetails = readPullRequestHeadDetails(payload.pull_request);
  return {
    prNumber,
    sourceBranch: headDetails?.headBranch,
    targetBranch: readPullRequestBaseBranch(payload.pull_request)
  };
};

const replaceTemplateMarkers = (template: string, markers: Record<string, string>): string => {
  let rendered = template;
  for (const [marker, value] of Object.entries(markers)) {
    rendered = rendered.replaceAll(`{{${marker}}}`, value);
  }
  return rendered.trim();
};

const buildTemplateMarkers = (feedback: GitHubFeedback): Record<string, string> => {
  const targetLabel = feedback.target === "pr" ? "pull request" : "issue";
  const targetRef = feedback.target === "pr" ? `PR #${feedback.prNumber}` : `issue #${feedback.issueNumber}`;
  const feedbackBody = feedback.body.trim() || "(No body provided.)";
  const title = feedback.target === "pr" ? feedback.title ?? "" : feedback.issueTitle ?? "";
  const issueTitle = feedback.target === "issue" ? feedback.issueTitle ?? "" : "";
  const reviewState = feedback.target === "pr" ? feedback.reviewState ?? "" : "";
  const file = feedback.target === "pr" ? feedback.path ?? "" : "";
  const line = feedback.target === "pr" && feedback.line ? String(feedback.line) : "";
  const fileWithLine = file ? `${file}${line ? `:${line}` : ""}` : "";
  const diffHunk = feedback.target === "pr" ? feedback.diffHunk ?? "" : "";
  const requestedReviewer = feedback.target === "pr" ? feedback.requestedReviewer ?? "" : "";

  return {
    target_label: targetLabel,
    target_ref: targetRef,
    target: feedback.target,
    number: feedback.target === "pr" ? String(feedback.prNumber) : String(feedback.issueNumber),
    feedback_type: feedback.kind,
    type: feedback.kind,
    author: feedback.author,
    requested_reviewer: requestedReviewer,
    requested_reviewer_line: requestedReviewer ? `Requested reviewer: @${requestedReviewer}\n` : "",
    title,
    title_line: title ? `Title: ${title}\n` : "",
    issue_title: issueTitle,
    issue_title_line: issueTitle ? `Issue title: ${issueTitle}\n` : "",
    review_state: reviewState,
    review_state_line: reviewState ? `Review state: ${reviewState}\n` : "",
    file,
    line,
    file_line: fileWithLine ? `File: ${fileWithLine}\n` : "",
    url: feedback.url,
    url_line: feedback.url ? `URL: ${feedback.url}\n` : "",
    diff_hunk: diffHunk,
    diff_context_block: diffHunk ? `\nDiff context:\n\`\`\`diff\n${diffHunk}\n\`\`\`\n\n` : "",
    feedback_body: feedbackBody
  };
};

const formatGitHubMessage = (
  feedback: GitHubFeedback,
  kind: GitHubPromptKind,
  templates: { initial?: string | null; feedback?: string | null; review?: string | null }
): string => {
  const template =
    kind === "initial"
      ? templates.initial?.trim() || DEFAULT_GITHUB_PR_INITIAL_INSTRUCTIONS
      : kind === "review"
        ? templates.review?.trim() || DEFAULT_GITHUB_PR_REVIEW_INSTRUCTIONS
      : templates.feedback?.trim() || DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS;
  return replaceTemplateMarkers(template, buildTemplateMarkers(feedback));
};

const resolveGitHubPrBranchDetails = async (
  feedback: GitHubPrFeedback,
  githubToken: string | null | undefined
): Promise<GitHubPrBranchDetails | null> => {
  if (feedback.prHeadBranch) {
    return {
      headBranch: feedback.prHeadBranch,
      headRepositoryFullName: feedback.prHeadRepositoryFullName
    };
  }

  if (!feedback.prApiUrl) {
    return null;
  }

  const response = await fetch(feedback.prApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AgentSwarm GitHub PR webhook",
      ...(githubToken?.trim() ? { Authorization: `Bearer ${githubToken.trim()}` } : {})
    }
  });
  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    return null;
  }
  return readPullRequestHeadDetails(payload);
};

const formatNewTaskTitle = (feedback: GitHubPrFeedback): string =>
  feedback.kind === "review_requested"
    ? `GitHub PR #${feedback.prNumber} review requested`
    : `GitHub PR #${feedback.prNumber} feedback from @${feedback.author}`;

const formatNewIssueTaskTitle = (feedback: GitHubIssueFeedback): string =>
  feedback.issueTitle?.trim() || `GitHub issue #${feedback.issueNumber} feedback from @${feedback.author}`;

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_USER_AGENT = "AgentSwarm GitHub PR webhook";

const buildTaskUrl = (taskId: string): string => `${env.CORS_ORIGIN.replace(/\/+$/, "")}/tasks/${encodeURIComponent(taskId)}`;

const renderTaskCreatedCommentTemplate = (template: string | null | undefined, input: { feedback: GitHubFeedback; taskId: string; taskUrl: string }): string => {
  const targetRef = input.feedback.target === "pr" ? `PR #${input.feedback.prNumber}` : `issue #${input.feedback.issueNumber}`;
  const replacements: Record<string, string> = {
    task_id: input.taskId,
    task_url: input.taskUrl,
    target_ref: targetRef,
    author: input.feedback.author,
    repository_full_name: input.feedback.repositoryFullName ?? ""
  };
  const source = template?.trim() || DEFAULT_GITHUB_TASK_CREATED_COMMENT_TEMPLATE;
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => replacements[key] ?? match).trim();
};

const buildTaskCreatedCommentBody = (input: { feedback: GitHubFeedback; taskId: string; template?: string | null }): string => {
  const taskId = input.taskId;
  const taskUrl = buildTaskUrl(taskId);
  const body = renderTaskCreatedCommentTemplate(input.template, { feedback: input.feedback, taskId, taskUrl });
  return [
    body,
    "",
    `${GITHUB_TASK_CREATED_COMMENT_MARKER_PREFIX}${taskId} -->`
  ].join("\n");
};

const postGitHubTaskCreatedComment = async (input: {
  feedback: GitHubFeedback;
  taskId: string;
  githubToken: string | null | undefined;
  template?: string | null;
}): Promise<boolean> => {
  const githubToken = input.githubToken?.trim();
  if (!githubToken || !input.feedback.repositoryFullName) {
    return false;
  }

  const issueNumber = input.feedback.target === "pr" ? input.feedback.prNumber : input.feedback.issueNumber;
  const commentsUrl = `${GITHUB_API_BASE_URL}/repos/${input.feedback.repositoryFullName}/issues/${issueNumber}/comments`;
  const body = buildTaskCreatedCommentBody({ feedback: input.feedback, taskId: input.taskId, template: input.template });
  const marker = `${GITHUB_TASK_CREATED_COMMENT_MARKER_PREFIX}${input.taskId}`;
  const taskUrl = buildTaskUrl(input.taskId);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": GITHUB_USER_AGENT
  };

  const commentsResponse = await fetch(`${commentsUrl}?per_page=100`, { headers });
  if (!commentsResponse.ok) {
    return false;
  }
  const commentsPayload: unknown = await commentsResponse.json();
  if (
    Array.isArray(commentsPayload) &&
    commentsPayload.some((comment) => {
      if (!isRecord(comment)) {
        return false;
      }
      const commentBody = stringValue(comment, "body") ?? "";
      return commentBody.includes(marker) || commentBody.includes(`Task: ${taskUrl}`);
    })
  ) {
    return false;
  }

  const createResponse = await fetch(commentsUrl, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });
  return createResponse.ok;
};

const postGitHubFeedbackCommentReaction = async (input: {
  feedback: GitHubFeedback;
  githubToken: string | null | undefined;
}): Promise<boolean> => {
  const githubToken = input.githubToken?.trim();
  const { feedback } = input;
  if (!githubToken || !feedback.repositoryFullName || (feedback.kind !== "issue_comment" && feedback.kind !== "pr_comment") || !feedback.commentId) {
    return false;
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}/repos/${feedback.repositoryFullName}/issues/comments/${feedback.commentId}/reactions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": GITHUB_USER_AGENT
    },
    body: JSON.stringify({ content: "eyes" })
  });
  return response.ok;
};

export const registerGitHubPrWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    taskQueueStore?: Pick<TaskQueueStore, "removeTask">;
    scheduler: SchedulerService;
    settingsStore: SettingsStore;
    spawner: SpawnerService;
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

    const event = readHeader(request.headers["x-github-event"]);
    const mergedPullRequest = normalizeGitHubMergedPullRequest(event, request.body);
    if (mergedPullRequest) {
      if (repository.githubPrAutoArchiveOnMerge !== true) {
        return reply.status(202).send({ archived: false, reason: "auto_archive_disabled" });
      }

      const task = await deps.taskStore.findTaskByGitHubPrNumber(repository.id, mergedPullRequest.prNumber);
      if (!task) {
        return reply.status(202).send({ archived: false, reason: "linked_task_not_found" });
      }
      if (task.status === "archived") {
        return reply.status(202).send({ archived: false, reason: "already_archived", taskId: task.id });
      }
      if (task.executionStatus === "queued" || task.executionStatus === "preparing" || task.executionStatus === "running") {
        await deps.taskStore.appendLog(
          task.id,
          `GitHub PR #${mergedPullRequest.prNumber} was merged, but the task was not archived because it is active.`
        );
        return reply.status(202).send({ archived: false, reason: "active_task", taskId: task.id });
      }

      await deps.taskStore.publishTaskMergedEvent({
        taskId: task.id,
        sourceBranch: mergedPullRequest.sourceBranch ?? task.branchName ?? `pull/${mergedPullRequest.prNumber}`,
        targetBranch: mergedPullRequest.targetBranch ?? repository.defaultBranch,
        commitMessage: null
      });
      await deps.taskQueueStore?.removeTask(task.id);
      await deps.taskStore.archiveTask(task.id);
      await deps.taskStore.appendLog(task.id, `Task archived after GitHub PR #${mergedPullRequest.prNumber} was merged.`);
      return reply.status(202).send({ archived: true, taskId: task.id });
    }

    const feedback = normalizeGitHubFeedback(event, request.body);
    if (!feedback) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    const ignoredBotLogin = normalizeGitHubLogin(repository.githubIntegrationBotLogin);
    if (ignoredBotLogin && normalizeGitHubLogin(feedback.author) === ignoredBotLogin) {
      return reply.status(202).send({ queued: false, reason: "ignored_bot_user" });
    }
    if (
      feedback.target === "pr" &&
      feedback.kind === "review_requested" &&
      (!ignoredBotLogin || normalizeGitHubLogin(feedback.requestedReviewer) !== ignoredBotLogin)
    ) {
      return reply.status(202).send({ queued: false, reason: "review_request_not_for_bot" });
    }
    const allowedUsers = Array.isArray(repository.githubPrAllowedUsers) ? repository.githubPrAllowedUsers : [];
    if (allowedUsers.length > 0) {
      const normalizedAuthor = normalizeGitHubLogin(feedback.author);
      const allowedUserSet = new Set(allowedUsers.map((user) => normalizeGitHubLogin(user)).filter((user): user is string => Boolean(user)));
      if (!normalizedAuthor || !allowedUserSet.has(normalizedAuthor)) {
        return reply.status(202).send({ queued: false, reason: "disallowed_github_user" });
      }
    }
    const issueAssignedToBot =
      feedback.target === "issue" &&
      ignoredBotLogin !== null &&
      feedback.assigneeLogins.some((login) => normalizeGitHubLogin(login) === ignoredBotLogin);
    const issueAssignmentSatisfiesMentionGate = issueAssignedToBot && feedback.kind === "issue";
    if (feedback.target === "issue" && feedback.body.trim().length === 0 && !issueAssignedToBot) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    if (
      repository.githubPrRequireBotMention === true &&
      ignoredBotLogin &&
      !(feedback.target === "pr" && feedback.kind === "review_requested") &&
      !mentionsGitHubLogin(feedback.body, ignoredBotLogin) &&
      !issueAssignmentSatisfiesMentionGate
    ) {
      return reply.status(202).send({ queued: false, reason: "missing_bot_mention" });
    }

    if (feedback.target === "issue") {
      const task = await deps.taskStore.findTaskByGitHubIssueNumber(repository.id, feedback.issueNumber);
      if (!task) {
        const ownerUserId = repository.githubPrTaskOwnerUserId?.trim() || null;
        if (!ownerUserId) {
          return reply.status(202).send({ queued: false, reason: "missing_github_task_owner" });
        }

        const content = formatGitHubMessage(feedback, "initial", {
          initial: repository.githubPrInitialInstructions,
          feedback: repository.githubPrFeedbackInstructions,
          review: repository.githubPrReviewInstructions
        });
        const createdTask = await deps.taskStore.createTask(
          {
            title: formatNewIssueTaskTitle(feedback),
            draft: true,
            repoId: repository.id,
            prompt: content,
            taskType: "build",
            baseBranch: repository.defaultBranch,
            branchStrategy: "feature_branch",
            autoApplyCheckpoints: true
          },
          repository,
          ownerUserId
        );
        const openedTask = await deps.taskStore.patchTask(createdTask.id, {
          githubIssueNumber: feedback.issueNumber,
          status: "open",
          workflowStatus: "ready",
          executionStatus: "idle",
          executionAction: "build",
          lastAction: "build"
        });
        if (!openedTask) {
          return reply.status(500).send({ message: "GitHub issue-created task could not be opened." });
        }

        const message = await deps.taskStore.appendMessage(openedTask.id, {
          role: "user",
          action: "build",
          queueState: "pending",
          queueSource: "github_issue",
          externalId: feedback.externalId,
          content
        });
        if (!message) {
          return reply.status(500).send({ message: "GitHub issue-created task message could not be queued." });
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
            input: { content },
            promptMessageId: message.id,
            fallbackMessage: "GitHub issue-created task start failed"
          }
        );
        if (!startResult.ok) {
          return reply.status(startResult.statusCode).send({ message: startResult.message });
        }

        const credentials = await deps.settingsStore.getRuntimeCredentials(null, "auto").catch(() => ({ githubToken: null }));
        await postGitHubFeedbackCommentReaction({
          feedback,
          githubToken: credentials.githubToken
        }).catch(() => false);
        await postGitHubTaskCreatedComment({
          feedback,
          taskId: openedTask.id,
          githubToken: credentials.githubToken,
          template: repository.githubPrTaskCreatedCommentTemplate
        }).catch(() => false);

        return reply.status(202).send({ queued: true, taskId: openedTask.id, messageId: message.id, createdTask: true });
      }

      const existing = await deps.taskStore.listMessages(task.id);
      if (existing.some((message) => message.externalId === feedback.externalId)) {
        return reply.status(202).send({ queued: false, reason: "duplicate" });
      }

      const message = await deps.taskStore.appendMessage(task.id, {
        role: "user",
        action: "build",
        queueState: "pending",
        queueSource: "github_issue",
        externalId: feedback.externalId,
        content: formatGitHubMessage(feedback, "feedback", {
          initial: repository.githubPrInitialInstructions,
          feedback: repository.githubPrFeedbackInstructions,
          review: repository.githubPrReviewInstructions
        })
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
      if (message) {
        const credentials = await deps.settingsStore.getRuntimeCredentials(null, "auto").catch(() => ({ githubToken: null }));
        await postGitHubFeedbackCommentReaction({
          feedback,
          githubToken: credentials.githubToken
        }).catch(() => false);
      }

      return reply.status(202).send({ queued: true, taskId: task.id, messageId: message?.id ?? null });
    }

    const task = await deps.taskStore.findTaskByGitHubPrNumber(repository.id, feedback.prNumber);
    if (!task) {
      const ownerUserId = repository.githubPrTaskOwnerUserId?.trim() || null;
      if (!ownerUserId) {
        return reply.status(202).send({ queued: false, reason: "missing_github_task_owner" });
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials(null, "auto");
      const branchDetails = await resolveGitHubPrBranchDetails(feedback, credentials.githubToken);
      if (!branchDetails) {
        return reply.status(202).send({ queued: false, reason: "pr_branch_unavailable" });
      }
      if (
        branchDetails.headRepositoryFullName &&
        feedback.repositoryFullName &&
        branchDetails.headRepositoryFullName.toLowerCase() !== feedback.repositoryFullName.toLowerCase()
      ) {
        return reply.status(202).send({ queued: false, reason: "fork_pr_branch_unsupported" });
      }

      const promptKind: GitHubPromptKind = feedback.kind === "review_requested" ? "review" : "initial";
      const content = formatGitHubMessage(feedback, promptKind, {
        initial: repository.githubPrInitialInstructions,
        feedback: repository.githubPrFeedbackInstructions,
        review: repository.githubPrReviewInstructions
      });
      const createdTask = await deps.taskStore.createTask(
        {
          title: formatNewTaskTitle(feedback),
          draft: true,
          repoId: repository.id,
          prompt: content,
          taskType: "build",
          baseBranch: branchDetails.headBranch,
          branchStrategy: "work_on_branch",
          ...(feedback.kind === "review_requested" ? { autoApplyCheckpoints: true } : {})
        },
        repository,
        ownerUserId
      );
      const openedTask = await deps.taskStore.patchTask(createdTask.id, {
        githubPrNumber: feedback.prNumber,
        status: "open",
        workflowStatus: "ready",
        executionStatus: "idle",
        executionAction: "build",
        lastAction: "build"
      });
      if (!openedTask) {
        return reply.status(500).send({ message: "GitHub-created task could not be opened." });
      }

      const message = await deps.taskStore.appendMessage(openedTask.id, {
        role: "user",
        action: "build",
        queueState: "pending",
        queueSource: "github_pr",
        externalId: feedback.externalId,
        content
      });
      if (!message) {
        return reply.status(500).send({ message: "GitHub-created task message could not be queued." });
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
          input: { content },
          promptMessageId: message.id,
          fallbackMessage: "GitHub-created task start failed"
        }
      );
      if (!startResult.ok) {
        return reply.status(startResult.statusCode).send({ message: startResult.message });
      }

      await postGitHubFeedbackCommentReaction({
        feedback,
        githubToken: credentials.githubToken
      }).catch(() => false);
      await postGitHubTaskCreatedComment({
        feedback,
        taskId: openedTask.id,
        githubToken: credentials.githubToken,
        template: repository.githubPrTaskCreatedCommentTemplate
      }).catch(() => false);

      return reply.status(202).send({ queued: true, taskId: openedTask.id, messageId: message.id, createdTask: true });
    }

    const existing = await deps.taskStore.listMessages(task.id);
    if (existing.some((message) => message.externalId === feedback.externalId)) {
      return reply.status(202).send({ queued: false, reason: "duplicate" });
    }

    const linkedPromptKind: GitHubPromptKind = feedback.kind === "review_requested" ? "review" : "feedback";
    const message = await deps.taskStore.appendMessage(task.id, {
      role: "user",
      action: "build",
      queueState: "pending",
      queueSource: "github_pr",
      externalId: feedback.externalId,
      content: formatGitHubMessage(feedback, linkedPromptKind, {
        initial: repository.githubPrInitialInstructions,
        feedback: repository.githubPrFeedbackInstructions,
        review: repository.githubPrReviewInstructions
      })
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
    if (message) {
      const credentials = await deps.settingsStore.getRuntimeCredentials(null, "auto").catch(() => ({ githubToken: null }));
      await postGitHubFeedbackCommentReaction({
        feedback,
        githubToken: credentials.githubToken
      }).catch(() => false);
    }

    return reply.status(202).send({ queued: true, taskId: task.id, messageId: message?.id ?? null });
  });
};
