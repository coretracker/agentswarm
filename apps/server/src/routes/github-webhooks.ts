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

interface GitHubIssueLikePayload {
  action?: string;
  issue?: { number?: number; labels?: Array<{ name?: string }> };
}

interface GitHubPullRequestLikePayload {
  action?: string;
  pull_request?: { number?: number; labels?: Array<{ name?: string }> };
}

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

const resolveOwnerUserId = async (userStore: UserStore): Promise<string | null> => {
  const users = await userStore.listUsers();
  const admin = users.find((user) => user.roles.some((role) => role.id === SYSTEM_ADMIN_ROLE_ID));
  return admin?.id ?? users[0]?.id ?? null;
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

    const rules = repository.githubAutomations ?? [];
    if (rules.length === 0) {
      return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
    }

    const ownerUserId = await resolveOwnerUserId(deps.userStore);
    if (!ownerUserId) {
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
          baseBranch: rule.task.baseBranch,
          branchStrategy: rule.task.branchStrategy
        });
        if (rule.task.snippetId) {
          const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
          if (snippet) {
            issueInput.notes = [snippet.content, issueInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
          }
        }
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
          modelOverride: rule.task.modelOverride ?? undefined
        });
        if (rule.task.snippetId) {
          const snippet = await deps.snippetStore.getSnippet(rule.task.snippetId);
          if (snippet) {
            prInput.notes = [snippet.content, prInput.notes ?? ""].filter((entry) => entry.trim().length > 0).join("\n\n");
          }
        }
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

    return reply.status(202).send({ accepted: true, matched: 0, created: 0 });
  });
};
