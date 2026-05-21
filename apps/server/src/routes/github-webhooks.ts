import type { FastifyInstance } from "fastify";
import { SYSTEM_ADMIN_ROLE_ID } from "../services/role-store.js";
import type { GitHubImportService } from "../services/github-import-service.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SnippetStore } from "../services/snippet-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { UserStore } from "../services/user-store.js";
import { applyTaskStartMode } from "../lib/task-start-mode.js";

const GITHUB_DEDUPE_TTL_MS = 15 * 60 * 1_000;
const githubEventDedupeCache = new Map<string, number>();

interface GitHubIssueLikePayload {
  action?: string;
  issue?: { number?: number; labels?: Array<{ name?: string }> };
}

interface GitHubPullRequestLikePayload {
  action?: string;
  pull_request?: { number?: number; labels?: Array<{ name?: string }> };
}

interface GitHubIssueCommentPayload {
  action?: string;
  issue?: { number?: number; labels?: Array<{ name?: string }>; pull_request?: Record<string, unknown> };
  comment?: { id?: number; body?: string };
  sender?: { login?: string; type?: string };
}

interface GitHubReactionPayload {
  action?: string;
  reaction?: { id?: number | null };
  content?: string;
  issue?: { number?: number; labels?: Array<{ name?: string }>; pull_request?: Record<string, unknown> };
  comment?: { id?: number; body?: string };
  sender?: { login?: string; type?: string };
}

interface GitHubPullRequestReviewCommentPayload {
  action?: string;
  pull_request?: { number?: number; labels?: Array<{ name?: string }> };
  comment?: { id?: number; body?: string };
  sender?: { login?: string; type?: string };
}

const ALLOWED_ACTIONS_BY_EVENT: Record<string, Set<string>> = {
  issues: new Set(["opened", "edited", "closed", "reopened", "labeled", "unlabeled", "assigned", "unassigned"]),
  pull_request: new Set(["opened", "edited", "closed", "reopened", "synchronize", "labeled", "unlabeled", "ready_for_review", "converted_to_draft"]),
  issue_comment: new Set(["created", "edited", "deleted"]),
  pull_request_review_comment: new Set(["created", "edited", "deleted"]),
  reaction: new Set(["created", "deleted"])
};

const normalizeLabels = (labels: Array<{ name?: string }> | undefined): Set<string> =>
  new Set((labels ?? []).map((entry) => (entry.name ?? "").trim().toLowerCase()).filter(Boolean));

