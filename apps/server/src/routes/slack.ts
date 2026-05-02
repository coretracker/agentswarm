import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { applyTaskStartMode } from "../lib/task-start-mode.js";
import { canUserAccessRepository, canUserAccessTask, isAdminUser } from "../lib/task-ownership.js";
import { getTaskStatusLabel, type TaskStartMode, type TaskType } from "@agentswarm/shared-types";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { UserStore } from "../services/user-store.js";

type SlackCommandBody = {
  command?: string;
  text?: string;
  user_id?: string;
  team_id?: string;
  channel_id?: string;
  response_url?: string;
  trigger_id?: string;
};

type SlackParsedCommand =
  | { kind: "help" }
  | { kind: "task"; taskId: string }
  | {
      kind: "new";
      repoId: string | null;
      title: string | null;
      prompt: string;
      taskType: TaskType;
      startMode: TaskStartMode;
    };

const slackCommandBodySchema = z.object({
  command: z.string().trim().min(1),
  text: z.string().optional().default(""),
  user_id: z.string().trim().min(1),
  team_id: z.string().trim().min(1).optional(),
  channel_id: z.string().trim().min(1).optional(),
  response_url: z.string().trim().optional(),
  trigger_id: z.string().trim().optional()
});

const SLACK_SIGNATURE_VERSION = "v0";
const SLACK_REQUEST_MAX_AGE_SECONDS = 60 * 5;

const trimSlackValue = (value: string | undefined | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripLeadingCommandWord = (value: string, command: "new" | "create"): string => {
  const pattern = new RegExp(`^${command}\\s+`, "i");
  if (pattern.test(value)) {
    return value.replace(pattern, "");
  }

  return "";
};

const buildTaskLink = (taskId: string): string | null => {
  const base = env.CORS_ORIGIN.trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }

  return `${base}/tasks/${encodeURIComponent(taskId)}`;
};

const summarizePrompt = (prompt: string): string => {
  const normalized = normalizeWhitespace(prompt);
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
};

const parseSlackCommandText = (text: string): SlackParsedCommand => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "help" };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "help") {
    return { kind: "help" };
  }

  if (lower === "task" || lower.startsWith("task ")) {
    const taskId = trimSlackValue(trimmed.slice(4)) ?? "";
    if (!taskId) {
      return { kind: "help" };
    }

    return { kind: "task", taskId };
  }

  if (lower === "new" || lower.startsWith("new ") || lower === "create" || lower.startsWith("create ")) {
    const payloadText = lower.startsWith("new ")
      ? stripLeadingCommandWord(trimmed, "new")
      : lower.startsWith("create ")
        ? stripLeadingCommandWord(trimmed, "create")
        : "";
    const tokenPattern = /(^|\s)(repo|repoId|title|prompt|type|mode)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
    const extracted: {
      repoId: string | null;
      title: string | null;
      prompt: string | null;
      taskType: TaskType;
      startMode: TaskStartMode;
    } = {
      repoId: null,
      title: null,
      prompt: null,
      taskType: "build",
      startMode: "run_now"
    };

    const stripped = payloadText.replace(tokenPattern, (_match, prefix: string, key: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const value = trimSlackValue(doubleQuoted ?? singleQuoted ?? bare) ?? "";
      switch (key.toLowerCase()) {
        case "repo":
        case "repoid":
          extracted.repoId = value;
          break;
        case "title":
          extracted.title = value;
          break;
        case "prompt":
          extracted.prompt = value;
          break;
        case "type":
          extracted.taskType = value === "ask" ? "ask" : "build";
          break;
        case "mode":
          extracted.startMode =
            value === "idle" || value === "prepare_workspace" ? value : "run_now";
          break;
      }

      return prefix || " ";
    });

    const leftover = normalizeWhitespace(stripped);
    if (!extracted.prompt && leftover) {
      extracted.prompt = leftover;
    }

    return {
      kind: "new",
      repoId: extracted.repoId,
      title: extracted.title,
      prompt: extracted.prompt ?? "",
      taskType: extracted.taskType,
      startMode: extracted.startMode
    };
  }

  return { kind: "help" };
};

