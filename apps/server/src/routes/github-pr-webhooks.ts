import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS } from "@agentswarm/shared-types";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import { beginTaskStart } from "../lib/task-start-orchestrator.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

interface GitHubPrFeedback {
  target: "pr";
  externalId: string;
  kind: "pr_comment" | "review_comment" | "review";
  prNumber: number;
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
}

interface GitHubIssueFeedback {
  target: "issue";
  externalId: string;
  kind: "issue" | "issue_comment";
  issueNumber: number;
  issueTitle?: string;
  author: string;
  body: string;
  url: string;
  repositoryFullName?: string;
}

type GitHubFeedback = GitHubPrFeedback | GitHubIssueFeedback;

interface GitHubPrBranchDetails {
  headBranch: string;
  headRepositoryFullName?: string;
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

const readRepositoryFullName = (payload: Record<string, unknown>): string | undefined => {
  const repository = recordValue(payload, "repository");
  return repository ? stringValue(repository, "full_name") ?? undefined : undefined;
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
    if (action !== "created" || !isRecord(payload.issue) || !isRecord(payload.comment)) {
      return null;
    }
    const commentId = numberValue(payload.comment, "id");
    const body = stringValue(payload.comment, "body") ?? "";
    const url = stringValue(payload.comment, "html_url") ?? "";
    if (!commentId || body.trim().length === 0) {
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
        author,
        body,
        url,
        repositoryFullName: readRepositoryFullName(payload)
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
      author,
      body,
      url,
      prApiUrl: stringValue(payload.issue.pull_request, "url") ?? undefined,
      repositoryFullName: readRepositoryFullName(payload)
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
      author,
      body,
      url,
      repositoryFullName: readRepositoryFullName(payload),
      prHeadBranch: readPullRequestHeadDetails(payload.pull_request)?.headBranch,
      prHeadRepositoryFullName: readPullRequestHeadDetails(payload.pull_request)?.headRepositoryFullName,
      reviewState: stringValue(payload.review, "state") ?? undefined
    };
  }

  if (event === "issues") {
    if ((action !== "opened" && action !== "edited") || !isRecord(payload.issue)) {
      return null;
    }
    const issueNumber = numberValue(payload.issue, "number");
    const issueId = numberValue(payload.issue, "id");
    const body = stringValue(payload.issue, "body") ?? "";
    const url = stringValue(payload.issue, "html_url") ?? "";
    if (!issueNumber || !issueId || body.trim().length === 0 || isRecord(payload.issue.pull_request)) {
      return null;
    }
    return {
      target: "issue",
      externalId: `github:issue:${issueId}`,
      kind: "issue",
      issueNumber,
      issueTitle: stringValue(payload.issue, "title") ?? undefined,
      author,
      body,
      url,
      repositoryFullName: readRepositoryFullName(payload)
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

const formatIssueFeedbackMessage = (feedback: GitHubIssueFeedback, instructions: string | null | undefined): string => {
  const lines = [
    `A new GitHub issue feedback item was added to linked issue #${feedback.issueNumber}.`,
    "",
    `Type: ${feedback.kind}`,
    `Author: @${feedback.author}`
  ];
  if (feedback.issueTitle) {
    lines.push(`Issue title: ${feedback.issueTitle}`);
  }
  if (feedback.url) {
    lines.push(`URL: ${feedback.url}`);
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
  `GitHub PR #${feedback.prNumber} feedback from @${feedback.author}`;

const formatNewIssueTaskTitle = (feedback: GitHubIssueFeedback): string =>
  `GitHub issue #${feedback.issueNumber} feedback from @${feedback.author}`;

export const registerGitHubPrWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
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

    const feedback = normalizeGitHubFeedback(readHeader(request.headers["x-github-event"]), request.body);
    if (!feedback) {
      return reply.status(202).send({ queued: false, reason: "ignored_event" });
    }
    const ignoredBotLogin = normalizeGitHubLogin(repository.githubIntegrationBotLogin);
    if (ignoredBotLogin && normalizeGitHubLogin(feedback.author) === ignoredBotLogin) {
      return reply.status(202).send({ queued: false, reason: "ignored_bot_user" });
    }
    const allowedUsers = Array.isArray(repository.githubPrAllowedUsers) ? repository.githubPrAllowedUsers : [];
    if (allowedUsers.length > 0) {
      const normalizedAuthor = normalizeGitHubLogin(feedback.author);
      const allowedUserSet = new Set(allowedUsers.map((user) => normalizeGitHubLogin(user)).filter((user): user is string => Boolean(user)));
      if (!normalizedAuthor || !allowedUserSet.has(normalizedAuthor)) {
        return reply.status(202).send({ queued: false, reason: "disallowed_github_user" });
      }
    }
    if (repository.githubPrRequireBotMention === true && ignoredBotLogin && !mentionsGitHubLogin(feedback.body, ignoredBotLogin)) {
      return reply.status(202).send({ queued: false, reason: "missing_bot_mention" });
    }

    if (feedback.target === "issue") {
      const task = await deps.taskStore.findTaskByGitHubIssueNumber(repository.id, feedback.issueNumber);
      if (!task) {
        const ownerUserId = repository.githubPrTaskOwnerUserId?.trim() || null;
        if (!ownerUserId) {
          return reply.status(202).send({ queued: false, reason: "missing_github_task_owner" });
        }

        const content = formatIssueFeedbackMessage(feedback, repository.githubPrFeedbackInstructions);
        const createdTask = await deps.taskStore.createTask(
          {
            title: formatNewIssueTaskTitle(feedback),
            draft: true,
            repoId: repository.id,
            prompt: content,
            taskType: "build",
            baseBranch: repository.defaultBranch,
            branchStrategy: "feature_branch"
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
        content: formatIssueFeedbackMessage(feedback, repository.githubPrFeedbackInstructions)
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
    }

    const task = await deps.taskStore.findTaskByGitHubPrNumber(repository.id, feedback.prNumber);
    if (!task) {
      const ownerUserId = repository.githubPrTaskOwnerUserId?.trim() || null;
      if (!ownerUserId) {
        return reply.status(202).send({ queued: false, reason: "missing_github_task_owner" });
      }

      const credentials = await deps.settingsStore.getRuntimeCredentials(ownerUserId, "auto");
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

      const content = formatFeedbackMessage(feedback, repository.githubPrFeedbackInstructions);
      const createdTask = await deps.taskStore.createTask(
        {
          title: formatNewTaskTitle(feedback),
          draft: true,
          repoId: repository.id,
          prompt: content,
          taskType: "build",
          baseBranch: branchDetails.headBranch,
          branchStrategy: "work_on_branch"
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