const matchesLabels = (
  labels: Set<string>,
  filter: { labelsAny?: string[]; labelsAll?: string[]; labelsNone?: string[] } | undefined
): boolean => {
  if (!filter) {
    return true;
  }
  const any = (filter.labelsAny ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const all = (filter.labelsAll ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const none = (filter.labelsNone ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (any.length > 0 && !any.some((entry) => labels.has(entry))) {
    return false;
  }
  if (all.length > 0 && !all.every((entry) => labels.has(entry))) {
    return false;
  }
  if (none.length > 0 && none.some((entry) => labels.has(entry))) {
    return false;
  }
  return true;
};

type CommentTriggerType = "emoji_reaction" | "slash_command" | "bot_mention";

const BOT_MENTION_TOKEN = "@agent";
const DEFAULT_ALLOWED_TRIGGERS: CommentTriggerType[] = ["emoji_reaction", "slash_command", "bot_mention"];
const DEFAULT_ALLOWED_REACTIONS = ["🤖", "robot"];
const DEFAULT_ALLOWED_COMMANDS = ["/agent run"];

const normalizeLowercaseList = (value: string[] | undefined): string[] =>
  Array.from(new Set((value ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean)));

const detectCommentTriggerType = (
  eventType: string,
  payload: GitHubIssueCommentPayload | GitHubPullRequestReviewCommentPayload | GitHubReactionPayload
): { triggerType: CommentTriggerType | null; command: string | null } => {
  if (eventType === "reaction") {
    return { triggerType: "emoji_reaction", command: null };
  }

  const body = String(payload.comment?.body ?? "");
  const lowered = body.toLowerCase();
  if (lowered.includes(BOT_MENTION_TOKEN)) {
    return { triggerType: "bot_mention", command: null };
  }
  const command = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("/"));
  if (command) {
    return { triggerType: "slash_command", command };
  }
  return { triggerType: null, command: null };
};

const canActorTrigger = (payload: { sender?: { login?: string; type?: string } }, allowedActorLogins: string[]): boolean => {
  const actorType = String(payload.sender?.type ?? "").trim().toLowerCase();
  const actorLogin = String(payload.sender?.login ?? "").trim().toLowerCase();
  if (!actorLogin) {
    return false;
  }
  // Guardrail against bot/self loops.
  if (actorType === "bot" || actorLogin.endsWith("[bot]")) {
    return false;
  }
  if (allowedActorLogins.length === 0) {
    return true;
  }
  return allowedActorLogins.includes(actorLogin);
};

const resolveOwnerUserId = async (userStore: UserStore): Promise<string | null> => {
  const users = await userStore.listUsers();
  const admin = users.find((user) => user.roles.some((role) => role.id === SYSTEM_ADMIN_ROLE_ID));
  return admin?.id ?? users[0]?.id ?? null;
};

const resolveAssigneeUserId = async (userStore: UserStore, assigneeEmail: string | undefined): Promise<string | null> => {
  const normalized = assigneeEmail?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const users = await userStore.listUsers();
  const match = users.find((user) => user.email.trim().toLowerCase() === normalized);
  return match?.id ?? null;
};

export const isSupportedGitHubEvent = (eventType: string): boolean => Boolean(ALLOWED_ACTIONS_BY_EVENT[eventType]);

export const hasSupportedGitHubAction = (eventType: string, action: string): boolean => {
  const allowed = ALLOWED_ACTIONS_BY_EVENT[eventType];
  return Boolean(allowed?.has(action));
};

export const isValidGitHubEventPayload = (eventType: string, payload: Record<string, unknown>): boolean => {
  if (eventType === "issues") {
    const typed = payload as GitHubIssueLikePayload;
    return Number.isInteger(typed.issue?.number);
  }
  if (eventType === "pull_request") {
    const typed = payload as GitHubPullRequestLikePayload;
    return Number.isInteger(typed.pull_request?.number);
  }
  if (eventType === "issue_comment") {
    const typed = payload as GitHubIssueCommentPayload;
    return Number.isInteger(typed.issue?.number) && Number.isInteger(typed.comment?.id);
  }
  if (eventType === "pull_request_review_comment") {
    const typed = payload as GitHubPullRequestReviewCommentPayload;
    return Number.isInteger(typed.pull_request?.number) && Number.isInteger(typed.comment?.id);
  }
  if (eventType === "reaction") {
    const typed = payload as GitHubReactionPayload;
    if (!typed.action) {
      return false;
    }
    if (typed.action === "created") {
      return typeof typed.content === "string" && typed.content.trim().length > 0;
    }
    return true;
  }
  return false;
};

const cleanupExpiredGitHubDedupeEntries = (nowMs: number): void => {
  for (const [key, expiry] of githubEventDedupeCache) {
    if (expiry <= nowMs) {
      githubEventDedupeCache.delete(key);
    }
  }
};

export const buildGitHubEventDedupeKey = (
  repositoryId: string,
  eventType: string,
  action: string,
  payload: Record<string, unknown>,
  deliveryId: string | null
): string => {
  if (deliveryId) {
    return `delivery:${repositoryId}:${deliveryId}`;
  }
  if (eventType === "issues") {
    const typed = payload as GitHubIssueLikePayload;
    return `issues:${repositoryId}:${action}:${typed.issue?.number ?? "unknown"}`;
  }
  if (eventType === "pull_request") {
    const typed = payload as GitHubPullRequestLikePayload;
    return `pull_request:${repositoryId}:${action}:${typed.pull_request?.number ?? "unknown"}`;
  }
  if (eventType === "issue_comment") {
    const typed = payload as GitHubIssueCommentPayload;
    return `issue_comment:${repositoryId}:${action}:${typed.comment?.id ?? "unknown"}`;
  }
  if (eventType === "pull_request_review_comment") {
    const typed = payload as GitHubPullRequestReviewCommentPayload;
    return `pull_request_review_comment:${repositoryId}:${action}:${typed.comment?.id ?? "unknown"}`;
  }
  if (eventType === "reaction") {
    const typed = payload as GitHubReactionPayload;
    return `reaction:${repositoryId}:${action}:${typed.reaction?.id ?? typed.content ?? "unknown"}`;
  }
  return `unknown:${repositoryId}:${eventType}:${action}`;
};

export const isDuplicateGitHubEvent = (
  repositoryId: string,
  eventType: string,
  action: string,
  payload: Record<string, unknown>,
  deliveryId: string | null
): boolean => {
  const nowMs = Date.now();
  cleanupExpiredGitHubDedupeEntries(nowMs);
  const dedupeKey = buildGitHubEventDedupeKey(repositoryId, eventType, action, payload, deliveryId);
  const existingExpiry = githubEventDedupeCache.get(dedupeKey);
  if (existingExpiry && existingExpiry > nowMs) {
    return true;
  }
  githubEventDedupeCache.set(dedupeKey, nowMs + GITHUB_DEDUPE_TTL_MS);
  return false;
};

export const registerGitHubWebhookRoutes = (
  app: FastifyInstance,
  deps: {
    repositoryStore: RepositoryStore;
    githubImportService: GitHubImportService;
    taskStore: TaskStore;
    userStore: UserStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
    snippetStore: SnippetStore;
  }
): void => {
  app.post<{ Params: { repositoryId: string } }>("/webhooks/github/:repositoryId", async (request, reply) => {
    const repository = await deps.repositoryStore.getRepository(request.params.repositoryId);
    if (!repository) {
      return reply.status(404).send({ message: "Repository not found" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    const githubEventHeader = request.headers["x-github-event"];
    const githubEvent = (Array.isArray(githubEventHeader) ? githubEventHeader[0] : githubEventHeader) ?? "";
    const deliveryHeader = request.headers["x-github-delivery"];
    const githubDeliveryId = ((Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader) ?? "").trim() || null;
    const action = typeof body.action === "string" ? body.action : "";

    if (!isSupportedGitHubEvent(githubEvent)) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }
    if (!action || !hasSupportedGitHubAction(githubEvent, action)) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }
    if (!isValidGitHubEventPayload(githubEvent, body)) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }
    if (isDuplicateGitHubEvent(repository.id, githubEvent, action, body, githubDeliveryId)) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }

    const rules = repository.githubAutomations ?? [];
    if (rules.length === 0) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }

    const fallbackOwnerUserId = await resolveOwnerUserId(deps.userStore);
    if (!fallbackOwnerUserId) {
      return reply.status(409).send({ message: "No users are available to own webhook-created tasks." });
    }

    let matched = 0;
    let created = 0;

    if (githubEvent === "issues") {
      const payload = body as GitHubIssueLikePayload;
      if (payload.action !== "opened" || !payload.issue?.number) {
        return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
      }
      const labels = normalizeLabels(payload.issue.labels);
      for (const rule of rules) {
        if (!rule.enabled || rule.trigger !== "issue_opened" || !matchesLabels(labels, rule.labelFilter)) {
          continue;
        }
        matched += 1;
        const issueInput = await deps.githubImportService.buildTaskInputFromIssue(repository, {
          repoId: repository.id,
          issueNumber: payload.issue.number,
          includeComments: rule.task.includeComments ?? false,
          notes: rule.task.notes,
          taskType: rule.task.taskType ?? "build",
          startMode: rule.task.startMode ?? "run_now",
          title: rule.task.titleTemplate,
          provider: rule.task.provider,
          providerProfile: rule.task.providerProfile,
          modelOverride: rule.task.modelOverride ?? undefined,
          codexCredentialSource: rule.task.codexCredentialSource,
          baseBranch: rule.task.baseBranch,
          branchStrategy: rule.task.branchStrategy
        });
        if (rule.task.snippetId) {
          const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
          if (snippet) {
            issueInput.notes = [snippet.content, issueInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
          }
        }
        const ownerUserId = (await resolveAssigneeUserId(deps.userStore, rule.task.assigneeEmail)) ?? fallbackOwnerUserId;
        const task = await deps.taskStore.createTask(issueInput, repository, ownerUserId);
        await applyTaskStartMode(task, rule.task.startMode ?? "run_now", {
          taskStore: deps.taskStore,
          scheduler: deps.scheduler,
          spawner: deps.spawner
        });
        created += 1;
      }
      return reply.status(202).send({ accepted: true, matched, created });
    }

    if (githubEvent === "pull_request") {
      const payload = body as GitHubPullRequestLikePayload;
      if (payload.action !== "opened" || !payload.pull_request?.number) {
        return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
      }
      const labels = normalizeLabels(payload.pull_request.labels);
      for (const rule of rules) {
        if (!rule.enabled || rule.trigger !== "pull_request_opened" || !matchesLabels(labels, rule.labelFilter)) {
          continue;
        }
        matched += 1;
        const prInput = await deps.githubImportService.buildTaskInputFromPullRequest(repository, {
          repoId: repository.id,
          pullRequestNumber: payload.pull_request.number,
          notes: rule.task.notes,
          title: rule.task.titleTemplate,
          provider: rule.task.provider,
          providerProfile: rule.task.providerProfile,
          modelOverride: rule.task.modelOverride ?? undefined,
          codexCredentialSource: rule.task.codexCredentialSource
        });
        if (rule.task.snippetId) {
          const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
          if (snippet) {
            prInput.notes = [snippet.content, prInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
          }
        }
        const ownerUserId = (await resolveAssigneeUserId(deps.userStore, rule.task.assigneeEmail)) ?? fallbackOwnerUserId;
        const task = await deps.taskStore.createTask(prInput, repository, ownerUserId);
        await applyTaskStartMode(task, "run_now", {
          taskStore: deps.taskStore,
          scheduler: deps.scheduler,
          spawner: deps.spawner
        });
        created += 1;
      }
      return reply.status(202).send({ accepted: true, matched, created });
    }

    if (githubEvent === "issue_comment" || githubEvent === "pull_request_review_comment" || githubEvent === "reaction") {
      const payload = body as GitHubIssueCommentPayload | GitHubPullRequestReviewCommentPayload | GitHubReactionPayload;
      if (payload.action !== "created") {
        return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
      }

      const { triggerType, command } = detectCommentTriggerType(githubEvent, payload);
      if (!triggerType) {
        return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
      }
      const reactionContent = githubEvent === "reaction" ? String(payload.content ?? "").trim().toLowerCase() : null;

      const issueNumber =
        githubEvent === "pull_request_review_comment"
          ? (payload as GitHubPullRequestReviewCommentPayload).pull_request?.number
          : (payload as GitHubIssueCommentPayload | GitHubReactionPayload).issue?.number;
      if (!issueNumber) {
        return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
      }

      const isPullRequestConversation =
        githubEvent === "pull_request_review_comment" ||
        Boolean((payload as GitHubIssueCommentPayload | GitHubReactionPayload).issue?.pull_request);
      const labels = normalizeLabels(
        isPullRequestConversation
          ? githubEvent === "pull_request_review_comment"
            ? (payload as GitHubPullRequestReviewCommentPayload).pull_request?.labels
            : undefined
          : (payload as GitHubIssueCommentPayload | GitHubReactionPayload).issue?.labels
      );
      const actorLogin = String(payload.sender?.login ?? "unknown");
      const actorTimestamp = new Date().toISOString();

      for (const rule of rules) {
        if (!rule.enabled || rule.automationEnabled !== true) {
          continue;
        }
        if (rule.trigger !== (isPullRequestConversation ? "pull_request_opened" : "issue_opened")) {
          continue;
        }
        if (!matchesLabels(labels, rule.labelFilter)) {
          continue;
        }

        const allowedTriggers = (rule.allowedTriggers?.length ? rule.allowedTriggers : DEFAULT_ALLOWED_TRIGGERS).map((entry) => entry.trim());
        if (!allowedTriggers.includes(triggerType)) {
          continue;
        }
        if (triggerType === "slash_command") {
          const allowedCommands = (rule.allowedCommands?.length ? rule.allowedCommands : DEFAULT_ALLOWED_COMMANDS).map((entry) => entry.trim().toLowerCase());
          if (!command || !allowedCommands.includes(command.trim().toLowerCase())) {
            continue;
          }
        }
        if (triggerType === "emoji_reaction") {
          const allowedReactions = (rule.allowedReactions?.length ? rule.allowedReactions : DEFAULT_ALLOWED_REACTIONS).map((entry) =>
            entry.trim().toLowerCase()
          );
          if (!reactionContent || !allowedReactions.includes(reactionContent)) {
            continue;
          }
        }
        const allowedActorLogins = normalizeLowercaseList(rule.allowedActorLogins);
        if (!canActorTrigger(payload, allowedActorLogins)) {
          continue;
        }

        matched += 1;
        const auditLine = `[GitHub Trigger Audit] actor=@${actorLogin} at=${actorTimestamp} trigger=${triggerType}${command ? ` command=${command}` : ""}`;
        if (isPullRequestConversation) {
          const prInput = await deps.githubImportService.buildTaskInputFromPullRequest(repository, {
            repoId: repository.id,
            pullRequestNumber: issueNumber,
            notes: [auditLine, rule.task.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n"),
            title: rule.task.titleTemplate,
            provider: rule.task.provider,
            providerProfile: rule.task.providerProfile,
            modelOverride: rule.task.modelOverride ?? undefined,
            codexCredentialSource: rule.task.codexCredentialSource
          });
          if (rule.task.snippetId) {
            const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
            if (snippet) {
              prInput.notes = [snippet.content, prInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
            }
          }
          const ownerUserId = (await resolveAssigneeUserId(deps.userStore, rule.task.assigneeEmail)) ?? fallbackOwnerUserId;
          const task = await deps.taskStore.createTask(prInput, repository, ownerUserId);
          await applyTaskStartMode(task, "run_now", {
            taskStore: deps.taskStore,
            scheduler: deps.scheduler,
            spawner: deps.spawner
          });
          created += 1;
        } else {
          const issueInput = await deps.githubImportService.buildTaskInputFromIssue(repository, {
            repoId: repository.id,
            issueNumber,
            includeComments: rule.task.includeComments ?? true,
            notes: [auditLine, rule.task.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n"),
            taskType: rule.task.taskType ?? "build",
            startMode: rule.task.startMode ?? "run_now",
            title: rule.task.titleTemplate,
            provider: rule.task.provider,
            providerProfile: rule.task.providerProfile,
            modelOverride: rule.task.modelOverride ?? undefined,
            codexCredentialSource: rule.task.codexCredentialSource,
            baseBranch: rule.task.baseBranch,
            branchStrategy: rule.task.branchStrategy
          });
          if (rule.task.snippetId) {
            const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
            if (snippet) {
              issueInput.notes = [snippet.content, issueInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
            }
          }
          const ownerUserId = (await resolveAssigneeUserId(deps.userStore, rule.task.assigneeEmail)) ?? fallbackOwnerUserId;
          const task = await deps.taskStore.createTask(issueInput, repository, ownerUserId);
          await applyTaskStartMode(task, rule.task.startMode ?? "run_now", {
            taskStore: deps.taskStore,
            scheduler: deps.scheduler,
            spawner: deps.spawner
          });
          created += 1;
        }
      }

      return reply.status(202).send({ accepted: true, matched, created });
    }

    return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
  });
};