const parseSlackRequest = (body: unknown): SlackCommandBody | null => {
  if (!body || typeof body !== "object") {
    return null;
  }

  const parsed = slackCommandBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

const verifySlackSignature = (signingSecret: string, request: FastifyRequest): boolean => {
  const requestTimestamp = request.headers["x-slack-request-timestamp"];
  const requestSignature = request.headers["x-slack-signature"];
  const rawBody = request.rawBody ?? "";

  if (typeof requestTimestamp !== "string" || typeof requestSignature !== "string" || !rawBody) {
    return false;
  }

  const timestamp = Number(requestTimestamp);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > SLACK_REQUEST_MAX_AGE_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${requestTimestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(requestSignature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
};

const fetchSlackUserEmail = async (botToken: string, slackUserId: string): Promise<string | null> => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: {
      Authorization: `Bearer ${botToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Slack user lookup failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    user?: {
      deleted?: boolean;
      profile?: {
        email?: string;
      };
    };
  };

  if (!data.ok) {
    throw new Error(data.error ? `Slack user lookup failed: ${data.error}` : "Slack user lookup failed");
  }

  const email = trimSlackValue(data.user?.profile?.email);
  return email ?? null;
};

const postSlackResponse = async (responseUrl: string, text: string): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      response_type: "ephemeral",
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Slack response delivery failed with HTTP ${response.status}`);
  }
};

const buildHelpMessage = (): string => {
  return [
    "Use `/agentswarm new repo=<repoId> prompt=<task description> [title=<short title>] [type=build|ask] [mode=run_now|prepare_workspace|idle]`.",
    "Use `/agentswarm task <id>` to inspect a task you can access.",
    "If you have exactly one repository assigned in AgentSwarm, `repo=<repoId>` can be omitted."
  ].join("\n");
};

const formatTaskDetails = (task: Awaited<ReturnType<TaskStore["getTask"]>>, link: string | null): string => {
  if (!task) {
    return "Task not found.";
  }

  return [
    `Task: ${task.title}`,
    `Id: ${task.id}`,
    `Status: ${getTaskStatusLabel(task.status)}`,
    `Type: ${task.taskType}`,
    `Repository: ${task.repoName}`,
    link ? `Open: ${link}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const buildNotFoundMessage = (): string =>
  "No matching active AgentSwarm account was found for this Slack user email.";

export const registerSlackRoutes = (
  app: FastifyInstance,
  deps: {
    settingsStore: SettingsStore;
    userStore: UserStore;
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
  }
): void => {
  app.post<{ Body: SlackCommandBody | Record<string, string> }>("/slack/commands", async (request, reply) => {
    const runtimeCredentials = await deps.settingsStore.getRuntimeCredentials();
    if (!runtimeCredentials.slackBotToken || !runtimeCredentials.slackSigningSecret) {
      return reply.status(503).send({
        response_type: "ephemeral",
        text: "Slack integration is not configured in AgentSwarm Settings."
      });
    }

    if (!verifySlackSignature(runtimeCredentials.slackSigningSecret, request)) {
      return reply.status(401).send({
        response_type: "ephemeral",
        text: "Invalid Slack signature."
      });
    }

    const parsedBody = parseSlackRequest(request.body);
    if (!parsedBody) {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Invalid Slack command payload."
      });
    }

    if (parsedBody.command !== "/agentswarm") {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Unknown Slack command."
      });
    }

    if (!parsedBody.response_url) {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Missing Slack response URL."
      });
    }

    const responseUrl = parsedBody.response_url;
    const responseText = "AgentSwarm verarbeitet deinen Befehl. Die Antwort folgt gleich.";
    void reply.send({
      response_type: "ephemeral",
      text: responseText
    });

    const processing = async (): Promise<void> => {
      try {
        const slackEmail = await fetchSlackUserEmail(runtimeCredentials.slackBotToken, parsedBody.user_id);
        if (!slackEmail) {
          await postSlackResponse(responseUrl, "Could not read the Slack user's email address.");
          return;
        }

        const matchedUser = await deps.userStore.getUserByEmail(slackEmail);
        if (!matchedUser || !matchedUser.active) {
          await postSlackResponse(responseUrl, buildNotFoundMessage());
          return;
        }

        const command = parseSlackCommandText(parsedBody.text ?? "");
        if (command.kind === "help") {
          await postSlackResponse(responseUrl, buildHelpMessage());
          return;
        }

        if (command.kind === "task") {
          const task = await deps.taskStore.getTask(command.taskId);
          if (!task || !canUserAccessTask(matchedUser, task)) {
            await postSlackResponse(responseUrl, "Task not found or not accessible.");
            return;
          }

          await postSlackResponse(responseUrl, formatTaskDetails(task, buildTaskLink(task.id)));
          return;
        }

        const accessibleRepositories = matchedUser.repositoryIds ?? [];
        let repositoryId = command.repoId?.trim() ?? "";
        if (!repositoryId) {
          if (accessibleRepositories.length !== 1) {
            const repositoryCandidates = isAdminUser(matchedUser)
              ? await deps.repositoryStore.listRepositories()
              : await Promise.all(
                  accessibleRepositories.map(async (repoId) => {
                    const repository = await deps.repositoryStore.getRepository(repoId);
                    return repository;
                  })
                );
            const repoNames = repositoryCandidates
              .filter((repository): repository is NonNullable<typeof repository> => Boolean(repository))
              .map((repository) => `${repository.name} (${repository.id})`);

            await postSlackResponse(
              responseUrl,
              repoNames.length > 0
                ? `Pick a repository with \`repo=<repoId>\`. Accessible repositories: ${repoNames.join(", ")}`
                : "Pick a repository with `repo=<repoId>`. No repositories are currently assigned to your AgentSwarm account."
            );
            return;
          }

          repositoryId = accessibleRepositories[0]!;
        }

        const repository = await deps.repositoryStore.getRepository(repositoryId);
        if (!repository || !canUserAccessRepository(matchedUser, repository.id)) {
          await postSlackResponse(responseUrl, "That repository is not available to your AgentSwarm account.");
          return;
        }

        const prompt = normalizeWhitespace(command.prompt);
        if (command.startMode === "run_now" && prompt.length === 0) {
          await postSlackResponse(responseUrl, "Provide `prompt=<task description>` for a new task.");
          return;
        }

        const title = normalizeWhitespace(command.title ?? "") || summarizePrompt(prompt) || "Slack task";
        const settings = await deps.settingsStore.getSettings();
        const provider = settings.defaultProvider;
        const providerProfile = provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort;
        const modelOverride = provider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel;

        const createdTask = await deps.taskStore.createTask(
          {
            title,
            repoId: repository.id,
            prompt,
            taskType: command.taskType,
            provider,
            providerProfile,
            modelOverride,
            startMode: command.startMode
          },
          repository,
          matchedUser.id
        );

        const startedTask = await applyTaskStartMode(
          createdTask,
          command.startMode,
          {
            taskStore: deps.taskStore,
            scheduler: deps.scheduler,
            spawner: deps.spawner
          },
          prompt.length > 0 ? { content: prompt } : undefined
        ).catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : "Task follow-up failed";
          await deps.taskStore.appendLog(createdTask.id, `Slack task start failed: ${message}`);
          return (await deps.taskStore.getTask(createdTask.id)) ?? createdTask;
        });

        const link = buildTaskLink(startedTask.id);
        await postSlackResponse(
          responseUrl,
          [
            `Created task: ${startedTask.title}`,
            `Id: ${startedTask.id}`,
            `Status: ${getTaskStatusLabel(startedTask.status)}`,
            link ? `Open: ${link}` : null
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Slack command failed";
        request.log.error({ error }, "Slack command processing failed");
        await postSlackResponse(responseUrl, message).catch((postError) => {
          request.log.error({ error: postError }, "Failed to deliver Slack error response");
        });
      }
    };

    setImmediate(() => {
      void processing();
    });
  });
};
